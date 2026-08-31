import assert from "node:assert/strict";
import { MCCALLA_EXPORT_PROFILE, renderCsv } from "../lib/export-profiles";
import { buildVeraAccuracyAudit, veraPassFailReason } from "../lib/vera-accuracy-audit";
import type { CanonicalTitleRecord, QcCheckResult, QcProfileResult } from "../lib/title-domain";

function check(number: number, status: QcCheckResult["status"] = "PASS"): QcCheckResult {
  return {
    id: `Q${number}`,
    label: `Vera question ${number}`,
    category: "Vera 20",
    status,
    severity: status === "FAIL" ? "BLOCKING" : "INFO",
    critical: false,
    summary: status === "PASS" ? `Question ${number} verified.` : `Question ${number} discrepancy.`,
    recommendedAction: status === "PASS" ? "No curative action required for this check." : "Correct the discrepancy.",
    evidence: [{ quote: `Evidence for Q${number}`, page: number, documentType: "Title Report", source: "native" }],
    evidenceIds: [`e-${number}`],
    legacyQuestionNumber: number,
  };
}

function qc(statusAt?: { number: number; status: QcCheckResult["status"] }): QcProfileResult {
  const checks = Array.from({ length: 20 }, (_, index) => check(index + 1, statusAt?.number === index + 1 ? statusAt.status : "PASS"));
  const failed = checks.some((item) => item.status === "FAIL");
  const unresolved = checks.some((item) => item.status === "CANNOT_CONFIRM");
  return {
    profileId: "test-v4", profileVersion: 4, profileName: "Test Vera 20", checks,
    qcStatus: unresolved ? "REVIEW" : failed ? "FAIL" : "PASS",
    foreclosureReadiness: unresolved ? "CANNOT_CONFIRM" : failed ? "CURATIVE_REQUIRED" : "CLEAR",
    curativeIssues: [], unresolvedCount: checks.filter((item) => item.status === "CANNOT_CONFIRM").length,
  };
}

function field(value: string) { return { value, state: "CONFIRMED" as const, evidence: [], evidenceIds: [], basis: "test" }; }

function record(): CanonicalTitleRecord {
  const base = {
    schemaVersion: 2 as const, recordId: "record", reviewId: "review", packetHash: "hash", sourceFile: "packet.pdf", clientName: "McCalla",
    orderNumber: field("2025-TEST"), tsNumber: field("2025-TEST"), orderType: field("Current Owner Search"), effectiveDate: field("10/15/2025"), state: field("WA"), county: field("Grays Harbor"), propertyAddress: field("2219 Aberdeen Ave"), parcelId: field("018602700500"), legalDescription: field("Lot 5 Block 27"), borrower: field("Larry Gunter"), currentOwner: field("Larry Gunter"),
    titleSummary: { detected: true, confidence: "high" as const, pageStart: 1, pageEnd: 3, basis: "RCS Exceptions", entries: [], evidence: [], evidenceIds: [] },
    runSheet: { detected: false, confidence: "low" as const, pageStart: null, pageEnd: null, basis: "No separate abstractor sheet", entries: [], evidence: [], evidenceIds: [] },
    instruments: [], mortgages: [], deeds: [], assignments: [], releases: [], liens: [], references: [],
    flags: { hoa: field("None"), ccrs: field("None"), federalTaxLien: field("None"), bankruptcy: field("None"), plat: field("Present"), mers: field("MERS"), min: field("100039033221412517") },
    taxes: { status: field("Due"), fiscalYear: field("2025"), landValue: field("$17,975"), improvements: field("$175,148") },
    targetLien: { instrumentId: "dot-1", instrumentNumber: field("2014-04040027"), amount: field("$78,551.00"), beneficiary: field("Quicken Loans Inc."), position: field("1st Lien"), positionBasis: "FIRST_IN_TIME" as const, positionConfidence: "high" as const, selectionRequired: false },
    foreclosureAnalysis: { method: "FIRST_IN_TIME_WITH_EXCEPTION_GATES" as const, status: "READY" as const, targetInstrumentId: "dot-1", targetAmount: "$78,551.00", targetPosition: "1st Lien", targetPositionBasis: "FIRST_IN_TIME" as const, targetPositionConfidence: "high" as const, seniorLienIds: [], juniorLienIds: [], openLienCount: 1, lienStack: [], requirements: [], jurisdictionCoverage: { state: "WA", county: "Grays Harbor", status: "CURATED" as const, ruleSetVersion: "WA-DTA-2026-08-31", note: "Curated" } },
    dataQualityWarnings: [], matterRevision: 1,
  };
  return base as CanonicalTitleRecord;
}

const cleanQc = qc();
const cleanRecord = record();
const audit = buildVeraAccuracyAudit(cleanRecord, cleanQc);
assert.equal(audit.length, 6, "Vera accuracy audit must contain exactly six template areas.");
assert.deepEqual(audit.map((item) => item.label), ["Vesting Deed Information", "Chain of Title", "Mortgage Information", "Tax Information", "Judgments and Liens", "Easements and Restrictions"]);
assert.equal(veraPassFailReason(cleanQc).status, "Pass");

const failedQc = qc({ number: 17, status: "FAIL" });
assert.equal(veraPassFailReason(failedQc).status, "Fail");
assert.match(veraPassFailReason(failedQc).reason, /1 confirmed QC failure/);

const csv = renderCsv(MCCALLA_EXPORT_PROFILE, [{ record: cleanRecord, qc: cleanQc }]);
assert.match(csv, /Vera 20 Review/);
assert.match(csv, /Q20 PASS: Question 20 verified/);
assert.match(csv, /Title Report \/ Run Sheet Accuracy Audit/);
assert.match(csv, /Vesting Deed Information/);
assert.match(csv, /Vera Pass \/ Fail Determination/);
assert.match(csv, /Pass: All applicable Vera review checks are resolved/);

console.log("REVIEW_OUTPUT_HARNESS COMPLETE: 4/4 reviewed-output checks passed.");
