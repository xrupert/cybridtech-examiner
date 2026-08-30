import { reduceQcChecks } from "./title-qc-engine";
import type { ReviewDecisionRecord } from "./review-decisions";
import type { TitleReviewResult } from "./title-domain";

export function applyReviewDecisions(review: TitleReviewResult, decisions: ReviewDecisionRecord[]): TitleReviewResult {
  const byCheck = new Map(decisions.map((decision) => [decision.checkId, decision]));
  const checks = review.qc.checks.map((check) => {
    const decision = byCheck.get(check.id);
    if (!decision) return check;
    if (decision.decision === "CONFIRM") return check;
    if (decision.decision === "NEEDS_EVIDENCE") {
      return {
        ...check,
        status: "CANNOT_CONFIRM" as const,
        summary: `${check.summary} Examiner requires additional evidence: ${decision.reason}`,
      };
    }
    return {
      ...check,
      status: decision.correctedStatus || check.status,
      summary: decision.correctedValue?.trim() || check.summary,
      recommendedAction: decision.correctedStatus === "PASS" || decision.correctedStatus === "NOT_APPLICABLE"
        ? "No curative action required after examiner correction."
        : check.recommendedAction,
    };
  });

  const record = { ...review.record, targetLien: { ...review.record.targetLien } };
  const positionDecision = byCheck.get("TARGET_LIEN_POSITION_ESTABLISHED");
  if (positionDecision?.decision === "CORRECT" && positionDecision.correctedValue?.trim()) {
    record.targetLien.position = {
      value: positionDecision.correctedValue.trim(),
      state: "CONFIRMED",
      evidence: record.targetLien.position.evidence,
      basis: `Examiner correction: ${positionDecision.reason}`,
    };
  }

  return {
    ...review,
    record,
    qc: reduceQcChecks(
      { profileId: review.qc.profileId, profileVersion: review.qc.profileVersion, profileName: review.qc.profileName },
      checks,
    ),
  };
}
