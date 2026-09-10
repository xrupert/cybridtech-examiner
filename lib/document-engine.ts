import { createHash } from "node:crypto";
import { get, put } from "@vercel/blob";
import { ocrPageImage, type PageOcrAttempt, type PageOcrProvider } from "./page-ocr";

export type ExtractionMode = "native-text" | "hybrid-page-ocr" | "openai-pdf-fallback";
export type DetectedSearchType = "Foreclosure" | "2nd Lien" | "Current Owner Search" | "Two Owner Search";
export type PageTextSource = "native" | PageOcrProvider | "blank" | "unresolved";

export interface SearchTypeDetection {
  searchType: DetectedSearchType | null;
  confidence: "high" | "low";
  evidence: string;
}

export interface ExtractedPage {
  page: number;
  text: string;
  charCount: number;
  nativeCharCount: number;
  documentHint: string;
  textSource: PageTextSource;
  confidence: number;
  inkRatio?: number;
  ocrAttempts: PageOcrAttempt[];
  needsVisualReview: boolean;
}

export interface PacketExtractionLedger {
  version: 4;
  packetHash: string;
  sourceFile: string;
  pageCount: number;
  totalCharacters: number;
  nativeTotalCharacters: number;
  textCoverage: number;
  nativeTextCoverage: number;
  usableTextPages: number;
  nativeUsableTextPages: number;
  effectiveTextPages: number;
  initialLowTextPages: number[];
  lowTextPages: number[];
  ocrRecoveredPages: number[];
  ocrSkippedPages: number[];
  blankPages: number[];
  ocrProvidersUsed: PageOcrProvider[];
  nativeTextReady: boolean;
  pageTextReady: boolean;
  pages: ExtractedPage[];
  extractedAt: string;
}

export interface PreparedPacket {
  packetHash: string;
  ledger: PacketExtractionLedger;
  cacheHit: boolean;
  extractionMode: ExtractionMode;
  pageDelimitedText?: string;
  extractionMs: number;
}

const CACHE_PREFIX = "cybrid-title/extraction-ledgers-v4";
const MIN_PAGE_CHARS = 80;
const MIN_PACKET_CHARS = 2000;
const MIN_NATIVE_COVERAGE = 0.90;
const MAX_FRONT_SUMMARY_PAGE = 8;
const DEFAULT_OCR_RENDER_SCALE = 2.75;
const DEFAULT_MAX_OCR_PAGES = 80;
const DEFAULT_OCR_CONCURRENCY = 2;
const DEFAULT_BLANK_INK_RATIO = 0.0008;

export function hashPacket(buffer: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(buffer)).digest("hex");
}

function cachePath(packetHash: string): string {
  return `${CACHE_PREFIX}/${packetHash}.json`;
}

function compactWhitespace(value: string): string {
  return value.replace(/\u0000/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function boundedNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function ocrRenderScale(): number {
  return boundedNumber(process.env.CYBRID_OCR_RENDER_SCALE, DEFAULT_OCR_RENDER_SCALE, 1.5, 4);
}

function maxOcrPages(): number {
  return Math.round(boundedNumber(process.env.CYBRID_MAX_OCR_PAGES, DEFAULT_MAX_OCR_PAGES, 1, 500));
}

function ocrConcurrency(): number {
  return Math.round(boundedNumber(process.env.CYBRID_OCR_CONCURRENCY, DEFAULT_OCR_CONCURRENCY, 1, 6));
}

function blankInkRatio(): number {
  return boundedNumber(process.env.CYBRID_BLANK_PAGE_INK_RATIO, DEFAULT_BLANK_INK_RATIO, 0, 0.02);
}

function pageHint(text: string): string {
  const value = text.toLowerCase();
  if (/pacer|bankrupt|chapter 7|chapter 11|chapter 13/.test(value)) return "Bankruptcy / PACER";
  if (/real estate assessment|assessor|tax year|tax ticket|property tax/.test(value)) return "Assessor / Tax";
  if (/trustee'?s deed|substitute trustee|deed of foreclosure/.test(value)) return "Trustee / Foreclosure Deed";
  if (/deed of trust|mortgage/.test(value)) return "Mortgage / Deed of Trust";
  if (/assignment of|assignor|assignee/.test(value)) return "Assignment";
  if (/release|satisfaction|reconveyance/.test(value)) return "Release / Satisfaction";
  if (/judgment|lien|restitution|federal tax lien/.test(value)) return "Judgment / Lien";
  if (/legal description|beginning at|thence/.test(value)) return "Legal Description";
  if (/run sheet|abstractor sheet/.test(value)) return "Run Sheet / Abstractor Sheet";
  if (/title\s*search\s*report|title report|search effective|client order/.test(value)) return "Title Report";
  return "Unclassified";
}

const frontSummarySignals = [
  /title\s*search\s*report/i,
  /run\s*sheet|abstractor\s*sheet|abstractor\s*notes/i,
  /order\s*(?:no\.?|number|#)/i,
  /search\s*type|search\s*cover|search\s*effective/i,
  /property\s*information/i,
  /vesting\s*deed\s*information/i,
  /chain\s*deed\s*information/i,
  /mortgage\s*information/i,
  /assignment\s*1|assignment\s*information/i,
  /tax\s*information/i,
  /judgments?,?\s*liens?\s*information/i,
  /bankruptcy\s*search/i,
  /additional\s*information/i,
  /legal\s*information/i,
];

function frontSummaryScore(text: string): number {
  return frontSummarySignals.reduce((score, signal) => score + Number(signal.test(text)), 0);
}

function markFunctionalRunSheetPages(pages: ExtractedPage[]): void {
  const opening = pages.filter((page) => page.page <= MAX_FRONT_SUMMARY_PAGE);
  if (!opening.length) return;

  const seedIndex = opening.findIndex((page) => /title\s*search\s*report|run\s*sheet|abstractor\s*sheet/i.test(page.text));
  if (seedIndex < 0 || opening[seedIndex].page > 3) return;

  let endIndex = seedIndex;
  let consecutiveNoSignals = 0;
  for (let index = seedIndex; index < opening.length; index += 1) {
    const page = opening[index];
    const score = frontSummaryScore(page.text);
    const abstractorDivider = /abstractor\s*notes/i.test(page.text);

    if (score > 0 || abstractorDivider) {
      endIndex = index;
      consecutiveNoSignals = 0;
      if (abstractorDivider) break;
      continue;
    }

    consecutiveNoSignals += 1;
    if (consecutiveNoSignals >= 2) break;
  }

  for (let index = seedIndex; index <= endIndex; index += 1) {
    opening[index].documentHint = "Run Sheet / Title Summary";
  }
}

function searchTypeFromOpeningText(text: string): SearchTypeDetection {
  const compact = compactWhitespace(text).slice(0, 30000);
  const labeled = compact.match(/\b(?:search\s*type|order\s*type)\s*[:\-]?\s*([^|]{0,80})/i)?.[1] || compact;
  const candidates: Array<{ type: DetectedSearchType; pattern: RegExp }> = [
    { type: "Two Owner Search", pattern: /\b(?:2|two)\s*[- ]?owner(?:\s+search)?\b/i },
    { type: "2nd Lien", pattern: /\b(?:2nd|second)\s*[- ]?lien(?:\s+search)?\b/i },
    { type: "Current Owner Search", pattern: /\bcurrent\s+owner(?:\s+search)?\b/i },
    { type: "Foreclosure", pattern: /\bforeclosure(?:\s+search)?\b/i },
  ];

  for (const candidate of candidates) {
    const match = labeled.match(candidate.pattern);
    if (match) return { searchType: candidate.type, confidence: "high", evidence: match[0] };
  }

  for (const candidate of candidates) {
    const match = compact.match(candidate.pattern);
    if (match) return { searchType: candidate.type, confidence: "high", evidence: match[0] };
  }

  return {
    searchType: null,
    confidence: "low",
    evidence: "No supported order/search type was stated clearly in the opening title-summary pages.",
  };
}

export function detectSearchTypeFromText(text: string): SearchTypeDetection {
  return searchTypeFromOpeningText(text);
}

async function loadCachedLedger(packetHash: string): Promise<PacketExtractionLedger | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const result = await get(cachePath(packetHash), { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const payload = await new Response(result.stream).json() as PacketExtractionLedger;
    if (payload?.version !== 4 || payload.packetHash !== packetHash || !Array.isArray(payload.pages)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function saveLedger(ledger: PacketExtractionLedger): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await put(cachePath(ledger.packetHash), JSON.stringify(ledger), {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json",
    });
  } catch (error) {
    console.warn("CYBRID_TITLE_EXTRACTION_CACHE_WRITE_FAILED", JSON.stringify({
      packetHash: ledger.packetHash,
      message: error instanceof Error ? error.message : "unknown",
    }));
  }
}

async function ensurePdfRuntime(): Promise<void> {
  const root = globalThis as any;
  if (root.DOMMatrix && root.ImageData && root.Path2D) return;

  const canvas = await import("@napi-rs/canvas");
  if (!root.DOMMatrix) root.DOMMatrix = canvas.DOMMatrix;
  if (!root.ImageData) root.ImageData = canvas.ImageData;
  if (!root.Path2D) root.Path2D = canvas.Path2D;
}

function computeInkRatio(data: Uint8ClampedArray): number {
  if (!data.length) return 0;
  let sampled = 0;
  let ink = 0;
  const stride = 4 * 16;
  for (let offset = 0; offset + 3 < data.length; offset += stride) {
    sampled += 1;
    const alpha = data[offset + 3];
    if (alpha > 16 && (data[offset] < 245 || data[offset + 1] < 245 || data[offset + 2] < 245)) ink += 1;
  }
  return sampled ? ink / sampled : 0;
}

async function renderPageForOcr(page: any): Promise<{ image: Buffer; inkRatio: number }> {
  const canvasModule = await import("@napi-rs/canvas");
  const viewport = page.getViewport({ scale: ocrRenderScale() });
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  const canvas = canvasModule.createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
  await page.render({ canvasContext: context as any, viewport, canvas: canvas as any, background: "white" }).promise;
  const inkRatio = computeInkRatio(context.getImageData(0, 0, width, height).data);
  return { image: canvas.toBuffer("image/png"), inkRatio };
}

async function recoverLowTextPages(pdf: any, pages: ExtractedPage[]): Promise<{ skipped: number[] }> {
  const candidates = pages.filter((page) => page.nativeCharCount < MIN_PAGE_CHARS);
  const allowed = candidates.slice(0, maxOcrPages());
  const skipped = candidates.slice(allowed.length).map((page) => page.page);
  let cursor = 0;

  const worker = async () => {
    while (cursor < allowed.length) {
      const index = cursor;
      cursor += 1;
      const target = allowed[index];
      const page = await pdf.getPage(target.page);
      try {
        const rendered = await renderPageForOcr(page);
        target.inkRatio = rendered.inkRatio;
        if (rendered.inkRatio <= blankInkRatio()) {
          target.text = "";
          target.charCount = 0;
          target.textSource = "blank";
          target.confidence = 1;
          target.needsVisualReview = false;
          target.documentHint = "Blank / separator page";
          continue;
        }

        const recovered = await ocrPageImage(rendered.image, target.page);
        target.ocrAttempts = recovered.attempts;
        if (recovered.accepted && recovered.provider) {
          target.text = compactWhitespace(recovered.text);
          target.charCount = target.text.length;
          target.textSource = recovered.provider;
          target.confidence = recovered.confidence;
          target.needsVisualReview = false;
          target.documentHint = pageHint(target.text);
        } else {
          target.textSource = "unresolved";
          target.confidence = 0;
          target.needsVisualReview = true;
        }
      } catch (error) {
        target.textSource = "unresolved";
        target.confidence = 0;
        target.needsVisualReview = true;
        target.ocrAttempts.push({
          provider: "openai-page-vision",
          status: "failed",
          confidence: 0,
          charCount: 0,
          durationMs: 0,
          reason: `Page rendering/recovery failed: ${error instanceof Error ? error.message.slice(0, 500) : "unknown"}`,
        });
      } finally {
        page.cleanup();
      }
    }
  };

  const workers = Array.from({ length: Math.min(ocrConcurrency(), Math.max(1, allowed.length)) }, () => worker());
  await Promise.all(workers);
  return { skipped };
}

async function extractNativePdfText(buffer: ArrayBuffer, sourceFile: string, packetHash: string): Promise<PacketExtractionLedger> {
  await ensurePdfRuntime();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
  });
  const pdf = await loadingTask.promise;
  const pages: ExtractedPage[] = [];
  let nativeTotalCharacters = 0;
  let nativeUsableTextPages = 0;

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const rawText = content.items
        .map((item: any) => ("str" in item && typeof item.str === "string" ? item.str : ""))
        .join(" ");
      const text = compactWhitespace(rawText);
      const charCount = text.length;
      nativeTotalCharacters += charCount;
      if (charCount >= MIN_PAGE_CHARS) nativeUsableTextPages += 1;
      pages.push({
        page: pageNumber,
        text,
        charCount,
        nativeCharCount: charCount,
        documentHint: pageHint(text),
        textSource: "native",
        confidence: charCount >= MIN_PAGE_CHARS ? 1 : 0,
        ocrAttempts: [],
        needsVisualReview: charCount < MIN_PAGE_CHARS,
      });
      page.cleanup();
    }

    const initialLowTextPages = pages.filter((page) => page.needsVisualReview).map((page) => page.page);
    const nativeTextCoverage = pages.length ? nativeUsableTextPages / pages.length : 0;
    const nativeTextReady = nativeTotalCharacters >= MIN_PACKET_CHARS && nativeTextCoverage >= MIN_NATIVE_COVERAGE && initialLowTextPages.length === 0;

    let skipped: number[] = [];
    if (initialLowTextPages.length) {
      const recovery = await recoverLowTextPages(pdf, pages);
      skipped = recovery.skipped;
    }

    markFunctionalRunSheetPages(pages);

    const blankPages = pages.filter((page) => page.textSource === "blank").map((page) => page.page);
    const lowTextPages = pages.filter((page) => page.needsVisualReview).map((page) => page.page);
    const ocrRecoveredPages = pages
      .filter((page) => page.textSource === "tesseract" || page.textSource === "turboocr" || page.textSource === "openai-page-vision")
      .map((page) => page.page);
    const providers = new Set<PageOcrProvider>();
    for (const page of pages) {
      if (page.textSource === "tesseract" || page.textSource === "turboocr" || page.textSource === "openai-page-vision") providers.add(page.textSource);
    }

    const effectiveTextPages = Math.max(0, pages.length - blankPages.length);
    const usableTextPages = pages.filter((page) => page.textSource === "blank" || !page.needsVisualReview).length - blankPages.length;
    const totalCharacters = pages.reduce((sum, page) => sum + page.charCount, 0);
    const textCoverage = effectiveTextPages ? usableTextPages / effectiveTextPages : 1;
    const pageTextReady = totalCharacters >= MIN_PACKET_CHARS && textCoverage >= MIN_NATIVE_COVERAGE && lowTextPages.length === 0;

    return {
      version: 4,
      packetHash,
      sourceFile,
      pageCount: pages.length,
      totalCharacters,
      nativeTotalCharacters,
      textCoverage,
      nativeTextCoverage,
      usableTextPages,
      nativeUsableTextPages,
      effectiveTextPages,
      initialLowTextPages,
      lowTextPages,
      ocrRecoveredPages,
      ocrSkippedPages: skipped,
      blankPages,
      ocrProvidersUsed: Array.from(providers),
      nativeTextReady,
      pageTextReady,
      pages,
      extractedAt: new Date().toISOString(),
    };
  } finally {
    await pdf.destroy();
  }
}

function pageDelimitedText(ledger: PacketExtractionLedger): string {
  return ledger.pages
    .map((page) => {
      const marker = `=== PDF PAGE ${page.page} | ${page.documentHint} | TEXT SOURCE ${page.textSource} ===`;
      if (page.textSource === "blank") return `${marker}\n[BLANK OR SEPARATOR PAGE]`;
      if (!page.text) return `${marker}\n[NO RELIABLE PAGE TEXT — VISUAL REVIEW REQUIRED]`;
      return `${marker}\n${page.text}`;
    })
    .join("\n\n");
}

export function extractionModeForLedger(ledger: PacketExtractionLedger): ExtractionMode {
  if (!ledger.pageTextReady) return "openai-pdf-fallback";
  if (ledger.ocrRecoveredPages.length) return "hybrid-page-ocr";
  return "native-text";
}

export async function preparePdfPacket(buffer: ArrayBuffer, sourceFile: string): Promise<PreparedPacket> {
  const started = Date.now();
  const packetHash = hashPacket(buffer);
  const cached = await loadCachedLedger(packetHash);
  if (cached) {
    const extractionMode = extractionModeForLedger(cached);
    console.info("CYBRID_TITLE_EXTRACTION_CACHE_HIT", JSON.stringify({
      packetHash,
      sourceFile,
      pageCount: cached.pageCount,
      nativeTextCoverage: cached.nativeTextCoverage,
      textCoverage: cached.textCoverage,
      ocrRecoveredPages: cached.ocrRecoveredPages,
      extractionMode,
    }));
    return {
      packetHash,
      ledger: cached,
      cacheHit: true,
      extractionMode,
      pageDelimitedText: cached.pageTextReady ? pageDelimitedText(cached) : undefined,
      extractionMs: Date.now() - started,
    };
  }

  let ledger: PacketExtractionLedger;
  try {
    ledger = await extractNativePdfText(buffer, sourceFile, packetHash);
  } catch (error) {
    console.warn("CYBRID_TITLE_NATIVE_EXTRACTION_FAILED", JSON.stringify({ packetHash, sourceFile, message: error instanceof Error ? error.message : "unknown" }));
    ledger = {
      version: 4,
      packetHash,
      sourceFile,
      pageCount: 0,
      totalCharacters: 0,
      nativeTotalCharacters: 0,
      textCoverage: 0,
      nativeTextCoverage: 0,
      usableTextPages: 0,
      nativeUsableTextPages: 0,
      effectiveTextPages: 0,
      initialLowTextPages: [],
      lowTextPages: [],
      ocrRecoveredPages: [],
      ocrSkippedPages: [],
      blankPages: [],
      ocrProvidersUsed: [],
      nativeTextReady: false,
      pageTextReady: false,
      pages: [],
      extractedAt: new Date().toISOString(),
    };
  }

  await saveLedger(ledger);
  const extractionMode = extractionModeForLedger(ledger);
  console.info("CYBRID_TITLE_EXTRACTION_COMPLETE", JSON.stringify({
    packetHash,
    sourceFile,
    pageCount: ledger.pageCount,
    nativeTotalCharacters: ledger.nativeTotalCharacters,
    totalCharacters: ledger.totalCharacters,
    nativeTextCoverage: Number(ledger.nativeTextCoverage.toFixed(3)),
    textCoverage: Number(ledger.textCoverage.toFixed(3)),
    initialLowTextPages: ledger.initialLowTextPages.length,
    ocrRecoveredPages: ledger.ocrRecoveredPages,
    unresolvedPages: ledger.lowTextPages,
    ocrProvidersUsed: ledger.ocrProvidersUsed,
    extractionMode,
    ms: Date.now() - started,
  }));

  return {
    packetHash,
    ledger,
    cacheHit: false,
    extractionMode,
    pageDelimitedText: ledger.pageTextReady ? pageDelimitedText(ledger) : undefined,
    extractionMs: Date.now() - started,
  };
}

export async function detectPdfSearchType(buffer: ArrayBuffer, sourceFile: string): Promise<SearchTypeDetection> {
  const prepared = await preparePdfPacket(buffer, sourceFile);
  const opening = prepared.ledger.pages
    .filter((page) => page.page <= MAX_FRONT_SUMMARY_PAGE)
    .map((page) => page.text)
    .filter(Boolean)
    .join("\n");
  return searchTypeFromOpeningText(opening);
}
