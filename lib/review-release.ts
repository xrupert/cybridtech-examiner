import type { TitleReviewResult } from "./title-domain";
import type { ReviewDecisionRecord } from "./review-decisions";
import { applyReviewDecisions } from "./review-decision-reducer";

export function projectReviewedResult(review: TitleReviewResult, decisions: ReviewDecisionRecord[]): TitleReviewResult {
  return applyReviewDecisions(review, decisions.filter((decision) => decision.reviewId === review.record.reviewId));
}

export function releaseWarnings(review: TitleReviewResult, decisions: ReviewDecisionRecord[]): string[] {
  const saved = new Map(decisions.filter((item) => item.reviewId === review.record.reviewId).map((item) => [item.checkId, item]));
  const warnings: string[] = [];
  if (review.qc.curativeIssues.some((issue) => issue.code === "DOCUMENT_INTEGRITY_MANUAL_REVIEW")) {
    warnings.push("Unresolved physical pages prevent final release. Resolve the source pages and reprocess the packet.");
  }
  for (const check of review.qc.checks) {
    const required = check.legacyQuestionNumber || !["PASS", "NOT_APPLICABLE"].includes(check.status);
    if (required && !saved.has(check.id)) warnings.push(`Examiner disposition required for ${check.label}.`);
  }
  return warnings;
}
