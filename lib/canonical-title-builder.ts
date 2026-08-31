import { randomUUID } from "node:crypto";
import { evidenceRefsForAnchors } from "./title-evidence-ledger";
import { buildForeclosureAnalysis, buildLienStack, developedPositionForTarget } from "./lien-stack";
import type { RawFact, RawInstrument, RawRunSheetEntry, RawTitlePacketExtraction, TitleEvidenceLedger } from "./title-extraction-model";
import type { CanonicalInstrument, CanonicalReference, CanonicalRunSheetEntry, CanonicalTitleRecord, EvidenceState, EvidenceValue, RunSheetSummary } from "./title-domain";

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
  return { value: value || "Needs review", state, evidence: mapped.refs, evidenceIds: mapped.ids, basis };
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
    parties: (raw.parties || []).filter((party) => clean(party.name)).map((party) => ({ name: clean(party.name), role: clean(party.role) || "Party", evidence: mapped.refs, evidenceIds: mapped.ids })),
    propertyAddress: clean(raw.propertyAddress) || "Needs review",
    legalDescription: clean(raw.legalDescription) || "Needs review",
    referencedInstrumentNumbers: (raw.referencedInstrumentNumbers || []).map(clean).filter(Boolean),
    sourcePages: [...new Set(mapped.refs.map((item) => item.page))].sort((a, b) => a - b),
    evidence: mapped.refs,
    evidenceIds: mapped.ids,
  };
}

function summaryEntry(raw: RawRunSheetEntry, ledger: TitleEvidenceLedger, index: number, prefix: string): CanonicalRunSheetEntry {
  const mapped = evidenceRefsForAnchors(ledger, raw.evidence || []);
  return {
    id: `${prefix}-${index + 1}-${clean(raw.instrumentNumber) || "unresolved"}`,
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

function sameInstrument(a: string, b: string): boolean {
  const left = clean(a).toLowerCase().replace(/[^a-z0-9]/g, "");
  const right = clean(b).toLowerCase().replace(/[^a-z0-9]/g, "");
  return Boolean(left && left === right);
}

function summaryAmount(raw: RawTitlePacketExtraction, instrumentNumber: string, ledger: TitleEvidenceLedger): EvidenceValue | null {
  const entry = raw.runSheet.entries.find((candidate) => sameInstrument(candidate.instrumentNumber, instrumentNumber) && clean(candidate.amount));
  if (!entry) return null;
  const mapped = evidenceRefsForAnchors(ledger, entry.evidence || []);
  return {
    value: clean(entry.amount) || "Needs review",
    state: mapped.refs.length ? "CONFIRMED" : "UNCONFIRMED",
    evidence: mapped.refs,
    evidenceIds: mapped.ids,
    basis: "Lien amount developed from matching title-summary entry because the normalized source instrument amount was unavailable",
  };
}

function targetLien(recordInstruments: CanonicalInstrument[], raw: RawTitlePacketExtraction, ledger: TitleEvidenceLedger, lienStack: CanonicalTitleRecord["foreclosureAnalysis"]["lienStack"]) {
  const mortgages = recordInstruments.filter((item) => typeIs(item.type, /mortgage|deed of trust|security deed/));
  const hint = fact(raw.targetLienHint.instrumentNumber, ledger, "Foreclosure target lien explicitly identified by the packet/order");
  const explicitPosition = fact(raw.targetLienHint.position, ledger, "Lien position explicitly stated by the packet/order");
  let selected: CanonicalInstrument | undefined;

  if (hint.state !== "NOT_STATED") {
    selected = mortgages.find((item) => sameInstrument(item.instrumentNumber, hint.value));
  }
  if (!selected && mortgages.length === 1) selected = mortgages[0];

  const beneficiary = selected?.parties.find((party) => /beneficiary|holder|mortgagee|lender/i.test(party.role));
  const selectedEvidence: EvidenceValue = selected ? {
    value: selected.instrumentNumber,
    state: selected.evidence.length ? "CONFIRMED" : "UNCONFIRMED",
    evidence: selected.evidence,
    evidenceIds: selected.evidenceIds,
    basis: hint.state !== "NOT_STATED" ? "Matched explicit target-lien hint to normalized instrument" : "Only mortgage/security instrument normalized; used as the provisional target for lien-stack development",
  } : hint;

  const sourceAmount: EvidenceValue | null = selected && selected.amount !== "Needs review" ? {
    value: selected.amount,
    state: selected.evidence.length ? "CONFIRMED" : "UNCONFIRMED",
    evidence: selected.evidence,
    evidenceIds: selected.evidenceIds,
    basis: "Lien amount from selected/provisional target security instrument",
  } : selected ? summaryAmount(raw, selected.instrumentNumber, ledger) : null;
  const amount = sourceAmount || { value: "Needs review", state: "NOT_STATED" as const, evidence: [], evidenceIds: [], basis: "Target lien amount not resolved" };

  const firstInTime = developedPositionForTarget(lienStack, selected?.id || null);
  const useExplicit = explicitPosition.state === "CONFIRMED";
  const position: EvidenceValue = useExplicit ? explicitPosition : {
    value: firstInTime.value,
    state: firstInTime.value === "Needs review" ? "NOT_STATED" : firstInTime.confidence === "high" ? "CONFIRMED" : "UNCONFIRMED",
    evidence: firstInTime.evidence,
    evidenceIds: firstInTime.evidenceIds,
    basis: firstInTime.value === "Needs review"
      ? "Lien position could not be developed from the available open-lien recording evidence"
      : `Developed ${firstInTime.value} using first-in-time recording chronology${firstInTime.warning ? `; ${firstInTime.warning}` : ""}`,
  };

  return {
    instrumentId: selected?.id || null,
    instrumentNumber: selectedEvidence,
    amount,
    beneficiary: selected && beneficiary ? { value: beneficiary.name, state: "CONFIRMED" as const, evidence: beneficiary.evidence, evidenceIds: beneficiary.evidenceIds, basis: "Beneficiary/holder party on selected/provisional target lien" } : { value: "Needs review", state: "NOT_STATED" as const, evidence: [], evidenceIds: [], basis: "Target lien beneficiary not resolved" },
    position,
    positionBasis: useExplicit ? "EXPLICIT" as const : firstInTime.basis,
    positionConfidence: useExplicit ? "high" as const : firstInTime.confidence,
    selectionRequired: mortgages.length > 1 && !selected,
  };
}

function emptyDistinctRunSheet(): RunSheetSummary {
  return {
    detected: false,
    confidence: "low",
    pageStart: null,
    pageEnd: null,
    basis: "No distinct Run Sheet or Abstractor Sheet was identified. The title report itself is not treated as a Run Sheet.",
    entries: [],
    evidence: [],
    evidenceIds: [],
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
  const summaryMapped = evidenceRefsForAnchors(ledger, raw.runSheet.evidence || []);
  const explicitRunSheetLabel = summaryMapped.refs.some((item) => /\b(run sheet|abstractor sheet|abstractor)\b/i.test(`${item.documentType} ${item.quote}`));
  const summaryEntries = (raw.runSheet.entries || []).map((item, index) => summaryEntry(item, ledger, index, "summary"));
  const titleSummary: RunSheetSummary = {
    detected: Boolean(raw.runSheet.detected),
    confidence: raw.runSheet.detected ? "high" : "low",
    pageStart: raw.runSheet.detected && raw.runSheet.pageStart > 0 ? raw.runSheet.pageStart : null,
    pageEnd: raw.runSheet.detected && raw.runSheet.pageEnd > 0 ? raw.runSheet.pageEnd : null,
    basis: clean(raw.runSheet.basis) || "Opening title-summary segmentation not established",
    entries: summaryEntries,
    evidence: summaryMapped.refs,
    evidenceIds: summaryMapped.ids,
  };
  const runSheet: RunSheetSummary = explicitRunSheetLabel ? {
    ...titleSummary,
    confidence: "high",
    entries: (raw.runSheet.entries || []).map((item, index) => summaryEntry(item, ledger, index, "runsheet")),
    basis: `Distinct Run Sheet/Abstractor Sheet identified. ${titleSummary.basis}`,
  } : emptyDistinctRunSheet();

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

  const mortgages = instruments.filter((item) => typeIs(item.type, /mortgage|deed of trust|security deed/));
  const deeds = instruments.filter((item) => typeIs(item.type, /deed/) && !typeIs(item.type, /deed of trust|security deed/));
  const assignments = instruments.filter((item) => typeIs(item.type, /assignment/));
  const releases = instruments.filter((item) => typeIs(item.type, /release|satisfaction|reconveyance|discharge/));
  const liens = instruments.filter((item) => typeIs(item.type, /lien|judgment|assessment|ucc/));
  const lienStack = buildLienStack(instruments, releases);
  const developedTarget = targetLien(instruments, raw, ledger, lienStack);
  const foreclosureAnalysis = buildForeclosureAnalysis({
    lienStack,
    targetInstrumentId: developedTarget.instrumentId,
    targetAmount: developedTarget.amount.value,
    targetPosition: developedTarget.position.value,
    targetPositionBasis: developedTarget.positionBasis,
    targetPositionConfidence: developedTarget.positionConfidence,
    selectionRequired: developedTarget.selectionRequired,
  });

  const record: CanonicalTitleRecord = {
    schemaVersion: 2,
    recordId: args.reviewId || randomUUID(),
    reviewId: args.reviewId || "",
    packetHash: ledger.packetHash,
    sourceFile: ledger.sourceFile,
    clientName: clean(args.clientName || "") || "McCalla",
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
    titleSummary,
    runSheet,
    instruments,
    mortgages,
    deeds,
    assignments,
    releases,
    liens,
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
    targetLien: developedTarget,
    foreclosureAnalysis,
    dataQualityWarnings: [],
    matterRevision: args.matterRevision || 1,
  };

  if (record.borrower.state !== "CONFIRMED") record.dataQualityWarnings.push("Borrower is unresolved. Current owner is never substituted for borrower.");
  if (record.orderType.state !== "CONFIRMED") record.dataQualityWarnings.push("Order/QC profile was not established from packet evidence; an examiner profile selection is required.");
  if (record.state.state !== "CONFIRMED") record.dataQualityWarnings.push("State was not established from packet evidence.");
  if (!record.titleSummary.detected) record.dataQualityWarnings.push("Opening title summary was not confidently segmented; report-to-source reconciliation remains unresolved.");
  if (record.targetLien.selectionRequired) record.dataQualityWarnings.push("Multiple mortgage/security liens exist and the target lien was not expressly identified. Select the target before McCalla foreclosure export is final.");
  if (record.targetLien.position.value === "Needs review") record.dataQualityWarnings.push("Lien position could not be developed from first-in-time recording evidence and requires examiner priority review.");
  if (record.targetLien.positionBasis === "FIRST_IN_TIME" && record.targetLien.positionConfidence !== "high") record.dataQualityWarnings.push("Lien position is a first-in-time screening result with a priority exception or sequencing uncertainty; jurisdiction-specific priority review is required.");
  return record;
}
