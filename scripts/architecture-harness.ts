import assert from "node:assert/strict";
import { buildCanonicalTitleRecordFromExtraction } from "../lib/canonical-title-builder";
import { initialCanonicalQc } from "../lib/canonical-qc-engine";
import type { PacketExtractionLedger } from "../lib/document-engine";
import { NCALA_DEMO_EXPORT_PROFILE, renderCsv, validateExportProfile } from "../lib/export-profiles";
import { loopDecision, mayRetry } from "../lib/loop-policy";
import { advancePipeline, assertCanonicalPipeline, createPipelineState } from "../lib/pipeline";
import { applyReviewDecisions } from "../lib/review-decision-reducer";
import { reconcileRunSheet } from "../lib/run-sheet-reconciler";
import { buildEvidenceLedger } from "../lib/title-evidence-ledger";
import type { RawEvidenceAnchor, RawFact, RawTitlePacketExtraction } from "../lib/title-extraction-model";
import type { TitleReviewResult } from "../lib/title-domain";

function anchor(quote: string, page: number, documentType: string, instrumentNumber = "", confidence = 0.98): RawEvidenceAnchor {
  return { quote, page, documentType, instrumentNumber, confidence };
}

function fact(value: string, evidence: RawEvidenceAnchor[] = []): RawFact {
  return { value, evidence };
}

const p1 = "Title Search Report Order Number: 2025-TEST Search Type: Current Owner Search Property Address: 123 Main St Austin TX 78701 Current Owner: Jane Doe Borrower: Jane Doe Mortgage Instrument Number 123456 Amount $80,000 Recording Date 01/02/2025 Book/Page 100/201 Lien Position: First Federal Tax Lien: None Found";
const p2 = "Warranty Deed Instrument Number 123455 Grantor: Prior Owner Grantee: Jane Doe Document Date 01/01/2025 Recording Date 01/02/2025 Book/Page 100/200 Legal Description: Lot 5 Block 2 Example Subdivision";
const p3 = "Deed of Trust Instrument Number 123456 Borrower: Jane Doe Beneficiary: Example Bank Amount: $80,000 Document Date 01/01/2025 Recording Date 01/02/2025 Book/Page 100/201 Property Address: 123 Main St Austin TX 78701 Legal Description: Lot 5 Block 2 Example Subdivision";

function nativeLedger(): PacketExtractionLedger {
  return {
    version: 3,
    packetHash: "packet-test",
    sourceFile: "synthetic-title-report.pdf",
    pageCount: 3,
    totalCharacters: p1.length + p2.length + p3.length,
    textCoverage: 1,
    usableTextPages: 3,
    lowTextPages: [],
    nativeTextReady: true,
    pages: [
      { page: 1, text: p1, charCount: p1.length, documentHint: "Title Report", needsVisualReview: false },
      { page: 2, text: p2, charCount: p2.length, documentHint: "Deed", needsVisualReview: false },
      { page: 3, text: p3, charCount: p3.length, documentHint: "Mortgage / Deed of Trust", needsVisualReview: false },
    ],
    extractedAt: new Date().toISOString(),
  };
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
      parcelId: fact("ABC-123", []),
      effectiveDate: fact("01/03/2025", []),
      legalDescription: fact("Lot 5 Block 2 Example Subdivision", [anchor("Legal Description: Lot 5 Block 2 Example Subdivision", 2, "Warranty Deed", "123455")]),
      borrower: fact("Jane Doe", [anchor("Borrower: Jane Doe", 3, "Deed of Trust", "123456")]),
      currentOwner: fact("Jane Doe", [anchor("Grantee: Jane Doe", 2, "Warranty Deed", "123455")]),
    },
    runSheet: {
      detected: true,
      pageStart: 1,
      pageEnd: 1,
      basis: "Opening Title Search Report summarizes vesting and mortgage recording facts before source instruments.",
      evidence: [anchor("Title Search Report Order Number: 2025-TEST", 1, "Title Search Report")],
      entries: [
        { category: "Vesting", instrumentType: "Warranty Deed", instrumentNumber: "123455", bookPage: "100/200", documentDate: "01/01/2025", recordingDate: "01/02/2025", amount: "", parties: "Prior Owner to Jane Doe", legalDescription: "Lot 5 Block 2 Example Subdivision", evidence: [anchor("Current Owner: Jane Doe", 1, "Title Search Report", "123455")] },
        { category: "Mortgage", instrumentType: "Deed of Trust", instrumentNumber: "123456", bookPage: "100/201", documentDate: "01/01/2025", recordingDate: "01/02/2025", amount: "$80,000", parties: "Jane Doe / Example Bank", legalDescription: "Lot 5 Block 2 Example Subdivision", evidence: [anchor("Mortgage Instrument Number 123456 Amount $80,000 Recording Date 01/02/2025 Book/Page 100/201", 1, "Title Search Report", "123456")] },
      ],
    },
    instruments: [
      { type: "Warranty Deed", instrumentNumber: "123455", bookPage: "100/200", documentDate: "01/01/2025", recordingDate: "01/02/2025", amount: "", status: "Recorded", parties: [{ name: "Prior Owner", role: "Grantor" }, { name: "Jane Doe", role: "Grantee" }], propertyAddress: "123 Main St Austin TX 78701", legalDescription: "Lot 5 Block 2 Example Subdivision", referencedInstrumentNumbers: [], evidence: [anchor("Warranty Deed Instrument Number 123455 Grantor: Prior Owner Grantee: Jane Doe", 2, "Warranty Deed", "123455"), anchor("Book/Page 100/200 Legal Description: Lot 5 Block 2 Example Subdivision", 2, "Warranty Deed", "123455")] },
      { type: "Deed of Trust", instrumentNumber: "123456", bookPage: "100/201", documentDate: "01/01/2025", recordingDate: "01/02/2025", amount: "$80,000", status: "Open", parties: [{ name: "Jane Doe", role: "Borrower" }, { name: "Example Bank", role: "Beneficiary" }], propertyAddress: "123 Main St Austin TX 78701", legalDescription: "Lot 5 Block 2 Example Subdivision", referencedInstrumentNumbers: [], evidence: [anchor("Deed of Trust Instrument Number 123456 Borrower: Jane Doe Beneficiary: Example Bank Amount: $80,000", 3, "Deed of Trust", "123456"), anchor("Book/Page 100/201 Property Address: 123 Main St Austin TX 78701 Legal Description: Lot 5 Block 2 Example Subdivision", 3, "Deed of Trust", "123456")] },
    ],
    references: [],
    taxes: { status: fact("Not Stated"), fiscalYear: fact("Not Stated"), landValue: fact("Not Stated"), improvements: fact("Not Stated") },
    flags: {
      hoa: fact("Not Stated"), ccrs: fact("Not Stated"), federalTaxLien: fact("None Found", [anchor("Federal Tax Lien: None Found", 1, "Title Search Report")]), bankruptcy: fact("Not Stated"), plat: fact("Not Stated"), mers: fact("Not Stated"), min: fact("Not Stated"),
    },
    targetLienHint: {
      instrumentNumber: fact("123456", [anchor("Mortgage Instrument Number 123456", 1, "Title Search Report", "123456")]),
      position: fact("First", [anchor("Lien Position: First", 1, "Title Search Report", "123456")]),
    },
    extractionSummary: "Synthetic extraction fixture.",
  };
}

function build(raw = extraction()) {
  const native = nativeLedger();
  const ledger = buildEvidenceLedger({ packetHash: native.packetHash, sourceFile: native.sourceFile, pageCount: native.pageCount, extractionMode: "native-text", extraction: raw, nativeLedger: native });
  const record = buildCanonicalTitleRecordFromExtraction({ extraction: raw, ledger, clientName: "Ncala" });
  const reconciliation = reconcileRunSheet(record);
  const qc = initialCanonicalQc(record, reconciliation);
  const review: TitleReviewResult = { engineVersion: "test", record: { ...record, reviewId: "review-test" }, qc, pipeline: { stages: ["INGEST", "EXTRACT", "CLASSIFY", "NORMALIZE", "CHECK", "GROUND", "RENDER", "RECORD"], completedThrough: "RECORD" } };
  return { native, ledger, record, reconciliation, qc, review };
}

function testPipelineGraph() {
  let pipeline = createPipelineState();
  for (const stage of ["INGEST", "EXTRACT", "CLASSIFY", "NORMALIZE", "CHECK", "GROUND", "RENDER", "RECORD", "COMPLETE"] as const) pipeline = advancePipeline(pipeline, stage);
  assertCanonicalPipeline(pipeline);
  assert.throws(() => advancePipeline(createPipelineState(), "CHECK"), /Illegal Cybrid Title pipeline transition/);
  let wrong = createPipelineState();
  wrong = advancePipeline(wrong, "INGEST");
  wrong = advancePipeline(wrong, "EXTRACT");
  assert.throws(() => advancePipeline(wrong, "CHECK"), /Illegal Cybrid Title pipeline transition/);
}

function testLoopPolicy() {
  assert.equal(loopDecision("GROUNDING_UNSUPPORTED").action, "REDUCE_TO_CANNOT_CONFIRM");
  assert.equal(loopDecision("CLASSIFICATION_AMBIGUOUS").action, "REQUIRE_HUMAN_PROFILE");
  assert.equal(loopDecision("BATCH_ITEM_FAILED").action, "ISOLATE_AND_CONTINUE_BATCH");
  assert.equal(mayRetry("PROVIDER_RATE_LIMIT", 0), true);
  assert.equal(mayRetry("PROVIDER_RATE_LIMIT", 2), false);
  assert.equal(mayRetry("GROUNDING_UNSUPPORTED", 0), false);
}

function testEvidenceLedgerGrounding() {
  const { ledger } = build();
  assert.ok(ledger.evidence.length >= 8);
  assert.ok(ledger.evidence.some((node) => node.nativeVerified), "Native evidence quotes must be independently matched to page text.");
  const raw = extraction();
  raw.header.borrower = fact("Imaginary Borrower", [anchor("This quote does not exist on page three", 3, "Deed of Trust", "123456")]);
  const native = nativeLedger();
  const bad = buildEvidenceLedger({ packetHash: native.packetHash, sourceFile: native.sourceFile, pageCount: 3, extractionMode: "native-text", extraction: raw, nativeLedger: native });
  const node = bad.evidence.find((candidate) => candidate.quote.includes("does not exist"));
  assert.equal(node?.nativeVerified, false);
}

function testCanonicalNormalization() {
  const { record } = build();
  assert.equal(record.schemaVersion, 2);
  assert.equal(record.borrower.value, "Jane Doe");
  assert.equal(record.currentOwner.value, "Jane Doe");
  assert.equal(record.targetLien.instrumentNumber.value, "123456");
  assert.equal(record.targetLien.position.value, "First");
  assert.equal(record.runSheet.detected, true);
  assert.equal(record.runSheet.entries.length, 2);
}

function testBorrowerFailsClosed() {
  const raw = extraction();
  raw.header.borrower = fact("Not Stated");
  const { record } = build(raw);
  assert.equal(record.borrower.value, "Needs review");
  assert.equal(record.currentOwner.value, "Jane Doe");
  assert.ok(record.dataQualityWarnings.some((warning) => /Borrower is unresolved/.test(warning)));
}

function testMultipleMortgagesRequireTargetSelection() {
  const raw = extraction();
  raw.targetLienHint.instrumentNumber = fact("Not Stated");
  raw.instruments.push({ ...raw.instruments[1], instrumentNumber: "654321", bookPage: "100/202", amount: "$20,000", evidence: [anchor("Deed of Trust Instrument Number 654321 Amount $20,000", 3, "Deed of Trust", "654321")] });
  const { record } = build(raw);
  assert.equal(record.mortgages.length, 2);
  assert.equal(record.targetLien.selectionRequired, true);
  assert.equal(record.targetLien.instrumentNumber.value, "Needs review");
}

function testLienPositionNeverInferred() {
  const raw = extraction();
  raw.targetLienHint.position = fact("Not Stated");
  const { record, qc } = build(raw);
  assert.equal(record.targetLien.position.value, "Needs review");
  assert.equal(qc.checks.find((check) => check.id === "TARGET_LIEN_POSITION_ESTABLISHED")?.status, "CANNOT_CONFIRM");
}

function testRunSheetMismatch() {
  const raw = extraction();
  raw.runSheet.entries[1] = { ...raw.runSheet.entries[1], amount: "$81,000" };
  const { reconciliation, qc } = build(raw);
  assert.equal(reconciliation.mismatched, 1);
  assert.equal(qc.checks.find((check) => check.id === "RUN_SHEET_RECONCILES")?.status, "FAIL");
  assert.equal(qc.foreclosureReadiness, "CURATIVE_REQUIRED");
}

function testMissingReferencedInstrumentCannotConfirm() {
  const raw = extraction();
  raw.references.push({ description: "Plat referenced by legal description", documentType: "Plat", instrumentNumber: "", bookPage: "1/15", evidence: [anchor("Legal Description: Lot 5 Block 2 Example Subdivision", 2, "Warranty Deed", "123455")] });
  const { reconciliation, qc } = build(raw);
  assert.equal(reconciliation.referencedButMissing.length, 1);
  assert.equal(qc.checks.find((check) => check.id === "RECORDED_DOCUMENTS_RECONCILE")?.status, "CANNOT_CONFIRM");
}

function testUnknownProfileFailsClosed() {
  const raw = extraction();
  raw.header.searchType = fact("Not Stated");
  const { record, qc } = build(raw);
  assert.equal(record.orderType.value, "Needs review");
  assert.equal(qc.profileId, "profile-unresolved-v1");
}

function testExportBlocksUnknownRequiredFields() {
  const { review } = build();
  const readyWarnings = validateExportProfile(NCALA_DEMO_EXPORT_PROFILE, [{ record: review.record, qc: review.qc }]);
  assert.equal(readyWarnings.length, 0);
  const blocked = { ...review.record, borrower: { ...review.record.borrower, value: "Needs review", state: "NOT_STATED" as const } };
  const warnings = validateExportProfile(NCALA_DEMO_EXPORT_PROFILE, [{ record: blocked, qc: review.qc }]);
  assert.ok(warnings.some((warning) => /Borrower Name/.test(warning)));
  const csv = renderCsv(NCALA_DEMO_EXPORT_PROFILE, [{ record: { ...review.record, borrower: { ...review.record.borrower, value: 'Jane "JJ" Doe' } }, qc: review.qc }]);
  assert.match(csv, /Jane ""JJ"" Doe/);
}

function testDecisionReducer() {
  const { review } = build();
  const target = review.qc.checks.find((check) => check.status === "CANNOT_CONFIRM");
  assert.ok(target, "Fixture must contain at least one exception for decision reducer test.");
  const updated = applyReviewDecisions(review, [{ reviewId: "review-test", checkId: target!.id, decision: "CORRECT", correctedStatus: "PASS", correctedValue: "Examiner confirmed from source.", reason: "Verified against controlling document.", actor: "examiner", decidedAt: new Date().toISOString() }]);
  assert.equal(updated.qc.checks.find((check) => check.id === target!.id)?.status, "PASS");
}

const tests: Array<[string, () => void]> = [
  ["pipeline graph with normalization", testPipelineGraph],
  ["bounded recovery loop", testLoopPolicy],
  ["immutable evidence ledger grounding", testEvidenceLedgerGrounding],
  ["canonical normalization", testCanonicalNormalization],
  ["borrower fails closed", testBorrowerFailsClosed],
  ["multiple mortgages require target selection", testMultipleMortgagesRequireTargetSelection],
  ["lien position never inferred", testLienPositionNeverInferred],
  ["bidirectional Run Sheet mismatch detection", testRunSheetMismatch],
  ["missing referenced source cannot confirm", testMissingReferencedInstrumentCannotConfirm],
  ["unknown QC profile fails closed", testUnknownProfileFailsClosed],
  ["client export required-field gate", testExportBlocksUnknownRequiredFields],
  ["human decision reducer", testDecisionReducer],
];

for (const [name, test] of tests) {
  test();
  console.log(`ARCHITECTURE_HARNESS PASS: ${name}`);
}
console.log(`ARCHITECTURE_HARNESS COMPLETE: ${tests.length}/${tests.length} deterministic checks passed.`);
