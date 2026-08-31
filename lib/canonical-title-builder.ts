import { randomUUID } from "node:crypto";
import { evidenceRefsForAnchors } from "./title-evidence-ledger";
import type { RawFact, RawInstrument, RawRunSheetEntry, RawTitlePacketExtraction, TitleEvidenceLedger } from "./title-extraction-model";
import type { CanonicalInstrument, CanonicalReference, CanonicalRunSheetEntry, CanonicalTitleRecord, EvidenceState, EvidenceValue } from "./title-domain";

function clean(value: string): string {
  const text = String(value || "").trim();
  return text && !/^(not stated|not provided|unknown|n\/a)$/i.test(text) ? text : "";
}

function fact(raw: RawFact, ledger: TitleEvidenceLedger, basis: string): EvidenceValue {
  const value = clean(raw.value);
  const mapped = evidenceRefsForAnchors(ledger, raw.evidence || []);
  const matchingNodes = mapped.ids.map((id) => ledger.evidence.find((node) => node.id === id)).filter(Boolean);
  let state: EvidenceState = "NOT_STATED";
  if (value) {
    const strong = matchingNodes.some((node) => node && (node.nativeVerified || node.confidence >= 0.8));
    state = strong ? "CONFIRMED" : "UNCONFIRMED";
  }
  return {
    value: value || "Needs review",
    state,
    evidence: mapped.refs,
    evidenceIds: mapped.ids,
    basis,
  };
}

function instrument(raw: RawInstrument, ledger: TitleEvidenceLedger, index: number): CanonicalInstrument {
  const mapped = evidenceRefsForAnchors(ledger, raw.evidence || []);
  return {
    id: `inst-${index + 1}-${clean(raw.instrumentNumber) || "unresolved"}`,
    type: clean(raw.type) || "Unclassified Instrument",
    instrumentNumber: clean(raw.instrumentNumber) || "Needs review",
    bookPage: clean(raw.bookPage) || "Needs review",
    documentDate: clean(raw.documentDate) || "Needs review",
    recordingDate: clean(raw.recordingDate) || "Needs review",
    amount: clean(raw.amount) || "Needs review",
    status: clean(raw.status) || "Needs review",
    parties: (raw.parties || []).filter((party) => clean(party.name)).map((party) => ({
      name: clean(party.name),
      role: clean(party.role) || "Party",
      evidence: mapped.refs,
      evidenceIds: mapped.ids,
    })),
    propertyAddress: clean(raw.propertyAddress) || "Needs review",
    legalDescription: clean(raw.legalDescription) || "Needs review",
    referencedInstrumentNumbers: (raw.referencedInstrumentNumbers || []).map(clean).filter(Boolean),
    sourcePages: [...new Set(mapped.refs.map((item) => item.page))].sort((a, b) => a - b),
    evidence: mapped.refs,
    evidenceIds: mapped.ids,
  };
}

function runSheetEntry(raw: RawRunSheetEntry, ledger: TitleEvidenceLedger, index: number): CanonicalRunSheetEntry {
  const mapped = evidenceRefsForAnchors(ledger, raw.evidence || []);
  return {
    id: `rs-${index + 1}-${clean(raw.instrumentNumber) || "unresolved"}`,
    category: clean(raw.category) || "Unclassified",
    instrumentType: clean(raw.instrumentType) || "Unclassified",
    instrumentNumber: clean(raw.instrumentNumber) || "Needs review",
    bookPage: clean(raw.bookPage) || "Needs review",
    documentDate: clean(raw.documentDate) || "Needs review",
    recordingDate: clean(raw.recordingDate) || "Needs review",
    amount: clean(raw.amount) || "Needs review",
    parties: clean(raw.parties) || "Needs review",
    legalDescription: clean(raw.legalDescription) || "Needs review",
    evidence: mapped.refs,
    evidenceIds: mapped.ids,
  };
}

function reference(raw: RawTitlePacketExtraction["references"][number], ledger: TitleEvidenceLedger): CanonicalReference {
  const mapped = evidenceRefsForAnchors(ledger, raw.evidence || []);
  return {
    description: clean(raw.description) || "Referenced document",
    documentType: clean(raw.documentType) || "Unclassified",
    instrumentNumber: clean(raw.instrumentNumber) || "Needs review",
    bookPage: clean(raw.bookPage) || "Needs review",
    evidence: mapped.refs,
    evidenceIds: mapped.ids,
  };
}

function typeIs(type: string, pattern: RegExp): boolean {
  return pattern.test(type.toLowerCase());
}

function targetLien(recordInstruments: CanonicalInstrument[], raw: RawTitlePacketExtraction, ledger: TitleEvidenceLedger) {
  const mortgages = recordInstruments.filter((item) => typeIs(item.type, /mortgage|deed of trust|security deed/));
  const hint = fact(raw.targetLienHint.instrumentNumber, ledger, "Foreclosure target lien explicitly identified by the packet/order");
  const position = fact(raw.targetLienHint.position, ledger, "Lien position explicitly stated by the packet/order");
  let selected: CanonicalInstrument | undefined;

  if (hint.state !== "NOT_STATED") {
    const normalized = hint.value.toLowerCase().replace(/[^a-z0-9]/g, "");
    selected = mortgages.find((item) => item.instrumentNumber.toLowerCase().replace(/[^a-z0-9]/g, "") === normalized);
  }
  if (!selected && mortgages.length === 1) selected = mortgages[0];

  const beneficiary = selected?.parties.find((party) => /beneficiary|holder|mortgagee|lender/i.test(party.role));
  const selectedEvidence: EvidenceValue = selected ? {
    value: selected.instrumentNumber,
    state: selected.evidence.length ? "CONFIRMED" : "UNCONFIRMED",
    evidence: selected.evidence,
    evidenceIds: selected.evidenceIds,
    basis: hint.state !== "NOT_STATED" ? "Matched explicit target-lien hint to normalized instrument" : "Only mortgage/security instrument normalized; provisional target requires examiner confirmation when business context demands it",
  } : hint;

  return {
    instrumentId: selected?.id || null,
    instrumentNumber: selectedEvidence,
    amount: selected ? { value: selected.amount, state: selected.amount === "Needs review" ? "NOT_STATED" as const : selected.evidence.length ? "CONFIRMED" as const : "UNCONFIRMED" as const, evidence: selected.evidence, evidenceIds: selected.evidenceIds, basis: "Amount from selected/provisional target lien instrument" } : { value: "Needs review", state: "NOT_STATED" as const, evidence: [], evidenceIds: [], basis: "Target lien not resolved" },
    beneficiary: selected && beneficiary ? { value: beneficiary.name, state: "CONFIRMED" as const, evidence: beneficiary.evidence, evidenceIds: beneficiary.evidenceIds, basis: "Beneficiary/holder party on selected/provisional target lien" } : { value: "Needs review", state: "NOT_STATED" as const, evidence: [], evidenceIds: [], basis: "Target lien beneficiary not resolved" },
    position,
    selectionRequired: mortgages.length > 1 && !selected,
  };
}

export function buildCanonicalTitleRecordFromExtraction(args: {
  extraction: RawTitlePacketExtraction;
  ledger: TitleEvidenceLedger;
  clientName?: string;
  reviewId?: string;
  matterRevision?: number;
  requestedState?: string;
  requestedSearchType?: string;
}): CanonicalTitleRecord {
  const { extraction: raw, ledger } = args;
  const instruments = (raw.instruments || []).map((item, index) => instrument(item, ledger, index));
  const runMapped = evidenceRefsForAnchors(ledger, raw.runSheet.evidence || []);
  const explicitRunSheetLabel = runMapped.refs.some((item) => /run sheet|abstractor/i.test(`${item.documentType} ${item.quote}`));
  const orderTypeRaw = fact(raw.header.searchType, ledger, "Order/search type extracted from title packet");
  const stateRaw = fact(raw.header.state, ledger, "State extracted from title packet");
  const requestedSearchType = clean(args.requestedSearchType || "");
  const requestedState = clean(args.requestedState || "");
  const orderType = requestedSearchType && !/^auto detect$/i.test(requestedSearchType)
    ? { ...orderTypeRaw, value: requestedSearchType, state: "CONFIRMED" as const, basis: `Examiner-selected order profile; packet extraction was ${orderTypeRaw.value}` }
    : orderTypeRaw;
  const state = requestedState && !/^auto$/i.test(requestedState)
    ? { ...stateRaw, value: requestedState.toUpperCase(), state: "CONFIRMED" as const, basis: `Examiner state override; packet extraction was ${stateRaw.value}` }
    : stateRaw;

  const record: CanonicalTitleRecord = {
    schemaVersion: 2,
    recordId: args.reviewId || randomUUID(),
    reviewId: args.reviewId || "",
    packetHash: ledger.packetHash,
    sourceFile: ledger.sourceFile,
    clientName: clean(args.clientName || "") || "Ncala",
    orderNumber: fact(raw.header.orderNumber, ledger, "Order number extracted from title packet"),
    tsNumber: fact(raw.header.tsNumber, ledger, "TS/order identifier extracted from title packet"),
    orderType,
    effectiveDate: fact(raw.header.effectiveDate, ledger, "Search effective date extracted from title packet"),
    state,
    county: fact(raw.header.county, ledger, "County extracted from title packet"),
    propertyAddress: fact(raw.header.propertyAddress, ledger, "Property address extracted from title packet"),
    parcelId: fact(raw.header.parcelId, ledger, "Parcel/APN extracted from title packet"),
    legalDescription: fact(raw.header.legalDescription, ledger, "Title-summary legal description extracted from packet"),
    borrower: fact(raw.header.borrower, ledger, "Borrower/mortgagor expressly identified in packet"),
    currentOwner: fact(raw.header.currentOwner, ledger, "Current owner/vesting expressly identified in packet"),
    runSheet: {
      detected: Boolean(raw.runSheet.detected),
      confidence: raw.runSheet.detected ? (explicitRunSheetLabel ? "high" : "medium") : "low",
      pageStart: raw.runSheet.detected && raw.runSheet.pageStart > 0 ? raw.runSheet.pageStart : null,
      pageEnd: raw.runSheet.detected && raw.runSheet.pageEnd > 0 ? raw.runSheet.pageEnd : null,
      basis: clean(raw.runSheet.basis) || "Functional Run Sheet/title summary segmentation not established",
      entries: (raw.runSheet.entries || []).map((item, index) => runSheetEntry(item, ledger, index)),
      evidence: runMapped.refs,
      evidenceIds: runMapped.ids,
    },
    instruments,
    mortgages: instruments.filter((item) => typeIs(item.type, /mortgage|deed of trust|security deed/)),
    deeds: instruments.filter((item) => typeIs(item.type, /deed/) && !typeIs(item.type, /deed of trust|security deed/)),
    assignments: instruments.filter((item) => typeIs(item.type, /assignment/)),
    releases: instruments.filter((item) => typeIs(item.type, /release|satisfaction|reconveyance/)),
    liens: instruments.filter((item) => typeIs(item.type, /lien|judgment/)),
    references: (raw.references || []).map((item) => reference(item, ledger)),
    flags: {
      hoa: fact(raw.flags.hoa, ledger, "HOA status expressly stated in packet"),
      ccrs: fact(raw.flags.ccrs, ledger, "CC&R status expressly stated in packet"),
      federalTaxLien: fact(raw.flags.federalTaxLien, ledger, "Federal tax lien status expressly stated in packet"),
      bankruptcy: fact(raw.flags.bankruptcy, ledger, "Bankruptcy search/status expressly stated in packet"),
      plat: fact(raw.flags.plat, ledger, "Plat status/reference expressly stated in packet"),
      mers: fact(raw.flags.mers, ledger, "MERS status expressly stated in packet"),
      min: fact(raw.flags.min, ledger, "MIN expressly stated in packet"),
    },
    taxes: {
      status: fact(raw.taxes.status, ledger, "Tax status extracted from packet"),
      fiscalYear: fact(raw.taxes.fiscalYear, ledger, "Tax/fiscal year extracted from packet"),
      landValue: fact(raw.taxes.landValue, ledger, "Land value extracted from tax evidence"),
      improvements: fact(raw.taxes.improvements, ledger, "Improvement value extracted from tax evidence"),
    },
    targetLien: undefined as never,
    dataQualityWarnings: [],
    matterRevision: args.matterRevision || 1,
  };
  record.targetLien = targetLien(instruments, raw, ledger);

  if (record.borrower.state !== "CONFIRMED") record.dataQualityWarnings.push("Borrower is unresolved. Current owner is never substituted for borrower.");
  if (record.orderType.state !== "CONFIRMED") record.dataQualityWarnings.push("Order/QC profile was not established from packet evidence; an examiner profile selection is required.");
  if (record.state.state !== "CONFIRMED") record.dataQualityWarnings.push("State was not established from packet evidence.");
  if (!record.runSheet.detected) record.dataQualityWarnings.push("Functional Run Sheet/title summary was not confidently segmented; Run Sheet reconciliation must remain unresolved rather than N/A.");
  if (/^foreclosure$/i.test(record.orderType.value)) {
    if (record.targetLien.selectionRequired) record.dataQualityWarnings.push("Multiple mortgage/security liens exist and the foreclosure target was not expressly identified.");
    if (record.targetLien.position.state !== "CONFIRMED") record.dataQualityWarnings.push("Lien position is unresolved and is not inferred from document order.");
  }
  return record;
}
