import assert from "node:assert/strict";
import { buildCanonicalTitleRecordFromExtraction } from "../lib/canonical-title-builder";
import { initialCanonicalQc } from "../lib/canonical-qc-engine";
import type { PacketExtractionLedger } from "../lib/document-engine";
import { MCCALLA_EXPORT_PROFILE, renderCsv, validateExportProfile } from "../lib/export-profiles";
import { jurisdictionAnalysisForRecord, mergeJurisdictionRequirements } from "../lib/jurisdiction-rules";
import { loopDecision, mayRetry } from "../lib/loop-policy";
import { advancePipeline, assertCanonicalPipeline, createPipelineState } from "../lib/pipeline";
import { applyReviewDecisions } from "../lib/review-decision-reducer";
import { reconcileRunSheet, reconcileTitleSummary } from "../lib/run-sheet-reconciler";
import { buildEvidenceLedger } from "../lib/title-evidence-ledger";
import type { RawEvidenceAnchor, RawFact, RawTitlePacketExtraction } from "../lib/title-extraction-model";
import type { TitleReviewResult } from "../lib/title-domain";

function anchor(quote: string, page: number, documentType: string, instrumentNumber = "", confidence = 0.98): RawEvidenceAnchor { return { quote, page, documentType, instrumentNumber, confidence }; }
function fact(value: string, evidence: RawEvidenceAnchor[] = []): RawFact { return { value, evidence }; }

const p1 = "Title Search Report Order Number: 2025-TEST Search Type: Current Owner Search Property Address: 123 Main St Austin TX 78701 Current Owner: Jane Doe Borrower: Jane Doe Order completed with current owner FVD. Mortgage Instrument Number 123456 Amount $80,000 Recording Date 01/02/2025 Book/Page 100/201 Judgment Lien Instrument Number 111111 Amount $5,000 Recording Date 12/15/2024 Federal Tax Lien IRS001 Amount $12,000 Recording Date 12/15/2024 Judgment Lien JUNIOR1 recorded 02/01/2025 Federal Tax Lien IRS1";
const p2 = "Warranty Deed Instrument Number 123455 Grantor: Prior Owner Grantee: Jane Doe Consideration $100,000 Document Date 01/01/2025 Recording Date 01/02/2025 Book/Page 100/200 Legal Description: Lot 5 Block 2 Example Subdivision";
const p3 = "Deed of Trust Instrument Number 123456 Borrower: Jane Doe Beneficiary: Example Bank Amount: $80,000 Document Date 01/01/2025 Recording Date 01/02/2025 Book/Page 100/201 Property Address: 123 Main St Austin TX 78701 Legal Description: Lot 5 Block 2 Example Subdivision";

function nativeLedger(): PacketExtractionLedger {
  return { version: 3, packetHash: "packet-test", sourceFile: "synthetic-title-report.pdf", pageCount: 3, totalCharacters: p1.length + p2.length + p3.length, textCoverage: 1, usableTextPages: 3, lowTextPages: [], nativeTextReady: true, pages: [
    { page: 1, text: p1, charCount: p1.length, documentHint: "Title Report", needsVisualReview: false },
    { page: 2, text: p2, charCount: p2.length, documentHint: "Deed", needsVisualReview: false },
    { page: 3, text: p3, charCount: p3.length, documentHint: "Mortgage / Deed of Trust", needsVisualReview: false },
  ], extractedAt: new Date().toISOString() };
}

function extraction(): RawTitlePacketExtraction {
  return {
    header: {
      orderNumber: fact("2025-TEST", [anchor("Order Number: 2025-TEST", 1, "Title Search Report")]),
      tsNumber: fact("2025-TEST", [anchor("Order Number: 2025-TEST", 1, "Title Search Report")]),
      searchType: fact("Current Owner Search", [anchor("Search Type: Current Owner Search", 1, "Title Search Report")]),
      state: fact("TX", [anchor("Austin TX 78701", 1, "Title Search Report")]),
      county: fact("Travis", [anchor("Austin TX 78701", 1, "Title Search Report", "", 0.75)]),
      propertyAddress: fact("123 Main St Austin TX 78701", [anchor("Property Address: 123 Main St Austin TX 78701", 1, "Title Search Report")]),
      parcelId: fact("ABC-123"), effectiveDate: fact("01/03/2025"),
      legalDescription: fact("Lot 5 Block 2 Example Subdivision", [anchor("Legal Description: Lot 5 Block 2 Example Subdivision", 2, "Warranty Deed", "123455")]),
      borrower: fact("Jane Doe", [anchor("Borrower: Jane Doe", 3, "Deed of Trust", "123456")]),
      currentOwner: fact("Jane Doe", [anchor("Grantee: Jane Doe", 2, "Warranty Deed", "123455")]),
    },
    runSheet: {
      detected: true, pageStart: 1, pageEnd: 1, basis: "Opening Title Search Report / Exceptions summary.",
      evidence: [anchor("Title Search Report Order Number: 2025-TEST", 1, "Title Search Report")],
      entries: [
        { category: "Vesting", instrumentType: "Warranty Deed", instrumentNumber: "123455", bookPage: "100/200", documentDate: "01/01/2025", recordingDate: "01/02/2025", amount: "$100,000", parties: "Prior Owner to Jane Doe", legalDescription: "Lot 5 Block 2 Example Subdivision", evidence: [anchor("Order completed with current owner FVD", 1, "Title Search Report", "123455")] },
        { category: "Mortgage", instrumentType: "Deed of Trust", instrumentNumber: "123456", bookPage: "100/201", documentDate: "01/01/2025", recordingDate: "01/02/2025", amount: "$80,000", parties: "Jane Doe / Example Bank", legalDescription: "Lot 5 Block 2 Example Subdivision", evidence: [anchor("Mortgage Instrument Number 123456 Amount $80,000 Recording Date 01/02/2025 Book/Page 100/201", 1, "Title Search Report", "123456")] },
      ],
    },
    instruments: [
      { type: "Warranty Deed", instrumentNumber: "123455", bookPage: "100/200", documentDate: "01/01/2025", recordingDate: "01/02/2025", amount: "$100,000", status: "Recorded", parties: [{ name: "Prior Owner", role: "Grantor" }, { name: "Jane Doe", role: "Grantee" }], propertyAddress: "123 Main St Austin TX 78701", legalDescription: "Lot 5 Block 2 Example Subdivision", referencedInstrumentNumbers: [], evidence: [anchor("Warranty Deed Instrument Number 123455 Grantor: Prior Owner Grantee: Jane Doe Consideration $100,000", 2, "Warranty Deed", "123455"), anchor("Book/Page 100/200 Legal Description: Lot 5 Block 2 Example Subdivision", 2, "Warranty Deed", "123455")] },
      { type: "Deed of Trust", instrumentNumber: "123456", bookPage: "100/201", documentDate: "01/01/2025", recordingDate: "01/02/2025", amount: "$80,000", status: "Open", parties: [{ name: "Jane Doe", role: "Borrower" }, { name: "Example Bank", role: "Beneficiary" }], propertyAddress: "123 Main St Austin TX 78701", legalDescription: "Lot 5 Block 2 Example Subdivision", referencedInstrumentNumbers: [], evidence: [anchor("Deed of Trust Instrument Number 123456 Borrower: Jane Doe Beneficiary: Example Bank Amount: $80,000", 3, "Deed of Trust", "123456"), anchor("Book/Page 100/201 Property Address: 123 Main St Austin TX 78701 Legal Description: Lot 5 Block 2 Example Subdivision", 3, "Deed of Trust", "123456")] },
    ],
    references: [],
    taxes: { status: fact("Not Stated"), fiscalYear: fact("Not Stated"), landValue: fact("Not Stated"), improvements: fact("Not Stated") },
    flags: { hoa: fact("Not Stated"), ccrs: fact("Not Stated"), federalTaxLien: fact("Not Stated"), bankruptcy: fact("Not Stated"), plat: fact("Not Stated"), mers: fact("Not Stated"), min: fact("Not Stated") },
    targetLienHint: { instrumentNumber: fact("Not Stated"), position: fact("Not Stated") }, extractionSummary: "Synthetic extraction fixture.",
  };
}

function build(raw = extraction(), requestedSearchType?: string) {
  const native = nativeLedger();
  const ledger = buildEvidenceLedger({ packetHash: native.packetHash, sourceFile: native.sourceFile, pageCount: native.pageCount, extractionMode: "native-text", extraction: raw, nativeLedger: native });
  const record = buildCanonicalTitleRecordFromExtraction({ extraction: raw, ledger, clientName: "McCalla", requestedSearchType });
  const titleSummaryReconciliation = reconcileTitleSummary(record);
  const runSheetReconciliation = reconcileRunSheet(record);
  const qc = initialCanonicalQc(record, titleSummaryReconciliation, runSheetReconciliation);
  const review: TitleReviewResult = { engineVersion: "test", record: { ...record, reviewId: "review-test" }, qc, pipeline: { stages: ["INGEST", "EXTRACT", "CLASSIFY", "NORMALIZE", "CHECK", "GROUND", "RENDER", "RECORD"], completedThrough: "RECORD" } };
  return { native, ledger, record, titleSummaryReconciliation, runSheetReconciliation, qc, review };
}

function testPipelineGraph() {
  let pipeline = createPipelineState();
  for (const stage of ["INGEST", "EXTRACT", "CLASSIFY", "NORMALIZE", "CHECK", "GROUND", "RENDER", "RECORD", "COMPLETE"] as const) pipeline = advancePipeline(pipeline, stage);
  assertCanonicalPipeline(pipeline);
  assert.throws(() => advancePipeline(createPipelineState(), "CHECK"), /Illegal Cybrid Title pipeline transition/);
}

function testLoopPolicy() {
  assert.equal(loopDecision("GROUNDING_UNSUPPORTED").action, "REDUCE_TO_CANNOT_CONFIRM");
  assert.equal(loopDecision("CLASSIFICATION_AMBIGUOUS").action, "REQUIRE_HUMAN_PROFILE");
  assert.equal(loopDecision("BATCH_ITEM_FAILED").action, "ISOLATE_AND_CONTINUE_BATCH");
  assert.equal(mayRetry("PROVIDER_RATE_LIMIT", 0), true); assert.equal(mayRetry("PROVIDER_RATE_LIMIT", 2), false); assert.equal(mayRetry("GROUNDING_UNSUPPORTED", 0), false);
}

function testEvidenceLedgerGrounding() {
  const { ledger } = build(); assert.ok(ledger.evidence.length >= 8); assert.ok(ledger.evidence.some((node) => node.nativeVerified));
  const raw = extraction(); raw.header.borrower = fact("Imaginary Borrower", [anchor("This quote does not exist on page three", 3, "Deed of Trust", "123456")]);
  const native = nativeLedger(); const bad = buildEvidenceLedger({ packetHash: native.packetHash, sourceFile: native.sourceFile, pageCount: 3, extractionMode: "native-text", extraction: raw, nativeLedger: native });
  assert.equal(bad.evidence.find((candidate) => candidate.quote.includes("does not exist"))?.nativeVerified, false);
}

function testCanonicalNormalization() {
  const { record } = build(); assert.equal(record.schemaVersion, 2); assert.equal(record.borrower.value, "Jane Doe"); assert.equal(record.currentOwner.value, "Jane Doe"); assert.equal(record.titleSummary.detected, true); assert.equal(record.titleSummary.entries.length, 2); assert.equal(record.runSheet.detected, false, "RCS report run sheet must remain distinct from a separately labeled Abstractor Sheet.");
}

function testBorrowerFailsClosed() {
  const raw = extraction(); raw.header.borrower = fact("Not Stated"); const { record } = build(raw); assert.equal(record.borrower.value, "Needs review"); assert.equal(record.currentOwner.value, "Jane Doe"); assert.ok(record.dataQualityWarnings.some((warning) => /Borrower is unresolved/.test(warning)));
}

function testSingleMortgageDevelopsAmountAndPosition() {
  const { record } = build(); assert.equal(record.targetLien.instrumentId, null); assert.equal(record.targetLien.selectionRequired, false); assert.equal(record.foreclosureAnalysis.openLienCount, 1); assert.ok(!record.foreclosureAnalysis.requirements.some((item) => item.code.startsWith("TARGET_LIEN_")));
  const foreclosure = build(extraction(), "Foreclosure").record; assert.equal(foreclosure.targetLien.instrumentNumber.value, "123456"); assert.equal(foreclosure.targetLien.amount.value, "$80,000"); assert.equal(foreclosure.targetLien.position.value, "1st Lien"); assert.equal(foreclosure.targetLien.positionBasis, "FIRST_IN_TIME");
}

function testMultipleMortgagesRequireTargetSelectionWhenSummaryIncomplete() {
  const raw = extraction(); raw.instruments.push({ ...raw.instruments[1], instrumentNumber: "654321", bookPage: "100/202", recordingDate: "02/01/2025", amount: "$20,000", evidence: [anchor("Deed of Trust Instrument Number 654321 Amount $20,000 Recording Date 02/01/2025", 3, "Deed of Trust", "654321")] });
  const currentOwner = build(raw); assert.equal(currentOwner.record.mortgages.length, 2); assert.equal(currentOwner.record.targetLien.selectionRequired, false); assert.equal(validateExportProfile(MCCALLA_EXPORT_PROFILE, [{ record: currentOwner.review.record, qc: currentOwner.review.qc }]).some((warning) => /Lien Amount|Lien Position/.test(warning)), false);
  const { record, review } = build(raw, "Foreclosure"); assert.equal(record.mortgages.length, 2); assert.equal(record.targetLien.selectionRequired, true); assert.equal(record.targetLien.position.value, "Needs review"); const warnings = validateExportProfile(MCCALLA_EXPORT_PROFILE, [{ record: review.record, qc: review.qc }]); assert.ok(warnings.some((warning) => /Lien Amount|Lien Position/.test(warning)));
}

function testFirstInTimeAcrossOpenLienStack() {
  const raw = extraction(); raw.targetLienHint.instrumentNumber = fact("123456", [anchor("Mortgage Instrument Number 123456", 1, "Title Search Report", "123456")]); raw.instruments.push({ type: "Judgment Lien", instrumentNumber: "111111", bookPage: "90/100", documentDate: "12/01/2024", recordingDate: "12/15/2024", amount: "$5,000", status: "Open", parties: [{ name: "Judgment Creditor", role: "Creditor" }, { name: "Jane Doe", role: "Debtor" }], propertyAddress: "123 Main St Austin TX 78701", legalDescription: "Needs review", referencedInstrumentNumbers: [], evidence: [anchor("Judgment Lien Instrument Number 111111 Amount $5,000 Recording Date 12/15/2024", 1, "Judgment Lien", "111111")] });
  const { record } = build(raw, "Foreclosure"); assert.equal(record.targetLien.position.value, "2nd Lien"); assert.equal(record.foreclosureAnalysis.seniorLienIds.length, 1); assert.ok(record.foreclosureAnalysis.requirements.some((item) => item.type === "PAYOFF_REVIEW"));
}

function testStatutoryPriorityExceptionIsFlagged() {
  const raw = extraction(); raw.targetLienHint.instrumentNumber = fact("123456", [anchor("Mortgage Instrument Number 123456", 1, "Title Search Report", "123456")]); raw.instruments.push({ type: "Federal Tax Lien", instrumentNumber: "IRS001", bookPage: "90/101", documentDate: "12/01/2024", recordingDate: "12/15/2024", amount: "$12,000", status: "Open", parties: [{ name: "United States", role: "Creditor" }, { name: "Jane Doe", role: "Taxpayer" }], propertyAddress: "123 Main St Austin TX 78701", legalDescription: "Needs review", referencedInstrumentNumbers: [], evidence: [anchor("Federal Tax Lien IRS001 Amount $12,000 Recording Date 12/15/2024", 1, "Federal Tax Lien", "IRS001")] });
  const { record } = build(raw, "Foreclosure"); assert.equal(record.targetLien.position.value, "2nd Lien"); assert.ok(record.foreclosureAnalysis.requirements.some((item) => item.code.startsWith("STACK_EXCEPTION_") && item.type === "PRIORITY_REVIEW"));
}

function testCurrentOwnerKeepsVera20ButExcludesForeclosureOnlyChecks() {
  const { qc, record } = build(); const ids = new Set(qc.checks.map((check) => check.id));
  assert.equal(ids.has("TARGET_LIEN_FOUND"), false); assert.equal(ids.has("TARGET_LIEN_POSITION_ESTABLISHED"), false);
  assert.equal(ids.has("FEDERAL_TAX_LIEN_REVIEWED"), true); assert.equal(ids.has("RELEASES_RECONCILED"), true); assert.equal(ids.has("PLAT_REQUIREMENT_REVIEWED"), true);
  assert.equal(qc.checks.filter((check) => check.legacyQuestionNumber).length, 20); assert.equal(record.targetLien.instrumentId, null); assert.equal(record.targetLien.selectionRequired, false); assert.equal(record.targetLien.amount.value, "Needs review"); assert.equal(record.targetLien.position.value, "Needs review"); assert.equal(record.foreclosureAnalysis.requirements.some((item) => item.scope === "FORECLOSURE_PROCESS"), false);
}

function testCurrentOwnerDoesNotRequireSecondDeed() {
  const { qc } = build(); const fvd = qc.checks.find((check) => check.id === "PRIOR_OWNER_ESTABLISHED"); const pmm = qc.checks.find((check) => check.id === "OWNERSHIP_CHAIN_COMPLETE");
  assert.match(fvd?.label || "", /full-value deed/i); assert.match(fvd?.summary || "", /qualifying non-family full-value/i); assert.doesNotMatch(fvd?.summary || "", /second qualifying owner/i); assert.match(pmm?.label || "", /purchase-money mortgage/i); assert.match(pmm?.summary || "", /do not require an extra deed/i);
}

function testVera20NumberingComplete() {
  const { qc } = build(); const numbers = qc.checks.map((check) => check.legacyQuestionNumber).filter((value): value is number => typeof value === "number").sort((a, b) => a - b);
  assert.deepEqual(numbers, Array.from({ length: 20 }, (_, index) => index + 1));
}

function testRcsExceptionsSummaryActsAsReportRunSheet() {
  const { record, qc } = build(); assert.equal(record.runSheet.detected, false); assert.equal(record.titleSummary.detected, true); assert.equal(qc.checks.find((check) => check.id === "RUN_SHEET_RECONCILES")?.status, "PASS");
}

function testTitleSummaryMismatchFailsQuestion20() {
  const raw = extraction(); raw.runSheet.entries[1] = { ...raw.runSheet.entries[1], recordingDate: "01/03/2025" };
  const { titleSummaryReconciliation, qc, record } = build(raw); assert.equal(titleSummaryReconciliation.mismatched, 1); assert.equal(qc.checks.find((check) => check.id === "MATERIAL_REPORT_ERRORS_REVIEWED")?.status, "FAIL"); assert.equal(record.runSheet.detected, false); assert.equal(qc.checks.find((check) => check.id === "RUN_SHEET_RECONCILES")?.status, "FAIL");
}

function testDistinctRunSheetMismatch() {
  const raw = extraction(); raw.runSheet.evidence = [anchor("RCS Abstractor Sheet", 1, "RCS Abstractor Sheet")]; raw.runSheet.entries[1] = { ...raw.runSheet.entries[1], amount: "$81,000" };
  const { record, runSheetReconciliation, qc } = build(raw); assert.equal(record.runSheet.detected, true); assert.equal(runSheetReconciliation.mismatched, 1); assert.equal(qc.checks.find((check) => check.id === "RUN_SHEET_RECONCILES")?.status, "FAIL");
}

function testMissingReferencedInstrumentCannotConfirm() {
  const raw = extraction(); raw.references.push({ description: "Referenced covenant", documentType: "CC&R", instrumentNumber: "999", bookPage: "", evidence: [anchor("Referenced covenant instrument 999", 1, "Title Search Report", "999")] });
  const { titleSummaryReconciliation, qc } = build(raw); assert.equal(titleSummaryReconciliation.referencedButMissing.length, 1); assert.equal(qc.checks.find((check) => check.id === "RECORDED_DOCUMENTS_RECONCILE")?.status, "CANNOT_CONFIRM");
}

function testUnknownProfileFailsClosed() {
  const raw = extraction(); raw.header.searchType = fact("Not Stated"); const { record, qc } = build(raw); assert.equal(record.orderType.value, "Needs review"); assert.equal(qc.profileId, "profile-unresolved-v4"); assert.equal(qc.checks.filter((check) => check.legacyQuestionNumber).length, 20);
}

function testMcCallaExportRequiredFields() {
  const currentOwner = build(); assert.equal(validateExportProfile(MCCALLA_EXPORT_PROFILE, [{ record: currentOwner.review.record, qc: currentOwner.review.qc }]).some((warning) => /Lien Amount|Lien Position|Borrower/.test(warning)), false);
  const { review } = build(extraction(), "Foreclosure"); const readyWarnings = validateExportProfile(MCCALLA_EXPORT_PROFILE, [{ record: review.record, qc: review.qc }]); assert.equal(readyWarnings.length, 0);
  const blocked = { ...review.record, targetLien: { ...review.record.targetLien, amount: { ...review.record.targetLien.amount, value: "Needs review", state: "NOT_STATED" as const } } };
  const warnings = validateExportProfile(MCCALLA_EXPORT_PROFILE, [{ record: blocked, qc: review.qc }]); assert.ok(warnings.some((warning) => /Lien Amount/.test(warning)));
  const csv = renderCsv(MCCALLA_EXPORT_PROFILE, [{ record: review.record, qc: review.qc }]); assert.match(csv, /\$80,000/); assert.match(csv, /1st Lien/); assert.match(csv, /FIRST_IN_TIME/);
}

function testDecisionReducer() {
  const { review } = build(); const target = review.qc.checks.find((check) => check.status === "CANNOT_CONFIRM"); assert.ok(target);
  const updated = applyReviewDecisions(review, [{ reviewId: "review-test", checkId: target!.id, decision: "CORRECT", correctedStatus: "PASS", correctedValue: "Examiner confirmed from source.", reason: "Verified against controlling document.", actor: "examiner", decidedAt: new Date().toISOString() }]);
  assert.equal(updated.qc.checks.find((check) => check.id === target!.id)?.status, "PASS");
}

function waRecord(withJunior = false, withFederal = false) {
  const raw = extraction(); raw.header.state = fact("WA", [anchor("State of Washington", 1, "Title Search Report")]); raw.header.county = fact("Grays Harbor", [anchor("Grays Harbor County", 1, "Title Search Report")]);
  if (withJunior) raw.instruments.push({ type: "Judgment Lien", instrumentNumber: "JUNIOR1", bookPage: "", documentDate: "02/01/2025", recordingDate: "02/01/2025", amount: "$1,000", status: "Open", parties: [{ name: "Creditor", role: "Creditor" }, { name: "Jane Doe", role: "Debtor" }], propertyAddress: "123 Main St", legalDescription: "Needs review", referencedInstrumentNumbers: [], evidence: [anchor("Judgment Lien JUNIOR1 recorded 02/01/2025", 1, "Judgment Lien", "JUNIOR1")] });
  if (withFederal) { raw.flags.federalTaxLien = fact("Federal Tax Lien", [anchor("Federal Tax Lien", 1, "Title Search Report", "IRS1")]); raw.instruments.push({ type: "Federal Tax Lien", instrumentNumber: "IRS1", bookPage: "", documentDate: "03/01/2025", recordingDate: "03/01/2025", amount: "$5,000", status: "Open", parties: [{ name: "United States", role: "Creditor" }, { name: "Jane Doe", role: "Taxpayer" }], propertyAddress: "123 Main St", legalDescription: "Needs review", referencedInstrumentNumbers: [], evidence: [anchor("Federal Tax Lien IRS1", 1, "Federal Tax Lien", "IRS1")] }); }
  const { record } = build(raw, "Foreclosure"); const analysis = jurisdictionAnalysisForRecord(record); record.foreclosureAnalysis = mergeJurisdictionRequirements(record, analysis); return record;
}

function testWashingtonJurisdictionCoverage() {
  const record = waRecord(false, false); assert.equal(record.foreclosureAnalysis.jurisdictionCoverage?.status, "CURATED"); assert.equal(record.foreclosureAnalysis.jurisdictionCoverage?.state, "WA"); assert.ok(record.foreclosureAnalysis.requirements.some((item) => item.code === "WA_RC61_24_030_DEFAULT_NOTICE" && item.severity === "INFO")); assert.ok(record.foreclosureAnalysis.requirements.some((item) => item.code === "WA_RC61_24_040_NOTICE_OF_SALE" && item.severity === "INFO")); assert.equal(record.foreclosureAnalysis.status, "READY", "Informational future-process requirements must not turn a clean title analysis into curative/review.");
}

function testWashingtonJuniorLienNoticeRule() {
  const record = waRecord(true, false); assert.ok(record.foreclosureAnalysis.requirements.some((item) => item.code === "WA_RC61_24_040_JUNIOR_NOTICE" && item.severity === "REVIEW" && /RCW 61\.24\.040/.test(item.authority || "")));
}

function testFederalTaxLienNoticeRule() {
  const record = waRecord(false, true); assert.ok(record.foreclosureAnalysis.requirements.some((item) => item.code === "FED_IRC7425_NONJUDICIAL_NOTICE" && /7425/.test(item.authority || "")));
}

function testUnsupportedJurisdictionDoesNotInventLaw() {
  const { record } = build(); const analysis = jurisdictionAnalysisForRecord(record); assert.equal(analysis.coverage.status, "GENERAL_ONLY"); assert.equal(analysis.requirements.length, 0);
}

const tests: Array<[string, () => void]> = [
  ["pipeline graph with normalization", testPipelineGraph],
  ["bounded recovery loop", testLoopPolicy],
  ["immutable evidence ledger grounding", testEvidenceLedgerGrounding],
  ["canonical normalization", testCanonicalNormalization],
  ["borrower fails closed", testBorrowerFailsClosed],
  ["Current Owner stays title-only; Foreclosure develops target amount and position", testSingleMortgageDevelopsAmountAndPosition],
  ["multiple mortgages fail closed when summary is incomplete", testMultipleMortgagesRequireTargetSelectionWhenSummaryIncomplete],
  ["first-in-time ranks target across open lien stack", testFirstInTimeAcrossOpenLienStack],
  ["statutory priority exceptions are flagged", testStatutoryPriorityExceptionIsFlagged],
  ["current owner retains Vera 20 but excludes foreclosure-only checks", testCurrentOwnerKeepsVera20ButExcludesForeclosureOnlyChecks],
  ["current owner does not require a second deed", testCurrentOwnerDoesNotRequireSecondDeed],
  ["Vera 20 numbering is complete", testVera20NumberingComplete],
  ["RCS Exceptions summary acts as the report run sheet", testRcsExceptionsSummaryActsAsReportRunSheet],
  ["title-summary mismatch fails Vera Question 20", testTitleSummaryMismatchFailsQuestion20],
  ["distinct Abstractor/Run Sheet mismatch detection", testDistinctRunSheetMismatch],
  ["missing referenced source cannot confirm", testMissingReferencedInstrumentCannotConfirm],
  ["unknown QC profile fails closed", testUnknownProfileFailsClosed],
  ["McCalla export requires lien amount position and basis", testMcCallaExportRequiredFields],
  ["human decision reducer", testDecisionReducer],
  ["Washington jurisdiction coverage is curated and info-only rules do not block", testWashingtonJurisdictionCoverage],
  ["Washington junior lien notice rule is projected", testWashingtonJuniorLienNoticeRule],
  ["federal tax lien nonjudicial-sale rule is projected", testFederalTaxLienNoticeRule],
  ["unsupported jurisdiction does not invent legal rules", testUnsupportedJurisdictionDoesNotInventLaw],
];

for (const [name, test] of tests) { test(); console.log(`ARCHITECTURE_V4 PASS: ${name}`); }
console.log(`ARCHITECTURE_V4 COMPLETE: ${tests.length}/${tests.length} deterministic checks passed.`);
