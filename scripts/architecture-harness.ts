import assert from "node:assert/strict";
import { REQUIRED_QUESTIONS, CRITICAL_QUESTION_NUMBERS } from "../lib/audit-rules";
import { critique } from "../lib/critic";
import { detectSearchTypeFromText } from "../lib/document-engine";
import { advancePipeline, assertCanonicalPipeline, createPipelineState } from "../lib/pipeline";
import { detectRunSheet } from "../lib/run-sheet-detection";
import { buildCanonicalTitleRecord, titleRecordsToCsv } from "../lib/title-record";
import { emptyVera, type AuditFinding, type EvidenceRef, type VeraExam } from "../lib/vera";

const evidence: EvidenceRef = {
  quote: "Client Order 2025-TEST; Borrower: Jane Doe; Instrument Number 123456",
  page: 1,
  documentType: "Run Sheet / Title Summary",
  source: "native",
};

function finding(number: number, status: AuditFinding["status"] = "PASS", ev: EvidenceRef[] = [evidence]): AuditFinding {
  return {
    number,
    question: REQUIRED_QUESTIONS[number - 1],
    critical: CRITICAL_QUESTION_NUMBERS.has(number),
    response: status === "FAIL" ? "Source discrepancy established." : status === "NOT_APPLICABLE" ? "Not applicable." : "Confirmed from packet.",
    status,
    evidence: ev,
    proofReason: status === "FAIL" ? "Run Sheet does not reconcile to source." : "Grounded packet evidence supports the result.",
    commentary: "",
  };
}

function baseExam(): VeraExam {
  return emptyVera({
    state: "TX",
    county: "Travis",
    searchType: "Current Owner Search",
    clientOrder: "2025-TEST",
    propertyAddress: "123 Main St, Austin, TX 78701",
    parcelId: "ABC-123",
    sourceFile: "synthetic-title-report.pdf",
    packetHash: "abc123",
    packetPageCount: 3,
    deed: {
      grantor: "Prior Owner",
      grantee: "Jane Doe",
      date: "2025-01-01",
      bookPage: "100/200",
      instrument: "123455",
      consideration: "$100,000",
    },
    mortgages: [{
      index: 1,
      amount: "$80,000",
      holder: "Example Bank",
      date: "2025-01-01",
      bookPage: "100/201",
      instrument: "123456",
      maturityDate: "2055-01-01",
    }],
    documents: [{
      documentType: "Title Search Report",
      pageStart: 1,
      pageEnd: 2,
      excerpt: "Client Order 2025-TEST Property Address Vesting Deed Information Mortgage Information Instrument Number Recording Date Parcel",
    }],
    pages: [{
      page: 1,
      text: evidence.quote,
      source: "native",
      documentType: "Title Report",
    }],
    findings: REQUIRED_QUESTIONS.map((_, index) => finding(index + 1)),
  });
}

function testPipelineGraph() {
  let pipeline = createPipelineState();
  for (const stage of ["INGEST", "EXTRACT", "CLASSIFY", "CHECK", "GROUND", "RENDER", "RECORD", "COMPLETE"] as const) {
    pipeline = advancePipeline(pipeline, stage);
  }
  assertCanonicalPipeline(pipeline);
  assert.throws(() => advancePipeline(createPipelineState(), "CHECK"), /Illegal Cybrid Title pipeline transition/);
}

function testRunSheetDetection() {
  const detected = detectRunSheet(baseExam());
  assert.equal(detected.detected, true, "Functional front-of-packet title summary must be recognized as Run Sheet.");
  assert.ok(["high", "medium"].includes(detected.confidence));
}

function testEvidenceReducerFailsClosed() {
  const exam = baseExam();
  exam.findings = exam.findings.map((item) => item.number === 4 ? finding(4, "FAIL", []) : item);
  const reduced = critique(exam);
  const q4 = reduced.findings.find((item) => item.number === 4);
  assert.equal(q4?.status, "CANNOT_CONFIRM", "Unsupported FAIL must be reduced to Cannot Confirm.");
  assert.equal(reduced.status, "Fail");
  assert.equal(reduced.manualReviewRequired, true);
}

function testCurativeProjection() {
  const exam = baseExam();
  exam.findings = exam.findings.map((item) => item.number === 7 ? finding(7, "FAIL") : item);
  const reduced = critique(exam);
  const record = buildCanonicalTitleRecord({ ...reduced, reviewId: "review-1", matterRevision: 1 }, "Ncala");
  assert.equal(record.foreclosureReadiness, "CURATIVE_REQUIRED");
  assert.ok(record.curativeIssues.some((issue) => issue.code === "ASSIGNMENT_CHAIN_GAP"));
  assert.equal(record.targetLien.instrumentNumber, "123456");
}

function testOrderProfileDetection() {
  assert.equal(detectSearchTypeFromText("Title Search Report Search Type: Current Owner Search").searchType, "Current Owner Search");
  assert.equal(detectSearchTypeFromText("Order Type - Two Owner Search").searchType, "Two Owner Search");
  assert.equal(detectSearchTypeFromText("Search Type: 2nd Lien").searchType, "2nd Lien");
  assert.equal(detectSearchTypeFromText("Search Type: Foreclosure").searchType, "Foreclosure");
}

function testExportContract() {
  const record = buildCanonicalTitleRecord({ ...critique(baseExam()), reviewId: "review-2", matterRevision: 1 }, "Ncala");
  record.borrowerName = 'Jane "JJ" Doe';
  const csv = titleRecordsToCsv([record], ["tsNumber", "borrowerName", "propertyAddress", "lienPosition"]);
  assert.match(csv, /TS Number/);
  assert.match(csv, /Jane ""JJ"" Doe/);
  assert.match(csv, /2025-TEST/);
}

function testRuleShape() {
  assert.equal(REQUIRED_QUESTIONS.length, 20, "VERA contract requires exactly 20 questions.");
  assert.deepEqual([...CRITICAL_QUESTION_NUMBERS].sort((a, b) => a - b), [4, 5, 6, 7, 8, 9, 10, 11, 12, 17, 18, 19, 20]);
}

const tests: Array<[string, () => void]> = [
  ["pipeline graph", testPipelineGraph],
  ["functional Run Sheet detection", testRunSheetDetection],
  ["evidence reducer fail-closed behavior", testEvidenceReducerFailsClosed],
  ["curative projection", testCurativeProjection],
  ["order profile detection", testOrderProfileDetection],
  ["CSV export contract", testExportContract],
  ["VERA rule shape", testRuleShape],
];

for (const [name, test] of tests) {
  test();
  console.log(`ARCHITECTURE_HARNESS PASS: ${name}`);
}

console.log(`ARCHITECTURE_HARNESS COMPLETE: ${tests.length}/${tests.length} deterministic checks passed.`);
