import { createHash } from "node:crypto";
import type { PacketExtractionLedger } from "./document-engine";
import type { EvidenceNode, RawEvidenceAnchor, RawTitlePacketExtraction, TitleEvidenceLedger } from "./title-extraction-model";
import type { EvidenceRef, EvidenceSource } from "./vera";

function normalize(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[“”‘’]/g, "'")
    .replace(/[^a-z0-9$#./' -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fuzzyContained(quote: string, pageText: string): boolean {
  const q = normalize(quote);
  const p = normalize(pageText);
  if (!q || !p) return false;
  if (p.includes(q)) return true;
  const qTokens = q.split(" ").filter((token) => token.length > 1);
  if (qTokens.length < 4) return false;
  const pTokens = new Set(p.split(" ").filter((token) => token.length > 1));
  const matched = qTokens.filter((token) => pTokens.has(token)).length;
  return matched / qTokens.length >= 0.82;
}

function anchorKey(anchor: RawEvidenceAnchor): string {
  return `${anchor.page}|${normalize(anchor.documentType)}|${normalize(anchor.instrumentNumber)}|${normalize(anchor.quote)}`;
}

function evidenceId(packetHash: string, anchor: RawEvidenceAnchor): string {
  return `ev_${createHash("sha256").update(`${packetHash}|${anchorKey(anchor)}`).digest("hex").slice(0, 20)}`;
}

function collectAnchors(raw: RawTitlePacketExtraction): RawEvidenceAnchor[] {
  const out: RawEvidenceAnchor[] = [];
  const add = (anchors?: RawEvidenceAnchor[]) => { if (anchors?.length) out.push(...anchors); };
  Object.values(raw.header).forEach((fact) => add(fact.evidence));
  add(raw.runSheet.evidence);
  raw.runSheet.entries.forEach((entry) => add(entry.evidence));
  raw.instruments.forEach((instrument) => add(instrument.evidence));
  raw.references.forEach((reference) => add(reference.evidence));
  Object.values(raw.taxes).forEach((fact) => add(fact.evidence));
  Object.values(raw.flags).forEach((fact) => add(fact.evidence));
  add(raw.targetLienHint.instrumentNumber.evidence);
  add(raw.targetLienHint.position.evidence);
  return out;
}

function sourceForMode(mode: TitleEvidenceLedger["extractionMode"]): EvidenceSource {
  if (mode === "native-text") return "native";
  if (mode === "pasted-text") return "pasted";
  return "openai-file";
}

export function buildEvidenceLedger(args: {
  packetHash: string;
  sourceFile: string;
  pageCount: number;
  extractionMode: TitleEvidenceLedger["extractionMode"];
  extraction: RawTitlePacketExtraction;
  nativeLedger?: PacketExtractionLedger;
}): TitleEvidenceLedger {
  const source = sourceForMode(args.extractionMode);
  const seen = new Set<string>();
  const evidence: EvidenceNode[] = [];

  for (const anchor of collectAnchors(args.extraction)) {
    if (!anchor.quote?.trim() || !anchor.page || anchor.page < 1) continue;
    const key = anchorKey(anchor);
    if (seen.has(key)) continue;
    seen.add(key);
    const nativePage = args.nativeLedger?.pages.find((page) => page.page === anchor.page);
    const nativeVerified = source === "native" && Boolean(nativePage && !nativePage.needsVisualReview && fuzzyContained(anchor.quote, nativePage.text));
    evidence.push({
      id: evidenceId(args.packetHash, anchor),
      packetHash: args.packetHash,
      sourceFile: args.sourceFile,
      page: anchor.page,
      quote: anchor.quote.trim(),
      documentType: anchor.documentType?.trim() || "Unclassified",
      instrumentNumber: anchor.instrumentNumber?.trim() || undefined,
      source,
      confidence: Math.max(0, Math.min(1, Number.isFinite(anchor.confidence) ? anchor.confidence : 0.5)),
      nativeVerified,
    });
  }

  const runSheetPages = args.extraction.runSheet.detected && args.extraction.runSheet.pageStart > 0
    ? Array.from({ length: Math.max(1, args.extraction.runSheet.pageEnd - args.extraction.runSheet.pageStart + 1) }, (_, offset) => args.extraction.runSheet.pageStart + offset)
    : [];

  return {
    version: 1,
    packetHash: args.packetHash,
    sourceFile: args.sourceFile,
    pageCount: args.pageCount,
    extractionMode: args.extractionMode,
    evidence,
    runSheetPages,
    createdAt: new Date().toISOString(),
  };
}

export function evidenceNodeForAnchor(ledger: TitleEvidenceLedger, anchor: RawEvidenceAnchor): EvidenceNode | undefined {
  const id = evidenceId(ledger.packetHash, anchor);
  return ledger.evidence.find((item) => item.id === id);
}

export function evidenceRefsForAnchors(ledger: TitleEvidenceLedger, anchors: RawEvidenceAnchor[]): { refs: EvidenceRef[]; ids: string[] } {
  const nodes = anchors.map((anchor) => evidenceNodeForAnchor(ledger, anchor)).filter((node): node is EvidenceNode => Boolean(node));
  return {
    refs: nodes.map((node) => ({
      quote: node.quote,
      page: node.page,
      documentType: node.documentType,
      source: node.source,
      sourceFile: node.sourceFile,
      confidence: node.confidence,
      instrumentNumber: node.instrumentNumber,
    })),
    ids: nodes.map((node) => node.id),
  };
}

export function ledgerEvidenceByIds(ledger: TitleEvidenceLedger, ids: string[]): EvidenceRef[] {
  const wanted = new Set(ids);
  return ledger.evidence.filter((node) => wanted.has(node.id)).map((node) => ({
    quote: node.quote,
    page: node.page,
    documentType: node.documentType,
    source: node.source,
    sourceFile: node.sourceFile,
    confidence: node.confidence,
    instrumentNumber: node.instrumentNumber,
  }));
}

export function validateEvidenceIds(ledger: TitleEvidenceLedger, ids: string[]): boolean {
  const known = new Set(ledger.evidence.map((node) => node.id));
  return ids.every((id) => known.has(id));
}
