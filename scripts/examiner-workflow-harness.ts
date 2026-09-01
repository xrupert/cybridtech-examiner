import assert from "node:assert/strict";
import { applyReviewDecisions } from "../lib/review-decision-reducer";

function baseReview() {
  const evidence = [{ page: 4, quote: "Deed of Trust Instrument 111 Amount $100,000", documentType: "Deed of Trust", instrumentNumber: "111" }];
  return {
    record: {
      reviewId: "review-test",
      mortgages: [{ id: "m1", type: "Deed of Trust", instrumentNumber: "111", amount: "$100,000", status: "Open", parties: [{ name: "Lender LLC", role: "Beneficiary" }], evidence, evidenceIds: ["e1"], evidenceState: "CONFIRMED" }],
      targetLien: {
        instrumentId: null,
        instrumentNumber: { value: "Needs review", state: "NOT_STATED", evidence: [], evidenceIds: [], basis: "Unresolved" },
        amount: { value: "Needs review", state: "NOT_STATED", evidence: [], evidenceIds: [], basis: "Unresolved" },
        beneficiary: { value: "Needs review", state: "NOT_STATED", evidence: [], evidenceIds: [], basis: "Unresolved" },
        position: { value: "Needs review", state: "NOT_STATED", evidence: [], evidenceIds: [], basis: "Unresolved" },
        positionBasis: "UNRESOLVED", positionConfidence: "low", selectionRequired: true,
      },
      foreclosureAnalysis: {
        lienStack: [{ instrumentId: "m1", instrumentType: "Deed of Trust", instrumentNumber: "111", amount: "$100,000", recordingDate: "01/02/2025", holder: "Lender LLC", status: "OPEN", chronologicalPosition: 1, positionLabel: "1st Lien", priorityBasis: "FIRST_IN_TIME", priorityConfidence: "high", priorityWarning: "", evidence, evidenceIds: ["e1"] }],
        requirements: [
          { code: "TARGET_LIEN_SELECTION", type: "EVIDENCE", severity: "BLOCKING", title: "Select target", action: "Select", evidence: [] },
          { code: "TARGET_LIEN_AMOUNT", type: "EVIDENCE", severity: "BLOCKING", title: "Amount", action: "Confirm", evidence: [] },
          { code: "TARGET_LIEN_POSITION", type: "PRIORITY_REVIEW", severity: "BLOCKING", title: "Position", action: "Confirm", evidence: [] },
        ],
        targetInstrumentId: null, targetAmount: "Needs review", targetPosition: "Needs review", targetPositionBasis: "UNRESOLVED", targetPositionConfidence: "low", seniorLienIds: [], juniorLienIds: [], openLienCount: 1, status: "CURATIVE_REQUIRED", method: "FIRST_IN_TIME_WITH_EXCEPTION_GATES",
      },
    },
    qc: {
      profileId: "foreclosure-v4", profileVersion: 4, profileName: "Foreclosure",
      checks: [
        { id: "TARGET_LIEN_FOUND", label: "Target lien", category: "Lien", status: "CANNOT_CONFIRM", severity: "CRITICAL", critical: true, summary: "Unresolved", recommendedAction: "Select", evidence: [], evidenceIds: [] },
        { id: "TARGET_LIEN_AMOUNT", label: "Target amount", category: "Lien", status: "CANNOT_CONFIRM", severity: "CRITICAL", critical: true, summary: "Unresolved", recommendedAction: "Confirm", evidence: [], evidenceIds: [] },
        { id: "TARGET_LIEN_POSITION_ESTABLISHED", label: "Target position", category: "Lien", status: "CANNOT_CONFIRM", severity: "CRITICAL", critical: true, summary: "Unresolved", recommendedAction: "Confirm", evidence: [], evidenceIds: [] },
      ],
      qcStatus: "REVIEW", foreclosureReadiness: "CANNOT_CONFIRM", openIssueCount: 3, criticalIssueCount: 3,
    },
  } as any;
}

const selected = applyReviewDecisions(baseReview(), [{ reviewId: "review-test", checkId: "TARGET_LIEN_FOUND", decision: "CORRECT", correctedStatus: "PASS", correctedValue: "111", reason: "Examiner selected controlling security instrument after review.", actor: "examiner", decidedAt: new Date().toISOString() }]);
assert.equal(selected.record.targetLien.instrumentId, "m1");
assert.equal(selected.record.targetLien.amount.value, "$100,000");
assert.equal(selected.record.targetLien.position.value, "1st Lien");
assert.equal(selected.record.targetLien.selectionRequired, false);
assert.equal(selected.record.foreclosureAnalysis.requirements.length, 0);
assert.equal(selected.record.foreclosureAnalysis.status, "READY");
assert.ok(selected.qc.checks.every((check: any) => check.status === "PASS"));
console.log("EXAMINER_WORKFLOW PASS: persisted target selection updates canonical truth and downstream cure state");

const unresolved = baseReview();
unresolved.record.targetLien.instrumentId = "m1";
unresolved.record.targetLien.selectionRequired = false;
unresolved.record.foreclosureAnalysis.targetInstrumentId = "m1";
unresolved.record.foreclosureAnalysis.requirements = [unresolved.record.foreclosureAnalysis.requirements[2]];
const corrected = applyReviewDecisions(unresolved, [{ reviewId: "review-test", checkId: "TARGET_LIEN_POSITION_ESTABLISHED", decision: "CORRECT", correctedStatus: "PASS", correctedValue: "2nd Lien", reason: "Examiner determined priority from the controlling jurisdictional record set.", actor: "examiner", decidedAt: new Date().toISOString() }]);
assert.equal(corrected.record.targetLien.position.value, "2nd Lien");
assert.equal(corrected.record.targetLien.position.state, "EXAMINER_CONFIRMED");
assert.equal(corrected.record.targetLien.positionBasis, "EXAMINER");
assert.equal(corrected.record.foreclosureAnalysis.targetPosition, "2nd Lien");
assert.equal(corrected.record.foreclosureAnalysis.targetPositionBasis, "EXAMINER");
assert.equal(corrected.record.foreclosureAnalysis.requirements.length, 0);
assert.equal(corrected.record.foreclosureAnalysis.status, "READY");
console.log("EXAMINER_WORKFLOW PASS: examiner priority determination is auditable and propagates downstream");
