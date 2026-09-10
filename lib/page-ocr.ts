import { spawn } from "node:child_process";

export type PageOcrProvider = "turboocr" | "tesseract" | "openai-page-vision";

export interface PageOcrAttempt {
  provider: PageOcrProvider;
  status: "success" | "failed" | "skipped";
  confidence: number;
  charCount: number;
  durationMs: number;
  reason?: string;
}

export interface PageOcrResult {
  accepted: boolean;
  text: string;
  provider?: PageOcrProvider;
  confidence: number;
  attempts: PageOcrAttempt[];
}

interface ProviderTextResult {
  text: string;
  confidence: number;
}

const DEFAULT_PROVIDER_ORDER: PageOcrProvider[] = ["turboocr", "tesseract", "openai-page-vision"];
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MIN_CHARS = 32;
const DEFAULT_MIN_CONFIDENCE = 0.5;
const OPENAI_API = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.6-sol";

let tesseractUnavailable = false;

function compactWhitespace(value: string): string {
  return String(value || "")
    .replace(/\u0000/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function boundedNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function timeoutMs(): number {
  return boundedNumber(process.env.CYBRID_PAGE_OCR_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 5_000, 120_000);
}

function minChars(): number {
  return Math.round(boundedNumber(process.env.CYBRID_PAGE_OCR_MIN_CHARS, DEFAULT_MIN_CHARS, 8, 500));
}

function minConfidence(): number {
  return boundedNumber(process.env.CYBRID_PAGE_OCR_MIN_CONFIDENCE, DEFAULT_MIN_CONFIDENCE, 0, 1);
}

export function parseOcrProviderOrder(value = process.env.CYBRID_PAGE_OCR_ORDER): PageOcrProvider[] {
  if (!value?.trim()) return [...DEFAULT_PROVIDER_ORDER];
  const allowed = new Set<PageOcrProvider>(DEFAULT_PROVIDER_ORDER);
  const seen = new Set<PageOcrProvider>();
  const parsed: PageOcrProvider[] = [];
  for (const raw of value.split(",")) {
    const provider = raw.trim().toLowerCase() as PageOcrProvider;
    if (!allowed.has(provider) || seen.has(provider)) continue;
    seen.add(provider);
    parsed.push(provider);
  }
  return parsed.length ? parsed : [...DEFAULT_PROVIDER_ORDER];
}

export function shouldAcceptOcrResult(result: ProviderTextResult): boolean {
  const text = compactWhitespace(result.text);
  return text.length >= minChars() && Number.isFinite(result.confidence) && result.confidence >= minConfidence();
}

export function parseTesseractTsv(tsv: string): ProviderTextResult {
  const lines = String(tsv || "").split(/\r?\n/);
  const grouped = new Map<string, string[]>();
  const confidences: number[] = [];

  for (const line of lines) {
    if (!line || line.startsWith("level\t")) continue;
    const columns = line.split("\t");
    if (columns.length < 12) continue;
    const text = columns.slice(11).join("\t").trim();
    if (!text) continue;
    const confidence = Number(columns[10]);
    if (Number.isFinite(confidence) && confidence >= 0) confidences.push(confidence / 100);
    const lineKey = `${columns[2]}:${columns[3]}:${columns[4]}`;
    const words = grouped.get(lineKey) || [];
    words.push(text);
    grouped.set(lineKey, words);
  }

  const text = compactWhitespace(Array.from(grouped.values()).map((words) => words.join(" ")).join("\n"));
  const confidence = confidences.length
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : 0;
  return { text, confidence };
}

async function runTesseract(image: Buffer): Promise<ProviderTextResult> {
  if (tesseractUnavailable) throw new Error("Tesseract CLI was not available earlier in this process.");
  const command = process.env.TESSERACT_CMD || "tesseract";
  const language = process.env.TESSERACT_LANG || "eng";
  const psm = process.env.TESSERACT_PSM || "3";
  const started = Date.now();

  return await new Promise<ProviderTextResult>((resolve, reject) => {
    const child = spawn(command, ["stdin", "stdout", "-l", language, "--oem", "1", "--psm", psm, "tsv"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const finishResolve = (result: ProviderTextResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finishReject(new Error(`Tesseract timed out after ${Date.now() - started}ms.`));
    }, timeoutMs());

    child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") tesseractUnavailable = true;
      finishReject(error);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        const message = Buffer.concat(stderr).toString("utf8").trim();
        finishReject(new Error(`Tesseract exited with code ${code}${message ? `: ${message.slice(0, 500)}` : ""}`));
        return;
      }
      finishResolve(parseTesseractTsv(Buffer.concat(stdout).toString("utf8")));
    });

    child.stdin?.end(image);
  });
}

async function runTurboOcr(image: Buffer): Promise<ProviderTextResult> {
  const baseUrl = process.env.TURBOOCR_URL?.trim().replace(/\/$/, "");
  if (!baseUrl) throw new Error("TURBOOCR_URL is not configured.");
  const headers: Record<string, string> = { "Content-Type": "image/png" };
  if (process.env.TURBOOCR_API_KEY) headers.Authorization = `Bearer ${process.env.TURBOOCR_API_KEY}`;

  const response = await fetch(`${baseUrl}/ocr/raw?layout=1`, {
    method: "POST",
    headers,
    body: new Blob([new Uint8Array(image)], { type: "image/png" }),
    signal: AbortSignal.timeout(timeoutMs()),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`TurboOCR failed (${response.status})${body ? `: ${body.slice(0, 500)}` : ""}`);
  }

  const payload = await response.json() as {
    text?: string;
    results?: Array<{ text?: string; confidence?: number }>;
  };
  if (payload.results?.length) {
    const texts: string[] = [];
    const confidences: number[] = [];
    for (const item of payload.results) {
      if (item.text?.trim()) texts.push(item.text.trim());
      if (Number.isFinite(item.confidence)) confidences.push(Math.max(0, Math.min(1, Number(item.confidence))));
    }
    return {
      text: compactWhitespace(texts.join("\n")),
      confidence: confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0,
    };
  }
  return { text: compactWhitespace(payload.text || ""), confidence: payload.text?.trim() ? 0.5 : 0 };
}

function openAiKey(): string {
  return process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY || "";
}

function openAiModel(): string {
  return process.env.OPENAI_OCR_MODEL
    || process.env.OPENAI_EXTRACTION_MODEL
    || process.env.OPENAI_DOCUMENT_MODEL
    || DEFAULT_OPENAI_MODEL;
}

function extractOpenAiOutputText(data: unknown): string {
  const payload = data as {
    output_text?: string;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  };
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  for (const item of payload.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string" && content.text.trim()) return content.text;
    }
  }
  throw new Error("OpenAI page OCR returned no output text.");
}

async function runOpenAiPageVision(image: Buffer, pageNumber: number): Promise<ProviderTextResult> {
  const key = openAiKey();
  if (!key) throw new Error("OpenAI is not configured for page OCR recovery.");
  const response = await fetch(`${OPENAI_API}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs()),
    body: JSON.stringify({
      model: openAiModel(),
      store: false,
      max_output_tokens: 10_000,
      reasoning: { effort: "low" },
      instructions: "You are an OCR recovery stage, not a title examiner. Transcribe the visible page faithfully. Preserve names, dates, amounts, instrument numbers, book/page references, legal-description text, headings, and line breaks when useful. Do not summarize, correct, infer, or add facts. Confidence is only your estimate of transcription legibility.",
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: `Transcribe physical PDF page ${pageNumber} exactly enough for downstream evidence verification.` },
          { type: "input_image", image_url: `data:image/png;base64,${image.toString("base64")}`, detail: "high" },
        ],
      }],
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "cybrid_page_ocr",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["text", "confidence"],
            properties: {
              text: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
          },
        },
      },
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI page OCR failed (${response.status})${body ? `: ${body.slice(0, 800)}` : ""}`);
  }
  const output = extractOpenAiOutputText(await response.json());
  const parsed = JSON.parse(output) as { text?: string; confidence?: number };
  return {
    text: compactWhitespace(parsed.text || ""),
    confidence: Math.max(0, Math.min(1, Number.isFinite(parsed.confidence) ? Number(parsed.confidence) : 0.5)),
  };
}

async function runProvider(provider: PageOcrProvider, image: Buffer, pageNumber: number): Promise<ProviderTextResult> {
  if (provider === "turboocr") return runTurboOcr(image);
  if (provider === "tesseract") return runTesseract(image);
  return runOpenAiPageVision(image, pageNumber);
}

function providerConfigured(provider: PageOcrProvider): boolean {
  if (provider === "turboocr") return Boolean(process.env.TURBOOCR_URL?.trim());
  if (provider === "tesseract") return !tesseractUnavailable && process.env.CYBRID_DISABLE_TESSERACT !== "1";
  return Boolean(openAiKey());
}

export async function ocrPageImage(image: Buffer, pageNumber: number): Promise<PageOcrResult> {
  const attempts: PageOcrAttempt[] = [];
  if (process.env.CYBRID_DISABLE_PAGE_OCR === "1") {
    return { accepted: false, text: "", confidence: 0, attempts };
  }

  for (const provider of parseOcrProviderOrder()) {
    if (!providerConfigured(provider)) {
      attempts.push({ provider, status: "skipped", confidence: 0, charCount: 0, durationMs: 0, reason: "Provider not configured or unavailable." });
      continue;
    }
    const started = Date.now();
    try {
      const result = await runProvider(provider, image, pageNumber);
      const text = compactWhitespace(result.text);
      const confidence = Math.max(0, Math.min(1, Number.isFinite(result.confidence) ? result.confidence : 0));
      const accepted = shouldAcceptOcrResult({ text, confidence });
      attempts.push({
        provider,
        status: accepted ? "success" : "failed",
        confidence,
        charCount: text.length,
        durationMs: Date.now() - started,
        reason: accepted ? undefined : `Below OCR acceptance threshold (${minChars()} chars / ${minConfidence().toFixed(2)} confidence).`,
      });
      if (accepted) return { accepted: true, text, provider, confidence, attempts };
    } catch (error) {
      attempts.push({
        provider,
        status: "failed",
        confidence: 0,
        charCount: 0,
        durationMs: Date.now() - started,
        reason: error instanceof Error ? error.message.slice(0, 600) : "Unknown OCR provider failure.",
      });
    }
  }

  return { accepted: false, text: "", confidence: 0, attempts };
}
