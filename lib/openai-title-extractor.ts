import type { PreparedPacket } from "./document-engine";
import { buildEvidenceLedger } from "./title-evidence-ledger";
import type { ExtractedTitlePacket, RawTitlePacketExtraction } from "./title-extraction-model";

const OPENAI_API = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-5.6-sol";
const MAX_OUTPUT_TOKENS = 20000;

type ExtractionHints = { requestedState?: string; requestedSearchType?: string };

const evidenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["quote", "page", "documentType", "instrumentNumber", "confidence"],
  properties: {
    quote: { type: "string" },
    page: { type: "integer", minimum: 1 },
    documentType: { type: "string" },
    instrumentNumber: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

const factSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value", "evidence"],
  properties: {
    value: { type: "string" },
    evidence: { type: "array", items: evidenceSchema },
  },
} as const;

const instrumentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "instrumentNumber", "bookPage", "documentDate", "recordingDate", "amount", "status", "parties", "propertyAddress", "legalDescription", "referencedInstrumentNumbers", "evidence"],
  properties: {
    type: { type: "string" },
    instrumentNumber: { type: "string" },
    bookPage: { type: "string" },
    documentDate: { type: "string" },
    recordingDate: { type: "string" },
    amount: { type: "string" },
    status: { type: "string" },
    parties: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "role"],
        properties: { name: { type: "string" }, role: { type: "string" } },
      },
    },
    propertyAddress: { type: "string" },
    legalDescription: { type: "string" },
    referencedInstrumentNumbers: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: evidenceSchema },
  },
} as const;

const runSheetEntrySchema = {
  type: "object",
  additionalProperties: false,
  required: ["category", "instrumentType", "instrumentNumber", "bookPage", "documentDate", "recordingDate", "amount", "parties", "legalDescription", "evidence"],
  properties: {
    category: { type: "string" },
    instrumentType: { type: "string" },
    instrumentNumber: { type: "string" },
    bookPage: { type: "string" },
    documentDate: { type: "string" },
    recordingDate: { type: "string" },
    amount: { type: "string" },
    parties: { type: "string" },
    legalDescription: { type: "string" },
    evidence: { type: "array", items: evidenceSchema },
  },
} as const;

const extractionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["header", "runSheet", "instruments", "references", "taxes", "flags", "targetLienHint", "extractionSummary"],
  properties: {
    header: {
      type: "object",
      additionalProperties: false,
      required: ["orderNumber", "tsNumber", "searchType", "state", "county", "propertyAddress", "parcelId", "effectiveDate", "legalDescription", "borrower", "currentOwner"],
      properties: {
        orderNumber: factSchema,
        tsNumber: factSchema,
        searchType: factSchema,
        state: factSchema,
        county: factSchema,
        propertyAddress: factSchema,
        parcelId: factSchema,
        effectiveDate: factSchema,
        legalDescription: factSchema,
        borrower: factSchema,
        currentOwner: factSchema,
      },
    },
    runSheet: {
      type: "object",
      additionalProperties: false,
      required: ["detected", "pageStart", "pageEnd", "basis", "evidence", "entries"],
      properties: {
        detected: { type: "boolean" },
        pageStart: { type: "integer", minimum: 0 },
        pageEnd: { type: "integer", minimum: 0 },
        basis: { type: "string" },
        evidence: { type: "array", items: evidenceSchema },
        entries: { type: "array", items: runSheetEntrySchema },
      },
    },
    instruments: { type: "array", items: instrumentSchema },
    references: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "documentType", "instrumentNumber", "bookPage", "evidence"],
        properties: {
          description: { type: "string" },
          documentType: { type: "string" },
          instrumentNumber: { type: "string" },
          bookPage: { type: "string" },
          evidence: { type: "array", items: evidenceSchema },
        },
      },
    },
    taxes: {
      type: "object",
      additionalProperties: false,
      required: ["status", "fiscalYear", "landValue", "improvements"],
      properties: { status: factSchema, fiscalYear: factSchema, landValue: factSchema, improvements: factSchema },
    },
    flags: {
      type: "object",
      additionalProperties: false,
      required: ["hoa", "ccrs", "federalTaxLien", "bankruptcy", "plat", "mers", "min"],
      properties: { hoa: factSchema, ccrs: factSchema, federalTaxLien: factSchema, bankruptcy: factSchema, plat: factSchema, mers: factSchema, min: factSchema },
    },
    targetLienHint: {
      type: "object",
      additionalProperties: false,
      required: ["instrumentNumber", "position"],
      properties: { instrumentNumber: factSchema, position: factSchema },
    },
    extractionSummary: { type: "string" },
  },
} as const;

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY;
  if (!key) throw new Error("OpenAI is not configured for title extraction.");
  return key;
}

export function titleExtractionModel(): string {
  return process.env.OPENAI_EXTRACTION_MODEL || process.env.OPENAI_REVIEW_MODEL || process.env.OPENAI_DOCUMENT_MODEL || DEFAULT_MODEL;
}

function retryDelayMs(response: Response): number {
  const retryAfter = response.headers.get("retry-after");
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  return Number.isFinite(seconds) ? Math.min(15000, Math.max(1000, seconds * 1000)) : 2500;
}

async function openAIFetch(url: string, init: RequestInit): Promise<Response> {
  let response = await fetch(url, init);
  if (response.ok) return response;
  if (response.status === 429 || response.status >= 500) {
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response)));
    response = await fetch(url, init);
    if (response.ok) return response;
  }
  const body = await response.text().catch(() => "");
  throw new Error(`OpenAI title extraction failed (${response.status})${body ? `: ${body.slice(0, 1200)}` : ""}`);
}

async function uploadPdf(buffer: ArrayBuffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("expires_after[anchor]", "created_at");
  form.append("expires_after[seconds]", "3600");
  form.append("file", new Blob([buffer], { type: "application/pdf" }), filename);
  const response = await openAIFetch(`${OPENAI_API}/files`, { method: "POST", headers: { Authorization: `Bearer ${apiKey()}` }, body: form });
  const data = await response.json() as { id?: string };
  if (!data.id) throw new Error("OpenAI accepted the title PDF but returned no file id.");
  return data.id;
}

async function deleteFile(fileId: string): Promise<void> {
  try { await fetch(`${OPENAI_API}/files/${fileId}`, { method: "DELETE", headers: { Authorization: `Bearer ${apiKey()}` } }); } catch { /* best-effort cleanup */ }
}

function extractOutputText(data: unknown): string {
  const payload = data as { output_text?: string; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  for (const item of payload.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) if (content.type === "output_text" && typeof content.text === "string") return content.text;
  }
  throw new Error("OpenAI title extraction returned no structured output.");
}

function instructions(hints: ExtractionHints): string {
  return `You are the extraction stage of Cybrid Title. Your only job is to turn the supplied title packet into source-backed documentary facts. DO NOT perform QC. DO NOT decide PASS/FAIL. DO NOT recommend curative action. DO NOT infer missing facts.

PROCESS CONTRACT
This is EXTRACT/CLASSIFY only. A separate deterministic and AI-assisted checker runs later against your evidence ledger.

SOURCE RULES
- Read the complete packet, including opening title-summary pages and every supporting recorded document.
- Physical PDF page numbers are 1-based. If text input contains === PDF PAGE N === markers, those markers control page citations.
- Every non-empty extracted fact must carry at least one short exact source quote, physical page, document type, and confidence.
- Use value "Not Stated" with an empty evidence array when the packet does not state a fact.
- Never use current owner as borrower unless the packet expressly identifies that person as borrower/mortgagor.
- Never infer lien position from document order.
- Never infer a negative from absence. "No HOA", "none found", "no federal tax lien", etc. may be extracted only when the packet expressly says it.
- Keep document date and recording date separate.
- Preserve instrument numbers, book/page, amounts, party names, and legal descriptions exactly enough for later deterministic comparison.

FUNCTIONAL RUN SHEET
The Run Sheet/title summary can be the opening pages of the SAME PDF and does not need the literal label "Run Sheet". Treat opening pages as a functional Run Sheet when they summarize title-search facts (vesting, chain deeds, mortgages, assignments, releases, liens, taxes, recording data, legal description, etc.) and the supporting source documents follow behind them. Extract each material Run Sheet entry separately so the checker can compare summary → source and source → summary.

INSTRUMENTS
Create one instrument object per distinct supplied deed, mortgage/deed of trust, assignment, release/satisfaction, lien/judgment, trustee/foreclosure instrument, tax/assessor record, HOA/CC&R record, plat/survey, or other material title document. Do not create one instrument per page. Capture references to other instruments separately even when the referenced source document is missing.

TARGET FORECLOSURE LIEN
Only populate targetLienHint when the packet/order expressly identifies the lien being foreclosed or expressly states its position. If several mortgages exist and the target is not explicit, return Not Stated.

REQUEST HINTS
Requested state override: ${hints.requestedState || "AUTO"}
Requested order profile: ${hints.requestedSearchType || "Auto Detect"}
These are hints only; extraction must report what the packet itself states. A later stage applies an examiner override if appropriate.`;
}

async function responseExtraction(args: { fileId?: string; text?: string; hints: ExtractionHints; model: string }): Promise<{ raw: RawTitlePacketExtraction; modelMs: number; usage: unknown }> {
  const started = Date.now();
  const content: Array<Record<string, unknown>> = [{
    type: "input_text",
    text: args.fileId ? "Extract the complete attached title packet into the required source-backed schema." : `Extract this complete page-addressable title packet into the required source-backed schema.\n\n${args.text || ""}`,
  }];
  if (args.fileId) content.push({ type: "input_file", file_id: args.fileId });
  const response = await openAIFetch(`${OPENAI_API}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: args.model,
      store: false,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      reasoning: { effort: "low" },
      instructions: instructions(args.hints),
      input: [{ role: "user", content }],
      text: { verbosity: "low", format: { type: "json_schema", name: "cybrid_title_packet_extraction", strict: true, schema: extractionSchema } },
    }),
  });
  const data = await response.json() as { output_text?: string; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>; usage?: unknown };
  const output = extractOutputText(data);
  try {
    return { raw: JSON.parse(output) as RawTitlePacketExtraction, modelMs: Date.now() - started, usage: data.usage };
  } catch {
    throw new Error("OpenAI title extraction returned output that could not be parsed as the extraction schema.");
  }
}

export async function extractPdfTitlePacket(buffer: ArrayBuffer, sourceFile: string, prepared: PreparedPacket, hints: ExtractionHints = {}): Promise<ExtractedTitlePacket> {
  const model = titleExtractionModel();
  let result: { raw: RawTitlePacketExtraction; modelMs: number; usage: unknown };
  let extractionMode: "native-text" | "openai-pdf-vision";

  if (prepared.extractionMode === "native-text" && prepared.pageDelimitedText) {
    extractionMode = "native-text";
    result = await responseExtraction({ text: prepared.pageDelimitedText, hints, model });
  } else {
    extractionMode = "openai-pdf-vision";
    const fileId = await uploadPdf(buffer, sourceFile);
    try { result = await responseExtraction({ fileId, hints, model }); } finally { await deleteFile(fileId); }
  }

  const ledger = buildEvidenceLedger({
    packetHash: prepared.packetHash,
    sourceFile,
    pageCount: prepared.ledger.pageCount,
    extractionMode,
    extraction: result.raw,
    nativeLedger: prepared.ledger,
  });

  console.info("CYBRID_TITLE_EXTRACTION_MODEL_COMPLETE", JSON.stringify({
    sourceFile,
    packetHash: prepared.packetHash,
    model,
    extractionMode,
    pageCount: prepared.ledger.pageCount,
    evidenceNodes: ledger.evidence.length,
    runSheetDetected: result.raw.runSheet.detected,
    modelMs: result.modelMs,
    usage: result.usage,
  }));

  return { extraction: result.raw, ledger, model, modelMs: result.modelMs };
}
