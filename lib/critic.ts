import { VeraExam, type AuditFinding } from "./vera";
import { CRITICAL_QUESTION_NUMBERS, isSupportedSearchType } from "./audit-rules";

const acceptable = new Set(["PASS", "NOT_APPLICABLE"]);

function evidenceIsUsable(finding: AuditFinding): boolean {
  return finding.evidence.some((evidence) =>
    Boolean(evidence.quote?.trim()) &&
    evidence.quote.trim().toLowerCase() !== "not stated" &&
    Number.isInteger(evidence.page) &&
    evidence.page > 0 &&
    Boolean(evidence.documentType?.trim()),
  );
}

function enforceEvidence(finding: AuditFinding): AuditFinding {
  if (finding.status === "NOT_APPLICABLE") return finding;
  if ((finding.status === "PASS" || finding.status === "FAIL") && !evidenceIsUsable(finding)) {
    return {
      ...finding,
      status: "CANNOT_CONFIRM",
      response: finding.response || "Cannot Confirm",
      proofReason: `Evidence gate rejected the proposed ${finding.status}: no usable verbatim quote + physical PDF page was supplied. ${finding.proofReason || ""}`.trim(),
      commentary: [finding.commentary, "Server evidence gate: supported PASS/FAIL conclusions require cited packet evidence."].filter(Boolean).join(" "),
    };
  }
  return finding;
}

export function critique(exam: VeraExam): VeraExam {
  const seen = new Set<number>();
  const findings = exam.findings.map(enforceEvidence);
  const malformedQuestions = findings.filter((finding) => {
    const invalid = finding.number < 1 || finding.number > 20 || seen.has(finding.number);
    seen.add(finding.number);
    return invalid;
  });
  const missingQuestionNumbers = Array.from({ length: 20 }, (_, index) => index + 1).filter((number) => !seen.has(number));
  const supportedSearchType = isSupportedSearchType(exam.searchType);

  const critical = findings.filter((finding) => CRITICAL_QUESTION_NUMBERS.has(finding.number));
  const passed = critical.filter((finding) => acceptable.has(finding.status)).length;
  const criticalPassRate = critical.length ? Math.round((passed / critical.length) * 100) : 0;
  const failed = critical.filter((finding) => !acceptable.has(finding.status));
  const structuralFailure = malformedQuestions.length > 0 || missingQuestionNumbers.length > 0 || findings.length !== 20;
  const status = failed.length === 0 && critical.length > 0 && !structuralFailure && supportedSearchType ? "Pass" : "Fail";

  const reasons = failed.slice(0, 6).map((finding) => `Q${finding.number}: ${finding.proofReason}`);
  if (structuralFailure) reasons.unshift(`VERA structure invalid: expected exactly one finding for Q1-Q20${missingQuestionNumbers.length ? `; missing ${missingQuestionNumbers.join(", ")}` : ""}.`);
  if (!supportedSearchType) reasons.unshift(`Unsupported MVP search type: ${exam.searchType}.`);

  const manualReviewRequired = exam.manualReviewRequired || structuralFailure || !supportedSearchType || failed.some((finding) => finding.status === "CANNOT_CONFIRM" || finding.status === "UNDETERMINED" || finding.status === "NOT_STATED");

  return {
    ...exam,
    findings,
    status,
    criticalPassRate,
    manualReviewRequired,
    reason: status === "Pass"
      ? `All applicable critical VERA questions passed the server evidence gate (${criticalPassRate}%).`
      : reasons.join(" | ") || "Critical evidence requirements remain unresolved.",
    confirmation: status === "Pass"
      ? "The document meets the currently loaded VERA v3 and RCS MVP requirements based on cited packet evidence."
      : "The document contains unresolved, contradictory, unsupported, or missing critical evidence and does not meet the currently loaded quality standards.",
  };
}
