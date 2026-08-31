import type { CanonicalInstrument, CanonicalReference, CanonicalRunSheetEntry, CanonicalTitleRecord, RunSheetSummary } from "./title-domain";
import type { EvidenceRef } from "./vera";

export interface FieldMismatch {
  field: string;
  runSheetValue: string;
  sourceValue: string;
}

export interface ReconciledEntry {
  runSheetEntryId: string;
  sourceInstrumentId: string | null;
  status: "MATCH" | "MISMATCH" | "SOURCE_MISSING";
  mismatches: FieldMismatch[];
  evidence: EvidenceRef[];
  evidenceIds: string[];
}

export interface MissingReference {
  description: string;
  instrumentNumber: string;
  bookPage: string;
  evidence: EvidenceRef[];
  evidenceIds: string[];
}

export interface RunSheetReconciliation {
  runSheetDetected: boolean;
  matched: number;
  mismatched: number;
  sourceMissing: number;
  sourceOmittedFromRunSheet: CanonicalInstrument[];
  referencedButMissing: MissingReference[];
  entries: ReconciledEntry[];
  summary: string;
}

function clean(value: string): string {
  const text = String(value || "").trim();
  return text && !/^needs review$/i.test(text) ? text : "";
}

function alnum(value: string): string {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeText(value: string): string {
  return clean(value).toLowerCase().replace(/[“”‘’]/g, "'").replace(/[^a-z0-9$#./' -]+/g, " ").replace(/\s+/g, " ").trim();
}

function sameInstrumentNumber(a: string, b: string): boolean {
  return Boolean(alnum(a) && alnum(a) === alnum(b));
}

function sameBookPage(a: string, b: string): boolean {
  return Boolean(alnum(a) && alnum(a) === alnum(b));
}

function dateKey(value: string): string {
  const text = clean(value);
  if (!text) return "";
  const numeric = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/);
  if (numeric) {
    const year = numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3];
    return `${year}-${numeric[1].padStart(2, "0")}-${numeric[2].padStart(2, "0")}`;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : normalizeText(text);
}

function moneyKey(value: string): string {
  const text = clean(value).replace(/[$,\s]/g, "");
  const match = text.match(/-?\d+(?:\.\d{1,2})?/);
  return match ? Number(match[0]).toFixed(2) : normalizeText(value);
}

function typeCompatible(a: string, b: string): boolean {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  const groups = [
    /deed of trust|mortgage|security deed/,
    /assignment/,
    /release|satisfaction|reconveyance/,
    /judgment|lien/,
    /trustee|foreclosure/,
    /deed/,
    /plat|survey/,
  ];
  return groups.some((group) => group.test(left) && group.test(right));
}

function partyOverlap(a: string, instrument: CanonicalInstrument): boolean {
  const expected = normalizeText(a);
  if (!expected) return true;
  const names = normalizeText(instrument.parties.map((party) => party.name).join(" "));
  if (!names) return false;
  const tokens = expected.split(" ").filter((token) => token.length > 2);
  return tokens.length ? tokens.filter((token) => names.includes(token)).length / tokens.length >= 0.6 : true;
}

function legalKey(value: string): string {
  return normalizeText(value).replace(/\bthe\b/g, "").replace(/\s+/g, " ").trim();
}

function findSource(entry: CanonicalRunSheetEntry, sources: CanonicalInstrument[]): CanonicalInstrument | undefined {
  const inst = clean(entry.instrumentNumber);
  if (inst) {
    const exact = sources.find((source) => sameInstrumentNumber(inst, source.instrumentNumber));
    if (exact) return exact;
  }
  const bp = clean(entry.bookPage);
  if (bp) {
    const exact = sources.find((source) => sameBookPage(bp, source.bookPage) && typeCompatible(entry.instrumentType, source.type));
    if (exact) return exact;
  }
  const candidates = sources.filter((source) => typeCompatible(entry.instrumentType, source.type));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function mismatch(entry: CanonicalRunSheetEntry, source: CanonicalInstrument): FieldMismatch[] {
  const out: FieldMismatch[] = [];
  const compare = (field: string, runSheetValue: string, sourceValue: string, key: (value: string) => string = normalizeText) => {
    if (!clean(runSheetValue) || !clean(sourceValue)) return;
    if (key(runSheetValue) !== key(sourceValue)) out.push({ field, runSheetValue, sourceValue });
  };
  compare("Instrument Number", entry.instrumentNumber, source.instrumentNumber, alnum);
  compare("Book/Page", entry.bookPage, source.bookPage, alnum);
  compare("Document Date", entry.documentDate, source.documentDate, dateKey);
  compare("Recording Date", entry.recordingDate, source.recordingDate, dateKey);
  compare("Amount", entry.amount, source.amount, moneyKey);
  if (clean(entry.parties) && !partyOverlap(entry.parties, source)) out.push({ field: "Parties", runSheetValue: entry.parties, sourceValue: source.parties.map((party) => `${party.role}: ${party.name}`).join("; ") || "Not stated" });
  const runLegal = legalKey(entry.legalDescription);
  const sourceLegal = legalKey(source.legalDescription);
  if (runLegal && sourceLegal && runLegal !== sourceLegal) out.push({ field: "Legal Description", runSheetValue: entry.legalDescription, sourceValue: source.legalDescription });
  return out;
}

function expectedOnSummary(instrument: CanonicalInstrument): boolean {
  return /deed|mortgage|deed of trust|security deed|assignment|release|satisfaction|reconveyance|judgment|lien|trustee|foreclosure/i.test(instrument.type)
    && !/assessor|tax bill|pacer|bankrupt/i.test(instrument.type);
}

function referenceFound(reference: CanonicalReference, sources: CanonicalInstrument[]): boolean {
  if (clean(reference.instrumentNumber)) return sources.some((source) => sameInstrumentNumber(reference.instrumentNumber, source.instrumentNumber));
  if (clean(reference.bookPage)) return sources.some((source) => sameBookPage(reference.bookPage, source.bookPage));
  return sources.some((source) => typeCompatible(reference.documentType, source.type) && normalizeText(reference.description).split(" ").filter((token) => token.length > 3).some((token) => normalizeText(source.type).includes(token)));
}

function reconcileSummary(record: CanonicalTitleRecord, summarySource: RunSheetSummary, label: "Title summary" | "Run Sheet"): RunSheetReconciliation {
  if (!summarySource.detected) {
    return {
      runSheetDetected: false,
      matched: 0,
      mismatched: 0,
      sourceMissing: 0,
      sourceOmittedFromRunSheet: [],
      referencedButMissing: [],
      entries: [],
      summary: label === "Run Sheet"
        ? "No distinct Run Sheet or Abstractor Sheet was supplied; Run Sheet reconciliation is not applicable."
        : "Opening title summary was not confidently segmented; title-report-to-source reconciliation cannot be completed.",
    };
  }

  const entries = summarySource.entries.map((entry): ReconciledEntry => {
    const source = findSource(entry, record.instruments);
    const evidence = [...entry.evidence, ...(source?.evidence || [])];
    const evidenceIds = [...new Set([...(entry.evidenceIds || []), ...(source?.evidenceIds || [])])];
    if (!source) return { runSheetEntryId: entry.id, sourceInstrumentId: null, status: "SOURCE_MISSING", mismatches: [], evidence, evidenceIds };
    const mismatches = mismatch(entry, source);
    return { runSheetEntryId: entry.id, sourceInstrumentId: source.id, status: mismatches.length ? "MISMATCH" : "MATCH", mismatches, evidence, evidenceIds };
  });

  const matchedSourceIds = new Set(entries.map((entry) => entry.sourceInstrumentId).filter((id): id is string => Boolean(id)));
  const sourceOmittedFromRunSheet = record.instruments.filter((instrument) => expectedOnSummary(instrument) && !matchedSourceIds.has(instrument.id));
  const referencedButMissing = record.references.filter((reference) => !referenceFound(reference, record.instruments)).map((reference) => ({
    description: reference.description,
    instrumentNumber: reference.instrumentNumber,
    bookPage: reference.bookPage,
    evidence: reference.evidence,
    evidenceIds: reference.evidenceIds || [],
  }));
  const matched = entries.filter((entry) => entry.status === "MATCH").length;
  const mismatched = entries.filter((entry) => entry.status === "MISMATCH").length;
  const sourceMissing = entries.filter((entry) => entry.status === "SOURCE_MISSING").length;
  const summary = `${label}: ${entries.length} entr${entries.length === 1 ? "y" : "ies"}; ${matched} matched, ${mismatched} mismatched, ${sourceMissing} missing source; ${sourceOmittedFromRunSheet.length} material source instrument(s) omitted; ${referencedButMissing.length} referenced source document(s) unavailable.`;

  return { runSheetDetected: true, matched, mismatched, sourceMissing, sourceOmittedFromRunSheet, referencedButMissing, entries, summary };
}

/** Reconcile the actual title report/title-search summary to the supplied recorded sources. */
export function reconcileTitleSummary(record: CanonicalTitleRecord): RunSheetReconciliation {
  return reconcileSummary(record, record.titleSummary, "Title summary");
}

/** Reconcile only a distinct supplied Run Sheet/Abstractor Sheet. The title report never triggers this. */
export function reconcileRunSheet(record: CanonicalTitleRecord): RunSheetReconciliation {
  return reconcileSummary(record, record.runSheet, "Run Sheet");
}
