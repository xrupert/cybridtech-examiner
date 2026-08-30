import { createHash } from "node:crypto";
import { get, put } from "@vercel/blob";

export type ExtractionMode = "native-text" | "openai-pdf-fallback";

export interface ExtractedPage {
  page: number;
  text: string;
  charCount: number;
  documentHint: string;
  needsVisualReview: boolean;
}

export interface PacketExtractionLedger {
  version: 2;
  packetHash: string;
  sourceFile: string;
  pageCount: number;
  totalCharacters: number;
  textCoverage: number;
  usableTextPages: number;
  lowTextPages: number[];
  nativeTextReady: boolean;
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

const CACHE_PREFIX = "cybrid-title/extraction-ledgers-v2";
const MIN_PAGE_CHARS = 80;
const MIN_PACKET_CHARS = 2000;
const MIN_NATIVE_COVERAGE = 0.90;

export function hashPacket(buffer: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(buffer)).digest("hex");
}

function cachePath(packetHash: string): string {
  return `${CACHE_PREFIX}/${packetHash}.json`;
}

function compactWhitespace(value: string): string {
  return value.replace(/\u0000/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
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
  if (/title report|search effective|client order/.test(value)) return "Title Report";
  return "Unclassified";
}

async function loadCachedLedger(packetHash: string): Promise<PacketExtractionLedger | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const result = await get(cachePath(packetHash), { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const payload = await new Response(result.stream).json() as PacketExtractionLedger;
    if (payload?.version !== 2 || payload.packetHash !== packetHash || !Array.isArray(payload.pages)) return null;
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
  const root = globalThis as typeof globalThis & {
    DOMMatrix?: unknown;
    ImageData?: unknown;
    Path2D?: unknown;
  };
  if (root.DOMMatrix && root.ImageData && root.Path2D) return;

  const canvas = await import("@napi-rs/canvas");
  if (!root.DOMMatrix) root.DOMMatrix = canvas.DOMMatrix;
  if (!root.ImageData) root.ImageData = canvas.ImageData;
  if (!root.Path2D) root.Path2D = canvas.Path2D;
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
  let totalCharacters = 0;
  let usableTextPages = 0;

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const rawText = content.items
        .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
        .join(" ");
      const text = compactWhitespace(rawText);
      const charCount = text.length;
      totalCharacters += charCount;
      if (charCount >= MIN_PAGE_CHARS) usableTextPages += 1;
      pages.push({
        page: pageNumber,
        text,
        charCount,
        documentHint: pageHint(text),
        needsVisualReview: charCount < MIN_PAGE_CHARS,
      });
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }

  const pageCount = pages.length;
  const textCoverage = pageCount ? usableTextPages / pageCount : 0;
  const lowTextPages = pages.filter((page) => page.needsVisualReview).map((page) => page.page);
  const nativeTextReady = totalCharacters >= MIN_PACKET_CHARS && textCoverage >= MIN_NATIVE_COVERAGE;

  return {
    version: 2,
    packetHash,
    sourceFile,
    pageCount,
    totalCharacters,
    textCoverage,
    usableTextPages,
    lowTextPages,
    nativeTextReady,
    pages,
    extractedAt: new Date().toISOString(),
  };
}

function pageDelimitedText(ledger: PacketExtractionLedger): string {
  return ledger.pages
    .map((page) => `=== PDF PAGE ${page.page} | ${page.documentHint} ===\n${page.text || "[NO RELIABLE NATIVE TEXT — VISUAL REVIEW REQUIRED]"}`)
    .join("\n\n");
}

export async function preparePdfPacket(buffer: ArrayBuffer, sourceFile: string): Promise<PreparedPacket> {
  const started = Date.now();
  const packetHash = hashPacket(buffer);
  const cached = await loadCachedLedger(packetHash);
  if (cached) {
    console.info("CYBRID_TITLE_EXTRACTION_CACHE_HIT", JSON.stringify({ packetHash, sourceFile, pageCount: cached.pageCount, textCoverage: cached.textCoverage }));
    return {
      packetHash,
      ledger: cached,
      cacheHit: true,
      extractionMode: cached.nativeTextReady ? "native-text" : "openai-pdf-fallback",
      pageDelimitedText: cached.nativeTextReady ? pageDelimitedText(cached) : undefined,
      extractionMs: Date.now() - started,
    };
  }

  let ledger: PacketExtractionLedger;
  try {
    ledger = await extractNativePdfText(buffer, sourceFile, packetHash);
  } catch (error) {
    console.warn("CYBRID_TITLE_NATIVE_EXTRACTION_FAILED", JSON.stringify({ packetHash, sourceFile, message: error instanceof Error ? error.message : "unknown" }));
    ledger = {
      version: 2,
      packetHash,
      sourceFile,
      pageCount: 0,
      totalCharacters: 0,
      textCoverage: 0,
      usableTextPages: 0,
      lowTextPages: [],
      nativeTextReady: false,
      pages: [],
      extractedAt: new Date().toISOString(),
    };
  }

  await saveLedger(ledger);
  const extractionMode: ExtractionMode = ledger.nativeTextReady ? "native-text" : "openai-pdf-fallback";
  console.info("CYBRID_TITLE_EXTRACTION_COMPLETE", JSON.stringify({ packetHash, sourceFile, pageCount: ledger.pageCount, totalCharacters: ledger.totalCharacters, textCoverage: Number(ledger.textCoverage.toFixed(3)), lowTextPages: ledger.lowTextPages.length, extractionMode, ms: Date.now() - started }));

  return {
    packetHash,
    ledger,
    cacheHit: false,
    extractionMode,
    pageDelimitedText: ledger.nativeTextReady ? pageDelimitedText(ledger) : undefined,
    extractionMs: Date.now() - started,
  };
}
