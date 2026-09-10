import { createHash } from "node:crypto";
import type { TitleReviewResult } from "./title-domain";
import type { TitleEvidenceLedger } from "./title-extraction-model";

export type TitleGraphNodeType = "PACKET" | "PROPERTY" | "INSTRUMENT" | "PARTY" | "REPORT_ENTRY" | "EVIDENCE" | "CHECK" | "EXTERNAL_REFERENCE";
export type TitleGraphEdgeType = "CONTAINS" | "AFFECTS_PROPERTY" | "HAS_PARTY" | "REFERENCES" | "REPORTS_INSTRUMENT" | "REPORTS_UNRESOLVED" | "SUPPORTED_BY" | "CHECK_SUPPORTED_BY" | "TARGET_LIEN" | "ASSIGNOR" | "ASSIGNEE";

export interface TitleGraphNode {
  id: string;
  type: TitleGraphNodeType;
  label: string;
  attributes: Record<string, string | number | boolean | null>;
  evidenceIds: string[];
}

export interface TitleGraphEdge {
  id: string;
  from: string;
  to: string;
  type: TitleGraphEdgeType;
  label: string;
  evidenceIds: string[];
}

export interface TitleEvidenceGraph {
  version: 1;
  packetHash: string;
  nodes: TitleGraphNode[];
  edges: TitleGraphEdge[];
  createdAt: string;
}

function norm(value: string): string {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function edgeId(from: string, to: string, type: string, label = ""): string {
  return `edge_${digest(`${from}|${to}|${type}|${label}`)}`;
}

function partyId(name: string): string { return `party_${digest(norm(name))}`; }
function instrumentNodeId(id: string): string { return `instrument_${id}`; }
function evidenceNodeId(id: string): string { return `evidence_${id}`; }

function unique(values?: string[]): string[] { return [...new Set((values || []).filter(Boolean))].sort(); }

export function buildTitleEvidenceGraph(review: TitleReviewResult, ledger: TitleEvidenceLedger): TitleEvidenceGraph {
  const nodes = new Map<string, TitleGraphNode>();
  const edges = new Map<string, TitleGraphEdge>();
  const packetId = `packet_${review.record.packetHash.slice(0, 24)}`;
  const propertyId = `property_${digest(`${norm(review.record.state.value)}|${norm(review.record.county.value)}|${norm(review.record.parcelId.value)}|${norm(review.record.propertyAddress.value)}`)}`;

  const addNode = (node: TitleGraphNode) => {
    const existing = nodes.get(node.id);
    if (!existing) nodes.set(node.id, node);
    else nodes.set(node.id, { ...existing, evidenceIds: unique([...existing.evidenceIds, ...node.evidenceIds]), attributes: { ...existing.attributes, ...node.attributes } });
  };
  const addEdge = (edge: Omit<TitleGraphEdge, "id">) => {
    const id = edgeId(edge.from, edge.to, edge.type, edge.label);
    const existing = edges.get(id);
    edges.set(id, existing ? { ...existing, evidenceIds: unique([...existing.evidenceIds, ...edge.evidenceIds]) } : { id, ...edge, evidenceIds: unique(edge.evidenceIds) });
  };

  addNode({ id: packetId, type: "PACKET", label: review.record.sourceFile, attributes: { packetHash: review.record.packetHash, reviewId: review.record.reviewId }, evidenceIds: [] });
  addNode({ id: propertyId, type: "PROPERTY", label: review.record.propertyAddress.value, attributes: { parcelId: review.record.parcelId.value, state: review.record.state.value, county: review.record.county.value }, evidenceIds: unique(review.record.propertyAddress.evidenceIds) });
  addEdge({ from: packetId, to: propertyId, type: "CONTAINS", label: "packet property", evidenceIds: unique(review.record.propertyAddress.evidenceIds) });

  const byInstrumentNumber = new Map<string, string>();
  for (const instrument of review.record.instruments) {
    const id = instrumentNodeId(instrument.id);
    if (norm(instrument.instrumentNumber)) byInstrumentNumber.set(norm(instrument.instrumentNumber), id);
    addNode({
      id,
      type: "INSTRUMENT",
      label: `${instrument.type}${instrument.instrumentNumber ? ` · ${instrument.instrumentNumber}` : ""}`,
      attributes: {
        instrumentId: instrument.id,
        instrumentType: instrument.type,
        instrumentNumber: instrument.instrumentNumber,
        bookPage: instrument.bookPage,
        documentDate: instrument.documentDate,
        recordingDate: instrument.recordingDate,
        amount: instrument.amount,
        status: instrument.status,
      },
      evidenceIds: unique(instrument.evidenceIds),
    });
    addEdge({ from: packetId, to: id, type: "CONTAINS", label: "packet instrument", evidenceIds: unique(instrument.evidenceIds) });
    addEdge({ from: id, to: propertyId, type: "AFFECTS_PROPERTY", label: "affects property", evidenceIds: unique(instrument.evidenceIds) });

    for (const party of instrument.parties) {
      const pid = partyId(party.name);
      addNode({ id: pid, type: "PARTY", label: party.name, attributes: { name: party.name }, evidenceIds: unique(party.evidenceIds) });
      const role = norm(party.role);
      const type: TitleGraphEdgeType = /ASSIGNOR/.test(role) ? "ASSIGNOR" : /ASSIGNEE/.test(role) ? "ASSIGNEE" : "HAS_PARTY";
      addEdge({ from: id, to: pid, type, label: party.role || "party", evidenceIds: unique([...(instrument.evidenceIds || []), ...(party.evidenceIds || [])]) });
    }
  }

  for (const instrument of review.record.instruments) {
    const from = instrumentNodeId(instrument.id);
    for (const reference of instrument.referencedInstrumentNumbers) {
      const target = byInstrumentNumber.get(norm(reference));
      if (target) {
        addEdge({ from, to: target, type: "REFERENCES", label: `references ${reference}`, evidenceIds: unique(instrument.evidenceIds) });
      } else if (norm(reference)) {
        const id = `external_${digest(norm(reference))}`;
        addNode({ id, type: "EXTERNAL_REFERENCE", label: reference, attributes: { instrumentNumber: reference }, evidenceIds: unique(instrument.evidenceIds) });
        addEdge({ from, to: id, type: "REFERENCES", label: `references ${reference}`, evidenceIds: unique(instrument.evidenceIds) });
      }
    }
  }

  for (const entry of review.record.titleSummary.entries) {
    const id = `report_entry_${digest(entry.id)}`;
    addNode({ id, type: "REPORT_ENTRY", label: `${entry.instrumentType || entry.category} · ${entry.instrumentNumber || "unidentified"}`, attributes: { category: entry.category, instrumentType: entry.instrumentType, instrumentNumber: entry.instrumentNumber, recordingDate: entry.recordingDate, amount: entry.amount }, evidenceIds: unique(entry.evidenceIds) });
    addEdge({ from: packetId, to: id, type: "CONTAINS", label: "title report entry", evidenceIds: unique(entry.evidenceIds) });
    const target = byInstrumentNumber.get(norm(entry.instrumentNumber));
    if (target) addEdge({ from: id, to: target, type: "REPORTS_INSTRUMENT", label: "report/source match candidate", evidenceIds: unique(entry.evidenceIds) });
    else addEdge({ from: id, to: propertyId, type: "REPORTS_UNRESOLVED", label: "report entry lacks matched supplied instrument", evidenceIds: unique(entry.evidenceIds) });
  }

  for (const evidence of ledger.evidence) {
    const id = evidenceNodeId(evidence.id);
    addNode({ id, type: "EVIDENCE", label: `Page ${evidence.page} · ${evidence.documentType}`, attributes: { page: evidence.page, quote: evidence.quote, documentType: evidence.documentType, instrumentNumber: evidence.instrumentNumber || "", confidence: evidence.confidence, verificationSource: evidence.verificationSource || "", textVerified: evidence.textVerified }, evidenceIds: [evidence.id] });
  }

  for (const instrument of review.record.instruments) {
    const iid = instrumentNodeId(instrument.id);
    for (const evidenceId of instrument.evidenceIds || []) {
      if (nodes.has(evidenceNodeId(evidenceId))) addEdge({ from: iid, to: evidenceNodeId(evidenceId), type: "SUPPORTED_BY", label: "instrument evidence", evidenceIds: [evidenceId] });
    }
  }

  for (const check of review.qc.checks) {
    const id = `check_${digest(check.id)}`;
    addNode({ id, type: "CHECK", label: check.legacyQuestionNumber ? `VERA Q${check.legacyQuestionNumber} · ${check.label}` : check.label, attributes: { checkId: check.id, status: check.status, critical: check.critical, severity: check.severity, summary: check.summary }, evidenceIds: unique(check.evidenceIds) });
    addEdge({ from: packetId, to: id, type: "CONTAINS", label: "review check", evidenceIds: unique(check.evidenceIds) });
    for (const evidenceId of check.evidenceIds || []) {
      if (nodes.has(evidenceNodeId(evidenceId))) addEdge({ from: id, to: evidenceNodeId(evidenceId), type: "CHECK_SUPPORTED_BY", label: "check evidence", evidenceIds: [evidenceId] });
    }
  }

  if (review.record.targetLien.instrumentId) {
    const target = instrumentNodeId(review.record.targetLien.instrumentId);
    if (nodes.has(target)) addEdge({ from: propertyId, to: target, type: "TARGET_LIEN", label: "selected target lien", evidenceIds: unique(review.record.targetLien.instrumentNumber.evidenceIds) });
  }

  return {
    version: 1,
    packetHash: review.record.packetHash,
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    createdAt: new Date().toISOString(),
  };
}
