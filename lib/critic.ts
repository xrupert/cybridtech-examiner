import { VeraExam } from "./vera";
import { CRITICAL_QUESTION_NUMBERS } from "./audit-rules";

const acceptable = new Set(["PASS", "NOT_APPLICABLE"]);

export function critique(exam: VeraExam): VeraExam {
  const critical = exam.findings.filter((finding) => CRITICAL_QUESTION_NUMBERS.has(finding.number));
  const passed = critical.filter((finding) => acceptable.has(finding.status)).length;
  const criticalPassRate = critical.length ? Math.round((passed / critical.length) * 100) : 0;
  const failed = critical.filter((finding) => !acceptable.has(finding.status));
  const status = failed.length === 0 && critical.length > 0 ? "Pass" : "Fail";
  const reasons = failed.slice(0, 6).map((finding) => `Q${finding.number}: ${finding.proofReason}`);
  const manualReviewRequired = exam.manualReviewRequired || failed.some((finding) => finding.status === "CANNOT_CONFIRM" || finding.status === "UNDETERMINED");

  return {
    ...exam,
    status,
    criticalPassRate,
    manualReviewRequired,
    reason: status === "Pass"
      ? `All applicable critical questions passed (${criticalPassRate}%).`
      : reasons.join(" | ") || "Critical evidence requirements remain unresolved.",
    confirmation: status === "Pass"
      ? "Meets the currently loaded CybridTech audit rules based only on quoted packet evidence and two independent OpenAI document passes."
      : "Has unresolved, contradictory, or independently disputed critical evidence identified above; do not treat this packet as passing until corrected or verified.",
  };
}
