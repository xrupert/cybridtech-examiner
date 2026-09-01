import { profileForOrderType, UNRESOLVED_QC_PROFILE, type QcProfileCheck } from "./qc-profiles";
import type { RunSheetReconciliation } from "./run-sheet-reconciler";
import { issueMetadata, reduceQcChecks } from "./title-qc-engine";
import type { CanonicalInstrument, CanonicalTitleRecord, QcCheckResult, QcProfileResult, QcStatus } from "./title-domain";
import type { EvidenceRef } from "./vera";

export interface CheckerResolution {
  checkId: string;
  status: QcStatus;
  summary: string;
  evidenceIds: string[];
}

function result(check: QcProfileCheck, status: QcStatus, summary: string, evidence: EvidenceRef[] = [], evidenceIds: string[] = []): QcCheckResult {
  const meta = issueMetadata(check.id);
  return {
    id: check.id,
    label: check.label,
    category: check.category,
    status,
    severity: meta.severity,
    critical: check.critical,
    summary,
    recommendedAction: status === "PASS" || status === "NOT_APPLICABLE" ? "No curative action required for this check." : meta.action,
    evidence,
    evidenceIds,
    legacyQuestionNumber: check.legacyQuestionNumber,
  };
}

function normalizeName(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((token) => token.length > 1 && !["jr", "sr", "llc", "inc", "the"].includes(token));
}

function partyNames(instrument: CanonicalInstrument, role: RegExp): string[] {
  return instrument.parties.filter((party) => role.test(party.role)).flatMap((party) => normalizeName(party.name));
}

function chainLooksContinuous(deeds: CanonicalInstrument[]): boolean | null {
  if (deeds.length < 2) return null;
  const ordered = [...deeds].sort((a, b) => {
    const ad = Date.parse(a.recordingDate !== "Needs review" ? a.recordingDate : a.documentDate);
    const bd = Date.parse(b.recordingDate !== "Needs review" ? b.recordingDate : b.documentDate);
    return Number.isFinite(ad) && Number.isFinite(bd) ? ad - bd : 0;
  });
  let compared = 0;
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const olderGrantees = new Set(partyNames(ordered[index], /grantee|buyer|owner/i));
    const newerGrantors = partyNames(ordered[index + 1], /grantor|seller/i);
    if (!olderGrantees.size || !newerGrantors.length) continue;
    compared += 1;
    if (!newerGrantors.some((token) => olderGrantees.has(token))) return false;
  }
  return compared ? true : null;
}

function normalizeAddress(value: string): string {
  return value.toLowerCase().replace(/\b(street|st\.)\b/g, "st").replace(/\b(road|rd\.)\b/g, "rd").replace(/\b(avenue|ave\.)\b/g, "ave").replace(/[^a-z0-9]/g, "");
}

function normalizeMoney(value: string): string {
  const numeric = value.replace(/[$,\s]/g, "").match(/-?\d+(?:\.\d{1,2})?/);
  return numeric ? Number(numeric[0]).toFixed(2) : value.toLowerCase().replace(/\s+/g, " ").trim();
}

function currentOwnerSearch(record: CanonicalTitleRecord): boolean {
  return /^current owner search$/i.test(record.orderType.value.trim());
}

function secondLienSearch(record: CanonicalTitleRecord): boolean {
  return /^2nd lien$/i.test(record.orderType.value.trim());
}

function currentOwnerEvidence(record: CanonicalTitleRecord): { refs: EvidenceRef[]; ids: string[] } {
  const candidates = [
    ...record.titleSummary.evidence,
    ...record.deeds.flatMap((item) => item.evidence),
    ...record.mortgages.flatMap((item) => item.evidence),
    ...record.instruments.filter((item) => /assessor|sale|transfer|tax/i.test(item.type)).flatMap((item) => item.evidence),
  ];
  const ids = [
    ...(record.titleSummary.evidenceIds || []),
    ...record.deeds.flatMap((item) => item.evidenceIds || []),
    ...record.mortgages.flatMap((item) => item.evidenceIds || []),
    ...record.instruments.filter((item) => /assessor|sale|transfer|tax/i.test(item.type)).flatMap((item) => item.evidenceIds || []),
  ];
  return { refs: candidates, ids: [...new Set(ids)] };
}

function controllingSecurityInstrument(record: CanonicalTitleRecord): CanonicalInstrument | undefined {
  const selected = record.targetLien.instrumentId ? record.mortgages.find((item) => item.id === record.targetLien.instrumentId) : undefined;
  if (selected) return selected;
  return record.mortgages.length === 1 ? record.mortgages[0] : undefined;
}

function factAnswered(value: CanonicalTitleRecord["flags"]["hoa"]): boolean {
  return value.state === "CONFIRMED" && value.value !== "Needs review";
}

function negativeOrNA(value: string): boolean {
  return /^(?:no|none|not applicable|n\/a|not found|no hoa|no ccr)/i.test(value.trim());
}

function titleSummaryQuestionEvidence(record: CanonicalTitleRecord, reconciliation: RunSheetReconciliation): { refs: EvidenceRef[]; ids: string[] } {
  return {
    refs: reconciliation.entries.flatMap((entry) => entry.evidence)
      .concat(reconciliation.sourceOmittedFromRunSheet.flatMap((item) => item.evidence), reconciliation.referencedButMissing.flatMap((item) => item.evidence)),
    ids: [...new Set(reconciliation.entries.flatMap((entry) => entry.evidenceIds)
      .concat(reconciliation.sourceOmittedFromRunSheet.flatMap((item) => item.evidenceIds || []), reconciliation.referencedButMissing.flatMap((item) => item.evidenceIds)))],
  };
}

function deedMortgageAccuracy(record: CanonicalTitleRecord, reconciliation: RunSheetReconciliation, check: QcProfileCheck): QcCheckResult {
  const relevantEntries = new Set(record.titleSummary.entries.filter((entry) => /deed|mortgage|deed of trust|security deed/i.test(`${entry.category} ${entry.instrumentType}`)).map((entry) => entry.id));
  const relevant = reconciliation.entries.filter((entry) => relevantEntries.has(entry.runSheetEntryId));
  const evidence = relevant.flatMap((entry) => entry.evidence);
  const ids = [...new Set(relevant.flatMap((entry) => entry.evidenceIds))];
  if (!record.titleSummary.detected || !relevant.length) return result(check, "CANNOT_CONFIRM", "Deed/mortgage summary entries could not be fully paired to source instruments for amount/name review.", evidence, ids);
  if (relevant.some((entry) => entry.status === "SOURCE_MISSING")) return result(check, "CANNOT_CONFIRM", "A deed or mortgage listed in the report lacks the source instrument needed to verify names and amounts.", evidence, ids);
  const mismatches = relevant.flatMap((entry) => entry.mismatches).filter((item) => /amount|parties/i.test(item.field));
  if (mismatches.length) return result(check, "FAIL", `Deed/mortgage name or amount discrepancy identified: ${mismatches.slice(0, 4).map((item) => `${item.field} (${item.runSheetValue} vs ${item.sourceValue})`).join("; ")}.`, evidence, ids);
  return result(check, "PASS", `${relevant.length} deed/mortgage report entr${relevant.length === 1 ? "y" : "ies"} reconcile to source names and amounts.`, evidence, ids);
}

function profileCheck(
  check: QcProfileCheck,
  record: CanonicalTitleRecord,
  titleSummaryReconciliation: RunSheetReconciliation,
  runSheetReconciliation: RunSheetReconciliation,
): QcCheckResult {
  switch (check.id) {
    case "CURRENT_OWNER_ESTABLISHED":
      return record.currentOwner.state === "CONFIRMED"
        ? result(check, "PASS", `Current owner established as ${record.currentOwner.value}.`, record.currentOwner.evidence, record.currentOwner.evidenceIds)
        : result(check, "CANNOT_CONFIRM", "Current owner/vesting is not supported by sufficiently grounded deed evidence.", record.currentOwner.evidence, record.currentOwner.evidenceIds);

    case "PRIOR_OWNER_ESTABLISHED": {
      if (currentOwnerSearch(record)) {
        const evidence = currentOwnerEvidence(record);
        if (!record.deeds.length) return result(check, "CANNOT_CONFIRM", "RCS Current Owner requires a qualifying non-family full-value deed; no deed source was normalized.", evidence.refs, evidence.ids);
        return result(check, "CANNOT_CONFIRM", "A deed source is present. Confirm that the controlling/current-owner deed is the qualifying non-family full-value transfer and that its recording date, transfer amount, and vesting are supported by packet evidence.", evidence.refs, evidence.ids);
      }
      const prior = record.deeds.length >= 2;
      const evidence = record.deeds.flatMap((deed) => deed.evidence);
      const ids = record.deeds.flatMap((deed) => deed.evidenceIds || []);
      return prior ? result(check, "PASS", `${record.deeds.length} deed instruments support the required multi-owner review.`, evidence, ids) : result(check, "CANNOT_CONFIRM", "A second qualifying owner/deed was not established from the supplied source instruments.", evidence, ids);
    }

    case "OWNERSHIP_CHAIN_COMPLETE": {
      if (currentOwnerSearch(record)) {
        const evidence = currentOwnerEvidence(record);
        if (!record.deeds.length || !record.mortgages.length) return result(check, "CANNOT_CONFIRM", "RCS Current Owner requires the qualifying non-family full-value deed to have a concurrently filed institutional purchase-money mortgage; the supplied normalized deed/mortgage evidence is incomplete.", evidence.refs, evidence.ids);
        return result(check, "CANNOT_CONFIRM", "Deed and mortgage evidence are present. Confirm that the qualifying full-value deed has a concurrently filed institutional purchase-money mortgage; do not require an extra deed when the current-owner deed itself satisfies the RCS look-back rule.", evidence.refs, evidence.ids);
      }
      const continuous = chainLooksContinuous(record.deeds);
      const evidence = record.deeds.flatMap((deed) => deed.evidence);
      const ids = record.deeds.flatMap((deed) => deed.evidenceIds || []);
      if (continuous === false) return result(check, "FAIL", "The normalized deed parties contain an apparent break in ownership continuity.", evidence, ids);
      if (continuous === true) return result(check, "PASS", "Normalized deed parties form a continuous ownership chain for the supplied deeds.", evidence, ids);
      return result(check, "CANNOT_CONFIRM", "Ownership-chain continuity requires semantic review of the supplied deed parties and order.", evidence, ids);
    }

    case "TARGET_LIEN_FOUND":
      if (record.targetLien.selectionRequired) return result(check, "CANNOT_CONFIRM", `${record.mortgages.length} mortgage/security liens were extracted and the foreclosure target could not be developed automatically. Examiner selection is the exception path.`, record.mortgages.flatMap((item) => item.evidence), record.mortgages.flatMap((item) => item.evidenceIds || []));
      if (!record.targetLien.instrumentId) return result(check, "CANNOT_CONFIRM", "No foreclosure target lien was established from the packet.");
      return result(check, "PASS", `Target lien established as ${record.targetLien.instrumentNumber.value}.`, record.targetLien.instrumentNumber.evidence, record.targetLien.instrumentNumber.evidenceIds);

    case "TARGET_LIEN_POSITION_ESTABLISHED": {
      if (record.targetLien.position.state === "CONFIRMED" || record.targetLien.position.state === "EXAMINER_CONFIRMED") {
        const summary = record.targetLien.positionBasis === "EXAMINER"
          ? `Target lien position is examiner-confirmed as ${record.targetLien.position.value}; documentary source facts remain separately auditable.`
          : record.targetLien.positionBasis === "EXPLICIT"
          ? `Target lien position is expressly stated as ${record.targetLien.position.value}.`
          : `Target lien position developed as ${record.targetLien.position.value} using first-in-time recording chronology with no detected priority exception requiring downgrade.`;
        return result(check, "PASS", summary, record.targetLien.position.evidence, record.targetLien.position.evidenceIds);
      }
      return result(check, "CANNOT_CONFIRM", record.targetLien.positionBasis === "FIRST_IN_TIME"
        ? `A first-in-time screening position was developed as ${record.targetLien.position.value}, but priority confidence is ${record.targetLien.positionConfidence}; examiner/jurisdiction-specific priority review is required.`
        : "Target lien position could not be established from express priority evidence or reliable first-in-time recording chronology.", record.targetLien.position.evidence, record.targetLien.position.evidenceIds);
    }

    case "HOA_STATUS_REVIEWED":
      if (secondLienSearch(record)) return result(check, "NOT_APPLICABLE", "Not applicable to the RCS 2nd Lien package, which does not require HOA material.");
      return factAnswered(record.flags.hoa)
        ? result(check, "PASS", `HOA status reported as: ${record.flags.hoa.value}.`, record.flags.hoa.evidence, record.flags.hoa.evidenceIds)
        : result(check, "CANNOT_CONFIRM", "HOA applicability was not expressly established by the packet evidence.", record.flags.hoa.evidence, record.flags.hoa.evidenceIds);

    case "CCRS_REVIEWED":
      if (secondLienSearch(record)) return result(check, "NOT_APPLICABLE", "Not applicable to the RCS 2nd Lien package, which expressly omits HOA/CC&R material.");
      return factAnswered(record.flags.ccrs)
        ? result(check, "PASS", `CC&R status reported as: ${record.flags.ccrs.value}.`, record.flags.ccrs.evidence, record.flags.ccrs.evidenceIds)
        : result(check, "CANNOT_CONFIRM", "CC&R applicability/copies were not expressly established by packet evidence.", record.flags.ccrs.evidence, record.flags.ccrs.evidenceIds);

    case "HOA_NAME_AMOUNTS_REVIEWED": {
      if (secondLienSearch(record)) return result(check, "NOT_APPLICABLE", "Not applicable to the RCS 2nd Lien package.");
      if (factAnswered(record.flags.hoa) && negativeOrNA(record.flags.hoa.value)) return result(check, "NOT_APPLICABLE", `HOA is not applicable: ${record.flags.hoa.value}.`, record.flags.hoa.evidence, record.flags.hoa.evidenceIds);
      const associations = record.instruments.filter((item) => /hoa|homeowners|association|condominium|assessment lien/i.test(item.type));
      const evidence = associations.flatMap((item) => item.evidence).concat(record.flags.hoa.evidence);
      const ids = [...new Set(associations.flatMap((item) => item.evidenceIds || []).concat(record.flags.hoa.evidenceIds || []))];
      const details = associations.map((item) => {
        const holder = item.parties.find((party) => /association|creditor|claimant|lienor|beneficiary/i.test(party.role))?.name || item.parties[0]?.name || "name not stated";
        return `${holder} · ${item.amount}`;
      });
      if (details.length && details.some((value) => !/Needs review/.test(value))) return result(check, "PASS", `HOA/association detail found: ${details.join(" | ")}.`, evidence, ids);
      return result(check, "CANNOT_CONFIRM", "HOA may be applicable, but the association name and amount information were not both established from the normalized evidence.", evidence, ids);
    }

    case "DEED_MORTGAGE_ACCURACY":
      return deedMortgageAccuracy(record, titleSummaryReconciliation, check);

    case "RECORDED_DOCUMENTS_RECONCILE": {
      const reconciliation = titleSummaryReconciliation;
      const evidence = titleSummaryQuestionEvidence(record, reconciliation);
      if (!reconciliation.runSheetDetected) return result(check, "CANNOT_CONFIRM", reconciliation.summary, evidence.refs, evidence.ids);
      if (reconciliation.mismatched || reconciliation.sourceOmittedFromRunSheet.length) return result(check, "FAIL", reconciliation.summary, evidence.refs, evidence.ids);
      if (reconciliation.sourceMissing || reconciliation.referencedButMissing.length) return result(check, "CANNOT_CONFIRM", reconciliation.summary, evidence.refs, evidence.ids);
      return result(check, "PASS", reconciliation.summary, evidence.refs, evidence.ids);
    }

    case "RECORDING_ORDER_RECONCILES":
      return result(check, "CANNOT_CONFIRM", currentOwnerSearch(record)
        ? "Confirm the RCS Current Owner sequence: qualifying full-value deed and concurrent institutional purchase-money mortgage, then reconcile later recorded instruments by their actual recording dates."
        : "Recording/chain order requires semantic review against the selected order profile and is intentionally not inferred from global PDF page order.", record.deeds.flatMap((item) => item.evidence).concat(record.mortgages.flatMap((item) => item.evidence)), record.deeds.flatMap((item) => item.evidenceIds || []).concat(record.mortgages.flatMap((item) => item.evidenceIds || [])));

    case "ASSIGNMENT_CHAIN_COMPLETE":
      return result(check, "CANNOT_CONFIRM", "Assignment/beneficiary continuity requires semantic review of the normalized mortgage and assignment parties.", [...record.mortgages, ...record.assignments].flatMap((item) => item.evidence), [...record.mortgages, ...record.assignments].flatMap((item) => item.evidenceIds || []));

    case "LEGAL_DESCRIPTION_RECONCILES": {
      const descriptions = [record.legalDescription.value, ...record.deeds.map((item) => item.legalDescription), ...record.mortgages.map((item) => item.legalDescription)].filter((value) => value && value !== "Needs review");
      const evidence = [record.legalDescription.evidence, ...record.deeds.map((item) => item.evidence), ...record.mortgages.map((item) => item.evidence)].flat();
      const ids = [record.legalDescription.evidenceIds || [], ...record.deeds.map((item) => item.evidenceIds || []), ...record.mortgages.map((item) => item.evidenceIds || [])].flat();
      if (descriptions.length < 2) return result(check, "CANNOT_CONFIRM", "Fewer than two applicable legal descriptions were normalized for comparison.", evidence, ids);
      const normalized = descriptions.map((value) => value.toLowerCase().replace(/[^a-z0-9]/g, ""));
      if (normalized.every((value) => value === normalized[0])) return result(check, "PASS", "Applicable normalized legal descriptions match exactly after formatting normalization.", evidence, ids);
      return result(check, "CANNOT_CONFIRM", "Legal-description text differs across sources and requires the semantic legal-description checker before a material discrepancy can be declared.", evidence, ids);
    }

    case "MERS_BENEFICIARY_REVIEWED": {
      if (!record.mortgages.length) return result(check, "NOT_APPLICABLE", "No mortgage/deed-of-trust security instrument was normalized, so MERS beneficiary review is not applicable.");
      if (factAnswered(record.flags.mers)) return result(check, "PASS", `MERS status: ${record.flags.mers.value}.`, record.flags.mers.evidence, record.flags.mers.evidenceIds);
      const mersMortgage = record.mortgages.find((item) => item.parties.some((party) => /mers|mortgage electronic registration systems/i.test(party.name)));
      if (mersMortgage) return result(check, "PASS", `MERS appears on the security instrument ${mersMortgage.instrumentNumber}.`, mersMortgage.evidence, mersMortgage.evidenceIds);
      return result(check, "CANNOT_CONFIRM", "MERS applicability/original-beneficiary treatment was not expressly established from the normalized evidence.", record.mortgages.flatMap((item) => item.evidence), record.mortgages.flatMap((item) => item.evidenceIds || []));
    }

    case "FEDERAL_TAX_LIEN_REVIEWED": {
      if (secondLienSearch(record)) return result(check, "NOT_APPLICABLE", "Federal tax lien review is outside the RCS 2nd Lien package scope.");
      const value = record.flags.federalTaxLien.value.toLowerCase();
      if (/none|no federal|not found|n\/a|not applicable/.test(value) && record.flags.federalTaxLien.state === "CONFIRMED") return result(check, "PASS", `Federal tax lien status: ${record.flags.federalTaxLien.value}.`, record.flags.federalTaxLien.evidence, record.flags.federalTaxLien.evidenceIds);
      if (/federal|irs|tax lien/.test(value) && !/none|not found|no federal/.test(value)) return result(check, "FAIL", `Federal tax lien identified: ${record.flags.federalTaxLien.value}.`, record.flags.federalTaxLien.evidence, record.flags.federalTaxLien.evidenceIds);
      return result(check, "CANNOT_CONFIRM", "Federal tax lien status was not expressly established by the extracted evidence.", record.flags.federalTaxLien.evidence, record.flags.federalTaxLien.evidenceIds);
    }

    case "RELEASES_RECONCILED":
      return result(check, "CANNOT_CONFIRM", "Release/satisfaction applicability requires semantic review of open liens, references, and supplied release instruments.", [...record.mortgages, ...record.releases].flatMap((item) => item.evidence), [...record.mortgages, ...record.releases].flatMap((item) => item.evidenceIds || []));

    case "PROPERTY_IDENTITY_RECONCILES": {
      const secured = record.mortgages.map((item) => item.propertyAddress).filter((value) => value && value !== "Needs review");
      const evidence = [record.propertyAddress.evidence, ...record.mortgages.map((item) => item.evidence)].flat();
      const ids = [record.propertyAddress.evidenceIds || [], ...record.mortgages.map((item) => item.evidenceIds || [])].flat();
      if (!secured.length) return result(check, "CANNOT_CONFIRM", "The secured-property address was not normalized from the mortgage/deed-of-trust evidence.", evidence, ids);
      const expected = normalizeAddress(record.propertyAddress.value);
      if (expected && secured.every((value) => normalizeAddress(value) === expected)) return result(check, "PASS", "Property address reconciles to the supplied mortgage/security instrument.", evidence, ids);
      return result(check, "FAIL", "Property address does not reconcile across the title summary and mortgage/security evidence.", evidence, ids);
    }

    case "LOAN_DOCUMENT_TYPE_REVIEWED": {
      const loan = controllingSecurityInstrument(record);
      if (!loan) return result(check, "CANNOT_CONFIRM", "No controlling mortgage/deed-of-trust instrument was established for loan-document-type review.");
      return result(check, "PASS", `Loan document type: ${loan.type}.`, loan.evidence, loan.evidenceIds);
    }

    case "LOAN_RECORDING_DATE_REVIEWED": {
      const loan = controllingSecurityInstrument(record);
      if (!loan || loan.recordingDate === "Needs review") return result(check, "CANNOT_CONFIRM", "The controlling security instrument recording date was not established.", loan?.evidence || [], loan?.evidenceIds || []);
      return result(check, "PASS", `Controlling loan recording date: ${loan.recordingDate}.`, loan.evidence, loan.evidenceIds);
    }

    case "LOAN_STATUS_REVIEWED": {
      const loan = controllingSecurityInstrument(record);
      if (!loan) return result(check, "CANNOT_CONFIRM", "No controlling security instrument was established for loan-status review.");
      const stack = record.foreclosureAnalysis.lienStack.find((entry) => entry.instrumentId === loan.id);
      const trailing = record.instruments.filter((item) => /notice of default|trustee|foreclosure|sale/i.test(item.type) && (item.referencedInstrumentNumbers.some((number) => number.replace(/\W/g, "") === loan.instrumentNumber.replace(/\W/g, "")) || item.parties.some((party) => loan.parties.some((loanParty) => normalizeName(loanParty.name).some((token) => normalizeName(party.name).includes(token))))));
      const evidence = loan.evidence.concat(trailing.flatMap((item) => item.evidence));
      const ids = [...new Set((loan.evidenceIds || []).concat(trailing.flatMap((item) => item.evidenceIds || [])))];
      if (stack?.status === "RELEASED") return result(check, "PASS", `Loan/lien status: Satisfied/Released. ${loan.instrumentNumber} is excluded from the open-lien stack.`, evidence, ids);
      if (stack?.status === "OPEN" && trailing.length) return result(check, "PASS", `Loan/lien status: Open with foreclosure/default-related trailing document evidence (${trailing.map((item) => item.type).join(", ")}).`, evidence, ids);
      if (stack?.status === "OPEN") return result(check, "PASS", "Loan/lien status: Active/Open (unreleased). No separate default conclusion is inferred without supporting evidence.", evidence, ids);
      return result(check, "CANNOT_CONFIRM", `Loan/lien status is unresolved. Source status was ${loan.status}.`, evidence, ids);
    }

    case "RECOURSE_REVIEWED": {
      const loan = controllingSecurityInstrument(record);
      if (!loan) return result(check, "NOT_APPLICABLE", "No controlling security instrument was established, so recourse review is not applicable.");
      const recourseEvidence = loan.evidence.filter((item) => /\brecourse\b|non[- ]?recourse|without recourse/i.test(item.quote));
      const ids = recourseEvidence.map((ref) => {
        const index = loan.evidence.findIndex((candidate) => candidate === ref);
        return index >= 0 ? (loan.evidenceIds || [])[index] : undefined;
      }).filter((id): id is string => Boolean(id));
      if (recourseEvidence.length) return result(check, "PASS", `Recourse language is expressly present in the controlling loan evidence: ${recourseEvidence[0].quote}.`, recourseEvidence, ids);
      return result(check, "CANNOT_CONFIRM", "Recourse status is not expressly stated in the normalized loan evidence; Vera response should remain Not Provided unless an examiner locates supporting language.", loan.evidence, loan.evidenceIds || []);
    }

    case "MATERIAL_REPORT_ERRORS_REVIEWED": {
      const reconciliation = titleSummaryReconciliation;
      const mismatches = reconciliation.entries.flatMap((entry) => entry.mismatches);
      const evidence = titleSummaryQuestionEvidence(record, reconciliation);
      if (mismatches.length) return result(check, "FAIL", `${mismatches.length} material title-summary/source field mismatch${mismatches.length === 1 ? "" : "es"} identified: ${mismatches.slice(0, 4).map((item) => `${item.field} (${item.runSheetValue} vs ${item.sourceValue})`).join("; ")}.`, evidence.refs, evidence.ids);
      if (reconciliation.sourceOmittedFromRunSheet.length) return result(check, "FAIL", `${reconciliation.sourceOmittedFromRunSheet.length} material supplied source instrument(s) were omitted from the title summary.`, evidence.refs, evidence.ids);
      if (reconciliation.sourceMissing || reconciliation.referencedButMissing.length) return result(check, "CANNOT_CONFIRM", `Title-report error review cannot close because source support is incomplete. ${reconciliation.summary}`, evidence.refs, evidence.ids);
      if (reconciliation.runSheetDetected) return result(check, "PASS", "No deterministic title-summary/source field mismatch was identified.", evidence.refs, evidence.ids);
      return result(check, "CANNOT_CONFIRM", "Material title-report error review cannot close until the opening title summary is segmented.");
    }

    case "PLAT_REQUIREMENT_REVIEWED":
      return result(check, "CANNOT_CONFIRM", "Plat applicability requires semantic review of the legal description, references, and selected order profile.", record.flags.plat.evidence, record.flags.plat.evidenceIds);

    case "MIN_RUN_SHEET_REVIEWED": {
      if (!record.mortgages.length) return result(check, "NOT_APPLICABLE", "No mortgage/deed-of-trust instrument is present; MIN review is not applicable.");
      if (factAnswered(record.flags.mers) && negativeOrNA(record.flags.mers.value)) return result(check, "NOT_APPLICABLE", `MERS is not applicable: ${record.flags.mers.value}.`, record.flags.mers.evidence, record.flags.mers.evidenceIds);
      if (record.flags.min.state !== "CONFIRMED" || record.flags.min.value === "Needs review") return result(check, "CANNOT_CONFIRM", "MIN was not expressly established from the packet evidence.", record.flags.min.evidence, record.flags.min.evidenceIds);
      const pageStart = record.runSheet.detected ? record.runSheet.pageStart : record.titleSummary.pageStart;
      const pageEnd = record.runSheet.detected ? record.runSheet.pageEnd : record.titleSummary.pageEnd;
      const inSummary = record.flags.min.evidence.some((item) => pageStart != null && pageEnd != null && item.page >= pageStart && item.page <= pageEnd);
      return inSummary
        ? result(check, "PASS", `MIN ${record.flags.min.value} appears in the applicable report/run-sheet summary.`, record.flags.min.evidence, record.flags.min.evidenceIds)
        : result(check, "CANNOT_CONFIRM", `MIN ${record.flags.min.value} was extracted, but its presence in the applicable report/run-sheet summary was not established.`, record.flags.min.evidence, record.flags.min.evidenceIds);
    }

    case "RUN_SHEET_RECONCILES": {
      const distinct = record.runSheet.detected;
      const reconciliation = distinct ? runSheetReconciliation : titleSummaryReconciliation;
      const evidence = titleSummaryQuestionEvidence(record, reconciliation);
      const label = distinct ? "Distinct Abstractor/Run Sheet" : "RCS title-report Exceptions summary (report run sheet)";
      if (!distinct && !record.titleSummary.detected) return result(check, "CANNOT_CONFIRM", "No applicable report run sheet/Exceptions summary or separate Abstractor Sheet could be segmented from the packet.");
      if (reconciliation.mismatched || reconciliation.sourceOmittedFromRunSheet.length) return result(check, "FAIL", `${label} does not reconcile. ${reconciliation.summary}`, evidence.refs, evidence.ids);
      if (reconciliation.sourceMissing || reconciliation.referencedButMissing.length) return result(check, "CANNOT_CONFIRM", `${label} cannot be fully confirmed. ${reconciliation.summary}`, evidence.refs, evidence.ids);
      return result(check, "PASS", `${label} reconciles to the supplied source instruments. ${reconciliation.summary}`, evidence.refs, evidence.ids);
    }
  }
}

export function initialCanonicalQc(record: CanonicalTitleRecord, titleSummaryReconciliation: RunSheetReconciliation, runSheetReconciliation: RunSheetReconciliation): QcProfileResult {
  const profile = record.orderType.state === "CONFIRMED" ? profileForOrderType(record.orderType.value) : UNRESOLVED_QC_PROFILE;
  const checks = profile.checks.map((check) => profileCheck(check, record, titleSummaryReconciliation, runSheetReconciliation));
  return reduceQcChecks({ profileId: profile.id, profileVersion: profile.version, profileName: profile.name }, checks);
}

export function applyCheckerResolutions(initial: QcProfileResult, resolutions: CheckerResolution[], evidenceResolver: (ids: string[]) => EvidenceRef[]): QcProfileResult {
  const resolutionMap = new Map(resolutions.map((item) => [item.checkId, item]));
  const checks = initial.checks.map((check) => {
    if (check.status !== "CANNOT_CONFIRM") return check;
    const resolution = resolutionMap.get(check.id);
    if (!resolution) return check;
    const evidence = evidenceResolver(resolution.evidenceIds);
    const conclusive = resolution.status === "PASS" || resolution.status === "FAIL";
    if (conclusive && (!resolution.evidenceIds.length || !evidence.length)) return check;
    return {
      ...check,
      status: resolution.status,
      summary: resolution.summary || check.summary,
      evidence,
      evidenceIds: resolution.evidenceIds,
      recommendedAction: resolution.status === "PASS" || resolution.status === "NOT_APPLICABLE" ? "No curative action required for this check." : check.recommendedAction,
    };
  });
  return reduceQcChecks(initial, checks);
}
