import { checkpoint } from "./durable-jobs";
import { createHash } from "node:crypto";
import type { ExtractedPage, PreparedPacket } from "./document-engine";
import { extractPdfTitlePacket, titleExtractionModel } from "./openai-title-extractor";
import { buildEvidenceLedger } from "./title-evidence-ledger";
import type {
  ExtractedTitlePacket,
  RawEvidenceAnchor,
  RawFact,
  RawInstrument,
  RawReference,
  RawRunSheetEntry,
  RawTitlePacketExtraction,
} from "./title-extraction-model";

const DEFAULT_SHARD_PAGE_LIMIT = 72;
const DEFAULT_SHARD_CHAR_LIMIT = 220_000;
const DEFAULT_SHARD_CONCURRENCY = 3;
const DEFAULT_SHARD_THRESHOLD_PAGES = 140;
const DEFAULT_SHARD_THRESHOLD_CHARS = 420_000;
const OVERLAP_PAGES = 2;

function numberEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}

function shardPageLimit() { return numberEnv("VERA_SHARD_PAGE_LIMIT", DEFAULT_SHARD_PAGE_LIMIT, 20, 150); }
function shardCharLimit() { return numberEnv("VERA_SHARD_CHAR_LIMIT", DEFAULT_SHARD_CHAR_LIMIT, 50_000, 600_000); }
function shardConcurrency() { return numberEnv("VERA_SHARD_CONCURRENCY", DEFAULT_SHARD_CONCURRENCY, 1, 6); }
function thresholdPages() { return numberEnv("VERA_SHARD_THRESHOLD_PAGES", DEFAULT_SHARD_THRESHOLD_PAGES, 60, 400); }
function thresholdChars() { return numberEnv("VERA_SHARD_THRESHOLD_CHARS", DEFAULT_SHARD_THRESHOLD_CHARS, 150_000, 1_000_000); }

function compact(value: string): string {
  return String(value || "").replace(/\u0000/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function normalized(value: string): string {
  return compact(value).toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function emptyValue(value: string): boolean {
  const v = normalized(value);
  return !v || ["NOT STATED", "NEEDS REVIEW", "UNKNOWN", "NOT PROVIDED", "N A", "NA"].includes(v);
}

function anchorsKey(anchor: RawEvidenceAnchor): string {
  return `${anchor.page}|${normalized(anchor.documentType)}|${normalized(anchor.instrumentNumber)}|${normalized(anchor.quote)}`;
}

function uniqueAnchors(values: RawEvidenceAnchor[]): RawEvidenceAnchor[] {
  const seen = new Set<string>();
  return values.filter((anchor) => {
    const key = anchorsKey(anchor);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.page - b.page || b.confidence - a.confidence);
}

function bestFact(facts: RawFact[]): RawFact {
  const usable = facts.filter((fact) => !emptyValue(fact.value) || fact.evidence.length);
  if (!usable.length) return { value: "Not Stated", evidence: [] };
  const groups = new Map<string, RawFact[]>();
  for (const fact of usable) {
    const key = normalized(fact.value);
    if (!key || emptyValue(fact.value)) continue;
    const list = groups.get(key) || [];
    list.push(fact);
    groups.set(key, list);
  }
  if (!groups.size) return { value: "Not Stated", evidence: uniqueAnchors(usable.flatMap((fact) => fact.evidence)) };
  const ranked = [...groups.entries()].map(([key, values]) => ({
    key,
    values,
    evidence: uniqueAnchors(values.flatMap((fact) => fact.evidence)),
    confidence: Math.max(...values.flatMap((fact) => fact.evidence.map((e) => e.confidence)), 0),
  })).sort((a, b) => b.evidence.length - a.evidence.length || b.confidence - a.confidence);
  if (ranked.length > 1 && ranked[0].evidence.length === ranked[1].evidence.length && Math.abs(ranked[0].confidence - ranked[1].confidence) < 0.08) {
    return { value: "Needs review", evidence: uniqueAnchors(ranked.slice(0, 3).flatMap((group) => group.evidence)) };
  }
  const winner = ranked[0];
  const source = winner.values.find((fact) => !emptyValue(fact.value)) || winner.values[0];
  return { value: source.value, evidence: winner.evidence };
}

function bestString(values: string[]): string {
  const usable = values.filter((value) => !emptyValue(value));
  if (!usable.length) return "Not Stated";
  const counts = new Map<string, { original: string; count: number }>();
  for (const value of usable) {
    const key = normalized(value);
    const current = counts.get(key);
    counts.set(key, { original: current?.original || value, count: (current?.count || 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || b.original.length - a.original.length)[0]?.original || "Not Stated";
}

function instrumentKey(instrument: RawInstrument): string {
  if (!emptyValue(instrument.instrumentNumber)) return `NUM:${normalized(instrument.instrumentNumber)}`;
  if (!emptyValue(instrument.bookPage)) return `BOOK:${normalized(instrument.type)}:${normalized(instrument.bookPage)}`;
  const firstPage = instrument.evidence.map((e) => e.page).filter(Boolean).sort((a, b) => a - b)[0] || 0;
  return `PAGE:${normalized(instrument.type)}:${firstPage}:${normalized(instrument.documentDate)}`;
}

function mergeInstrument(group: RawInstrument[]): RawInstrument {
  const evidence = uniqueAnchors(group.flatMap((item) => item.evidence));
  const parties = new Map<string, { name: string; role: string }>();
  group.flatMap((item) => item.parties).forEach((party) => {
    const key = `${normalized(party.role)}|${normalized(party.name)}`;
    if (!parties.has(key)) parties.set(key, party);
  });
  return {
    type: bestString(group.map((item) => item.type)),
    instrumentNumber: bestString(group.map((item) => item.instrumentNumber)),
    bookPage: bestString(group.map((item) => item.bookPage)),
    documentDate: bestString(group.map((item) => item.documentDate)),
    recordingDate: bestString(group.map((item) => item.recordingDate)),
    amount: bestString(group.map((item) => item.amount)),
    status: bestString(group.map((item) => item.status)),
    parties: [...parties.values()],
    propertyAddress: bestString(group.map((item) => item.propertyAddress)),
    legalDescription: bestString(group.map((item) => item.legalDescription)),
    referencedInstrumentNumbers: [...new Set(group.flatMap((item) => item.referencedInstrumentNumbers).filter((value) => !emptyValue(value)))],
    evidence,
  };
}

function mergeInstruments(values: RawInstrument[]): RawInstrument[] {
  const groups = new Map<string, RawInstrument[]>();
  for (const item of values) {
    const key = instrumentKey(item);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].map(mergeInstrument).sort((a, b) => {
    const ap = a.evidence[0]?.page || Number.MAX_SAFE_INTEGER;
    const bp = b.evidence[0]?.page || Number.MAX_SAFE_INTEGER;
    return ap - bp || normalized(a.instrumentNumber).localeCompare(normalized(b.instrumentNumber));
  });
}

function runSheetEntryKey(item: RawRunSheetEntry): string {
  if (!emptyValue(item.instrumentNumber)) return `NUM:${normalized(item.instrumentNumber)}:${normalized(item.category)}`;
  return `${normalized(item.category)}|${normalized(item.instrumentType)}|${normalized(item.bookPage)}|${item.evidence[0]?.page || 0}`;
}

function mergeRunSheetEntries(values: RawRunSheetEntry[]): RawRunSheetEntry[] {
  const map = new Map<string, RawRunSheetEntry>();
  for (const item of values) {
    const key = runSheetEntryKey(item);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...item, evidence: uniqueAnchors(item.evidence) });
      continue;
    }
    map.set(key, {
      category: bestString([existing.category, item.category]),
      instrumentType: bestString([existing.instrumentType, item.instrumentType]),
      instrumentNumber: bestString([existing.instrumentNumber, item.instrumentNumber]),
      bookPage: bestString([existing.bookPage, item.bookPage]),
      documentDate: bestString([existing.documentDate, item.documentDate]),
      recordingDate: bestString([existing.recordingDate, item.recordingDate]),
      amount: bestString([existing.amount, item.amount]),
      parties: bestString([existing.parties, item.parties]),
      legalDescription: bestString([existing.legalDescription, item.legalDescription]),
      evidence: uniqueAnchors([...existing.evidence, ...item.evidence]),
    });
  }
  return [...map.values()].sort((a, b) => (a.evidence[0]?.page || 999999) - (b.evidence[0]?.page || 999999));
}

function referenceKey(item: RawReference): string {
  return `${normalized(item.documentType)}|${normalized(item.instrumentNumber)}|${normalized(item.bookPage)}|${normalized(item.description)}`;
}

function mergeReferences(values: RawReference[]): RawReference[] {
  const map = new Map<string, RawReference>();
  for (const item of values) {
    const key = referenceKey(item);
    const existing = map.get(key);
    map.set(key, existing ? { ...existing, evidence: uniqueAnchors([...existing.evidence, ...item.evidence]) } : { ...item, evidence: uniqueAnchors(item.evidence) });
  }
  return [...map.values()];
}

function mergeExtractions(parts: RawTitlePacketExtraction[]): RawTitlePacketExtraction {
  const fact = (picker: (part: RawTitlePacketExtraction) => RawFact) => bestFact(parts.map(picker));
  const detected = parts.filter((part) => part.runSheet.detected);
  const pageStarts = detected.map((part) => part.runSheet.pageStart).filter((value) => value > 0);
  const pageEnds = detected.map((part) => part.runSheet.pageEnd).filter((value) => value > 0);
  return {
    header: {
      orderNumber: fact((p) => p.header.orderNumber),
      tsNumber: fact((p) => p.header.tsNumber),
      searchType: fact((p) => p.header.searchType),
      state: fact((p) => p.header.state),
      county: fact((p) => p.header.county),
      propertyAddress: fact((p) => p.header.propertyAddress),
      parcelId: fact((p) => p.header.parcelId),
      effectiveDate: fact((p) => p.header.effectiveDate),
      legalDescription: fact((p) => p.header.legalDescription),
      borrower: fact((p) => p.header.borrower),
      currentOwner: fact((p) => p.header.currentOwner),
    },
    runSheet: {
      detected: detected.length > 0,
      pageStart: pageStarts.length ? Math.min(...pageStarts) : 0,
      pageEnd: pageEnds.length ? Math.max(...pageEnds) : 0,
      basis: detected.length ? "Merged from page-addressable extraction shards; physical page citations remain original PDF pages." : "No opening title-summary/run-sheet section was established in the extraction shards.",
      evidence: uniqueAnchors(parts.flatMap((part) => part.runSheet.evidence)),
      entries: mergeRunSheetEntries(parts.flatMap((part) => part.runSheet.entries)),
    },
    instruments: mergeInstruments(parts.flatMap((part) => part.instruments)),
    references: mergeReferences(parts.flatMap((part) => part.references)),
    taxes: {
      status: fact((p) => p.taxes.status),
      fiscalYear: fact((p) => p.taxes.fiscalYear),
      landValue: fact((p) => p.taxes.landValue),
      improvements: fact((p) => p.taxes.improvements),
    },
    flags: {
      hoa: fact((p) => p.flags.hoa),
      ccrs: fact((p) => p.flags.ccrs),
      federalTaxLien: fact((p) => p.flags.federalTaxLien),
      bankruptcy: fact((p) => p.flags.bankruptcy),
      plat: fact((p) => p.flags.plat),
      mers: fact((p) => p.flags.mers),
      min: fact((p) => p.flags.min),
    },
    targetLienHint: {
      instrumentNumber: fact((p) => p.targetLienHint.instrumentNumber),
      position: fact((p) => p.targetLienHint.position),
    },
    extractionSummary: `Merged ${parts.length} bounded page-addressable extraction shards. Duplicate instruments and title-summary entries were reconciled deterministically by recorded identifiers and evidence anchors.`,
  };
}

function pageText(page: ExtractedPage): string {
  const marker = `=== PDF PAGE ${page.page} | ${page.documentHint} | TEXT SOURCE ${page.textSource} ===`;
  if (page.textSource === "blank") return `${marker}\n[BLANK OR SEPARATOR PAGE]`;
  if (!page.text?.trim()) return `${marker}\n[UNREADABLE PAGE ${page.page} — MANUAL REVIEW REQUIRED; DO NOT INFER CONTENT]`;
  return `${marker}\n${page.text}`;
}

export function makeShards(pages: ExtractedPage[]): ExtractedPage[][] {
  const base: ExtractedPage[][] = [];
  let current: ExtractedPage[] = [];
  let chars = 0;
  for (const page of pages) {
    const textChars = page.text.length + 150;
    if (current.length && (current.length >= shardPageLimit() || chars + textChars > shardCharLimit())) {
      base.push(current);
      const overlap = current.slice(-OVERLAP_PAGES);
      current = [...overlap];
      chars = overlap.reduce((sum, item) => sum + item.text.length + 150, 0);
    }
    current.push(page);
    chars += textChars;
  }
  if (current.length) base.push(current);
  return base;
}

function shardPrepared(original: PreparedPacket, pages: ExtractedPage[]): PreparedPacket {
  return {
    ...original,
    cacheHit: false,
    extractionMode: original.extractionMode === "native-text" ? "native-text" : "hybrid-page-ocr",
    pageDelimitedText: pages.map(pageText).join("\n\n"),
  };
}

export async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  };
  const settled = await Promise.allSettled(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => worker()));
  const failure = settled.find((item) => item.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return results;
}

export function shouldShardTitlePacket(prepared: PreparedPacket): boolean {
  const chars = prepared.ledger.pages.reduce((sum, page) => sum + page.text.length, 0);
  return prepared.ledger.pageCount >= thresholdPages() || chars >= thresholdChars();
}

export async function extractPdfTitlePacketScalable(
  buffer: ArrayBuffer,
  sourceFile: string,
  prepared: PreparedPacket,
  hints: { requestedState?: string; requestedSearchType?: string } = {},
): Promise<ExtractedTitlePacket> {
  const cacheKey = (value: string) => `extraction-v1:${titleExtractionModel()}:${createHash("sha256").update(JSON.stringify(hints)).update(value).digest("hex")}`;
  if (!shouldShardTitlePacket(prepared)) return checkpoint(cacheKey(prepared.pageDelimitedText || prepared.packetHash), () => extractPdfTitlePacket(buffer, sourceFile, prepared, hints));

  const shards = makeShards(prepared.ledger.pages);
  const outputs = await mapConcurrent(shards, shardConcurrency(), async (pages, index) => {
    const part = shardPrepared(prepared, pages);
    const result = await checkpoint(cacheKey(part.pageDelimitedText || ""), () => extractPdfTitlePacket(buffer, `${sourceFile} [shard ${index + 1}/${shards.length}]`, part, hints));
    return result;
  });
  const merged = mergeExtractions(outputs.map((item) => item.extraction));
  const extractionMode = prepared.ledger.ocrRecoveredPages.length || prepared.ledger.lowTextPages.length || prepared.ledger.ocrSkippedPages.length
    ? "hybrid-page-ocr" as const
    : "native-text" as const;
  const ledger = buildEvidenceLedger({
    packetHash: prepared.packetHash,
    sourceFile,
    pageCount: prepared.ledger.pageCount,
    extractionMode,
    extraction: merged,
    nativeLedger: prepared.ledger,
  });
  const modelMs = outputs.reduce((sum, item) => sum + item.modelMs, 0);
  console.info("CYBRID_TITLE_SHARDED_EXTRACTION_COMPLETE", JSON.stringify({
    sourceFile,
    packetHash: prepared.packetHash,
    pageCount: prepared.ledger.pageCount,
    shards: shards.length,
    shardConcurrency: shardConcurrency(),
    model: titleExtractionModel(),
    aggregateModelMs: modelMs,
    evidenceNodes: ledger.evidence.length,
  }));
  return { extraction: merged, ledger, model: `${titleExtractionModel()} x${shards.length} shards`, modelMs };
}
