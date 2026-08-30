import { detectRunSheet } from "./run-sheet-detection";
import type { CanonicalInstrument, CanonicalParty, CanonicalTitleRecord, EvidenceValue } from "./title-domain";
import type { AuditFinding, EvidenceRef, MortgageRecord, PacketDocument, VeraExam } from "./vera";

function clean(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text || /^not\s+(provided|stated|applicable)$/i.test(text)) return "";
  return text;
}

function confirmed(value: string, evidence: EvidenceRef[], basis: string): EvidenceValue {
  const normalized = clean(value);
  return {
    value: normalized || "Needs review",
    state: normalized && evidence.length ? "CONFIRMED" : normalized ? "UNCONFIRMED" : "NOT_STATED",
    evidence,
    basis,
  };
}

function finding(exam: VeraExam, number: number): AuditFinding | undefined {
  return exam.findings.find((item) => item.number === number);
}

function evidenceFor(exam: VeraExam, fieldNames: string[], fallbackQuestions: number[] = []): EvidenceRef[] {
  const normalized = fieldNames.map((name) => name.toLowerCase());
  const fieldEvidence = exam.summaryEvidence
    .filter((item) => normalized.some((name) => item.field.toLowerCase().includes(name)))
    .flatMap((item) => item.evidence || []);
  if (fieldEvidence.length) return dedupeEvidence(fieldEvidence);
  return dedupeEvidence(fallbackQuestions.flatMap((number) => finding(exam, number)?.evidence || []));
}

function dedupeEvidence(items: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.page}|${item.documentType}|${item.quote}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function explicitBorrower(exam: VeraExam): EvidenceValue {
  const candidates = [finding(exam, 4), finding(exam, 12), finding(exam, 13), finding(exam, 15)].filter(Boolean) as AuditFinding[];
  for (const candidate of candidates) {
    const text = `${candidate.response} ${candidate.proofReason}`;
    const match = text.match(/\b(?:borrower|mortgagor)\s*(?:is|:|-)?\s*([A-Z][A-Za-z0-9 .,'&()/-]{2,90}?)(?=\s*(?:;|\||,\s*(?:lender|holder|beneficiary|trustee|amount|date|recorded)|\$|$))/i);
    if (match?.[1]) return confirmed(match[1], candidate.evidence, "Explicit borrower/mortgagor language from grounded title evidence");
  }
  return { value: "Needs review", state: "NOT_STATED", evidence: [], basis: "Borrower was not explicitly normalized; current owner is never substituted for borrower." };
}

function lienPosition(exam: VeraExam): EvidenceValue {
  for (const item of exam.findings) {
    const text = `${item.response} ${item.proofReason}`;
    const match = text.match(/\b(?:lien\s+position|position)\s*(?:is|:|#|-)?\s*(1st|first|2nd|second|3rd|third|4th|fourth|\d+)\b/i);
    if (match?.[1]) return confirmed(match[1], item.evidence, "Explicit lien-position language in grounded review evidence");
  }
  return { value: "Needs review", state: "NOT_STATED", evidence: [], basis: "Lien position was not expressly established and is not inferred from array or document order." };
}

function instrumentEvidence(exam: VeraExam, instrumentNumber: string, fallbackQuestions: number[]): EvidenceRef[] {
  const normalized = clean(instrumentNumber).toLowerCase();
  const all = [
    ...exam.summaryEvidence.flatMap((item) => item.evidence || []),
    ...exam.findings.flatMap((item) => item.evidence || []),
  ];
  if (normalized) {
    const matched = all.filter((item) =>
      clean(item.instrumentNumber).toLowerCase() === normalized || item.quote.toLowerCase().includes(normalized),
    );
    if (matched.length) return dedupeEvidence(matched);
  }
  return dedupeEvidence(fallbackQuestions.flatMap((number) => finding(exam, number)?.evidence || []));
}

function sourcePages(evidence: EvidenceRef[]): number[] {
  return [...new Set(evidence.map((item) => item.page).filter((page) => page > 0))].sort((a, b) => a - b);
}

function mortgageInstrument(exam: VeraExam, mortgage: MortgageRecord): CanonicalInstrument {
  const evidence = instrumentEvidence(exam, mortgage.instrument, [4, 5, 12, 14]);
  const parties: CanonicalParty[] = [];
  const borrower = explicitBorrower(exam);
  if (borrower.state !== "NOT_STATED") parties.push({ name: borrower.value, role: "Borrower/Mortgagor", evidence: borrower.evidence });
  if (clean(mortgage.holder)) parties.push({ name: mortgage.holder, role: "Holder/Beneficiary", evidence });
  return {
    id: `mortgage-${mortgage.index}-${clean(mortgage.instrument) || "unresolved"}`,
    type: clean(exam.loanDocumentType) || "Mortgage / Deed of Trust",
    instrumentNumber: clean(mortgage.instrument) || "Needs review",
    bookPage: clean(mortgage.bookPage) || "Needs review",
    documentDate: clean(mortgage.date) || "Needs review",
    recordingDate: clean(exam.recordingDate) || "Needs review",
    amount: clean(mortgage.amount) || "Needs review",
    status: clean(exam.loanStatus) || "Needs review",
    parties,
    legalDescription: clean(exam.legalDescription) || "Needs review",
    sourcePages: sourcePages(evidence),
    evidence,
  };
}

function deedInstrument(exam: VeraExam): CanonicalInstrument | null {
  const deed = exam.deed;
  if (![deed.grantor, deed.grantee, deed.instrument, deed.bookPage].some((value) => clean(value))) return null;
  const evidence = instrumentEvidence(exam, deed.instrument, [4, 5, 8]);
  return {
    id: `deed-${clean(deed.instrument) || "current-vesting"}`,
    type: "Deed / Vesting Instrument",
    instrumentNumber: clean(deed.instrument) || "Needs review",
    bookPage: clean(deed.bookPage) || "Needs review",
    documentDate: clean(deed.date) || "Needs review",
    recordingDate: "Needs review",
    amount: clean(deed.consideration) || "Needs review",
    status: "Recorded",
    parties: [
      ...(clean(deed.grantor) ? [{ name: deed.grantor, role: "Grantor", evidence }] : []),
      ...(clean(deed.grantee) ? [{ name: deed.grantee, role: "Grantee/Current Owner", evidence }] : []),
    ],
    legalDescription: clean(exam.legalDescription) || "Needs review",
    sourcePages: sourcePages(evidence),
    evidence,
  };
}

function documentInstrument(document: PacketDocument, index: number): CanonicalInstrument {
  return {
    id: `document-${index + 1}-${clean(document.instrumentNumber) || document.pageStart}`,
    type: clean(document.documentType) || "Recorded / Supporting Document",
    instrumentNumber: clean(document.instrumentNumber) || "Needs review",
    bookPage: "Needs review",
    documentDate: "Needs review",
    recordingDate: clean(document.recordingDate) || "Needs review",
    amount: "Needs review",
    status: "Supplied",
    parties: [],
    legalDescription: "Needs review",
    sourcePages: document.pageStart > 0 ? Array.from({ length: Math.max(1, document.pageEnd - document.pageStart + 1) }, (_, offset) => document.pageStart + offset) : [],
    evidence: document.excerpt ? [{ quote: document.excerpt, page: document.pageStart, documentType: document.documentType, source: "openai-file", sourceFile: undefined, instrumentNumber: document.instrumentNumber }] : [],
  };
}

function typeMatches(instrument: CanonicalInstrument, pattern: RegExp): boolean {
  return pattern.test(instrument.type);
}

export function normalizeTitleRecord(exam: VeraExam, clientName = "Ncala"): CanonicalTitleRecord {
  const runSheet = detectRunSheet(exam);
  const borrower = explicitBorrower(exam);
  const currentOwnerEvidence = evidenceFor(exam, ["vesting", "owner", "deed"], [4, 8]);
  const currentOwner = confirmed(exam.deed.grantee, currentOwnerEvidence, "Current vesting grantee from completed title review");
  const deed = deedInstrument(exam);
  const mortgages = (exam.mortgages || []).map((mortgage) => mortgageInstrument(exam, mortgage));
  const legacyDocuments = exam.documents.map(documentInstrument);
  const keyed = new Set<string>();
  const instruments = [
    ...(deed ? [deed] : []),
    ...mortgages,
    ...legacyDocuments,
  ].filter((instrument) => {
    const key = `${instrument.type.toLowerCase()}|${instrument.instrumentNumber.toLowerCase()}|${instrument.sourcePages.join(",")}`;
    if (keyed.has(key)) return false;
    keyed.add(key);
    return true;
  });

  const position = lienPosition(exam);
  const target = mortgages.length === 1 ? mortgages[0] : null;
  const warnings: string[] = [];
  if (borrower.state !== "CONFIRMED") warnings.push("Borrower is unresolved and requires examiner confirmation before client export.");
  if (mortgages.length > 1) warnings.push("Multiple mortgages were found; the foreclosure target lien must be selected explicitly.");
  if (position.state !== "CONFIRMED") warnings.push("Lien position is unresolved and must not be inferred from document order.");
  if (!runSheet.detected) warnings.push("Functional Run Sheet/title summary was not confidently segmented; Run Sheet reconciliation remains an exception, not N/A.");

  return {
    schemaVersion: 1,
    recordId: exam.reviewId || `${exam.packetHash || exam.sourceFile}-${exam.matterRevision || 1}`,
    reviewId: exam.reviewId || "",
    packetHash: exam.packetHash || "",
    sourceFile: exam.sourceFile,
    clientName,
    orderNumber: confirmed(exam.clientOrder, evidenceFor(exam, ["order"], [20]), "Client/order number from title packet"),
    tsNumber: confirmed(exam.clientOrder, evidenceFor(exam, ["order"], [20]), "TS/order identifier from title packet"),
    orderType: confirmed(exam.searchType, evidenceFor(exam, ["search type", "order type"], []), "Detected or selected QC/order profile"),
    effectiveDate: confirmed(exam.searchEffectiveDate, evidenceFor(exam, ["effective"], []), "Search effective date from title summary"),
    state: confirmed(exam.state, evidenceFor(exam, ["state"], []), "State detected from title packet"),
    county: confirmed(exam.county, evidenceFor(exam, ["county"], []), "County from title packet"),
    propertyAddress: confirmed(exam.propertyAddress, evidenceFor(exam, ["address", "property"], [12]), "Property address from title packet"),
    parcelId: confirmed(exam.parcelId, evidenceFor(exam, ["parcel", "apn"], []), "Parcel/APN from title packet"),
    legalDescription: confirmed(exam.legalDescription, evidenceFor(exam, ["legal description"], [8]), "Normalized legal description from reviewed title packet"),
    borrower,
    currentOwner,
    runSheet: {
      detected: runSheet.detected,
      confidence: runSheet.confidence,
      pageStart: runSheet.pageStart ?? null,
      pageEnd: runSheet.pageEnd ?? null,
      basis: runSheet.reason,
    },
    instruments,
    mortgages,
    deeds: instruments.filter((instrument) => typeMatches(instrument, /\bdeed\b/i) && !typeMatches(instrument, /deed of trust/i)),
    assignments: instruments.filter((instrument) => typeMatches(instrument, /assignment/i)),
    releases: instruments.filter((instrument) => typeMatches(instrument, /release|satisfaction|reconveyance/i)),
    liens: instruments.filter((instrument) => typeMatches(instrument, /lien|judgment/i)),
    taxes: {
      status: confirmed(exam.taxStatus, evidenceFor(exam, ["tax status", "tax"], []), "Tax status from reviewed packet"),
      fiscalYear: confirmed(exam.fiscalYear, evidenceFor(exam, ["fiscal", "tax year"], []), "Tax/fiscal year from reviewed packet"),
      landValue: confirmed(exam.landValue, evidenceFor(exam, ["land value"], []), "Land value from tax evidence"),
      improvements: confirmed(exam.improvements, evidenceFor(exam, ["improvement"], []), "Improvement value from tax evidence"),
    },
    targetLien: {
      instrumentId: target?.id || null,
      instrumentNumber: target ? confirmed(target.instrumentNumber, target.evidence, "Only extracted mortgage; provisional foreclosure target") : { value: "Needs review", state: "NOT_STATED", evidence: [], basis: mortgages.length > 1 ? "Multiple mortgages require explicit target selection" : "No mortgage was normalized" },
      amount: target ? confirmed(target.amount, target.evidence, "Only extracted mortgage; provisional foreclosure target") : { value: "Needs review", state: "NOT_STATED", evidence: [], basis: "Target lien not selected" },
      beneficiary: target ? confirmed(target.parties.find((party) => /holder|beneficiary/i.test(party.role))?.name || "", target.evidence, "Beneficiary/holder from target lien evidence") : { value: "Needs review", state: "NOT_STATED", evidence: [], basis: "Target lien not selected" },
      position,
      selectionRequired: mortgages.length !== 1,
    },
    dataQualityWarnings: warnings,
    matterRevision: exam.matterRevision || 1,
  };
}
