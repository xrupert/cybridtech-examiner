import { VeraExam, type AuditFinding, type PacketDocument } from "./vera";
import { CRITICAL_QUESTION_NUMBERS, isSupportedSearchType } from "./audit-rules";
import { detectRunSheet, type RunSheetDetection } from "./run-sheet-detection";

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

function normalizeRunSheetApplicability(finding: AuditFinding, detection: RunSheetDetection): AuditFinding {
  if (![19, 20].includes(finding.number)) return finding;

  if (detection.detected) {
    if (finding.status !== "NOT_APPLICABLE") return finding;
    return {
      ...finding,
      status: "CANNOT_CONFIRM",
      response: finding.number === 19
        ? "Run Sheet detected, but the MIN check was not completed against it."
        : "Run Sheet detected, but its entries were not fully reconciled against the supporting documents.",
      proofReason: `${detection.reason} Q${finding.number} cannot be treated as N/A; the Run Sheet must be checked against the packet.`,
      commentary: "Run Sheet identification is functional and structural, not dependent on a literal heading or a separate file.",
    };
  }

  // No literal label is not proof of absence. If structure is ambiguous, keep Q19/Q20 open.
  if (finding.status === "NOT_APPLICABLE") {
    return {
      ...finding,
      status: "CANNOT_CONFIRM",
      response: "Cannot Confirm — Cybrid Title could not confidently identify the Run Sheet section from the returned packet structure.",
      evidence: finding.evidence,
      proofReason: `${detection.reason} Q${finding.number} remains open because a front-of-packet summary/index can function as the Run Sheet even when it is not separately labeled.`,
      commentary: "Examiner review is required instead of silently waiving the Run Sheet check.",
    };
  }

  return finding;
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

function documentsWithFunctionalRunSheet(exam: VeraExam, detection: RunSheetDetection): PacketDocument[] {
  if (!detection.detected) return exam.documents;
  const alreadyExplicit = exam.documents.some((document) => /\b(run\s*sheet|abstractor\s*sheet|search\s*sheet|title\s*worksheet)\b/i.test(document.documentType || ""));
  if (alreadyExplicit) return exam.documents;

  return [
    ...exam.documents,
    {
      documentType: "Run Sheet (functional title-summary section)",
      pageStart: detection.pageStart || 1,
      pageEnd: detection.pageEnd || detection.pageStart || 1,
      excerpt: detection.reason,
    },
  ].sort((a, b) => a.pageStart - b.pageStart);
}

export function critique(exam: VeraExam): VeraExam {
  const seen = new Set<number>();
  const runSheetDetection = detectRunSheet(exam);
  const findings = exam.findings
    .map((finding) => normalizeRunSheetApplicability(finding, runSheetDetection))
    .map(enforceEvidence);
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
    documents: documentsWithFunctionalRunSheet(exam, runSheetDetection),
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
