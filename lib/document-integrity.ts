import type { PacketExtractionLedger } from "./document-engine";
import type { CurativeIssue, QcCheckResult, TitleReviewResult } from "./title-domain";

export type DocumentIntegrityState = "COMPLETE" | "RECOVERED" | "MANUAL_REVIEW_REQUIRED" | "UNOPENABLE";

export interface DocumentIntegritySummary {
  state: DocumentIntegrityState;
  pageCount: number;
  nativeReadablePages: number;
  ocrRecoveredPages: number[];
  blankPages: number[];
  unresolvedPages: number[];
  skippedOcrPages: number[];
}

function pageSet(values: number[]): Set<number> {
  return new Set(values.filter((value) => Number.isInteger(value) && value > 0));
}

export function summarizeDocumentIntegrity(ledger: PacketExtractionLedger): DocumentIntegritySummary {
  if (!ledger.pageCount) {
    return {
      state: "UNOPENABLE",
      pageCount: 0,
      nativeReadablePages: 0,
      ocrRecoveredPages: [],
      blankPages: [],
      unresolvedPages: [],
      skippedOcrPages: [],
    };
  }
  const state: DocumentIntegrityState = ledger.lowTextPages.length || ledger.ocrSkippedPages.length
    ? "MANUAL_REVIEW_REQUIRED"
    : ledger.ocrRecoveredPages.length
      ? "RECOVERED"
      : "COMPLETE";
  return {
    state,
    pageCount: ledger.pageCount,
    nativeReadablePages: ledger.nativeUsableTextPages,
    ocrRecoveredPages: [...ledger.ocrRecoveredPages],
    blankPages: [...ledger.blankPages],
    unresolvedPages: [...ledger.lowTextPages],
    skippedOcrPages: [...ledger.ocrSkippedPages],
  };
}

function downgradeCheck(check: QcCheckResult, unresolved: Set<number>): QcCheckResult {
  if (check.status === "FAIL" || check.status === "NOT_APPLICABLE") return check;
  const citedPages = pageSet(check.evidence.map((item) => item.page));
  const dependsOnUnreadable = [...citedPages].some((page) => unresolved.has(page));
  const independentReadableEvidence = [...citedPages].some((page) => !unresolved.has(page));
  if (!dependsOnUnreadable || independentReadableEvidence) return check;
  return {
    ...check,
    status: "CANNOT_CONFIRM",
    summary: `Cannot Confirm — the supporting evidence depends on unreadable physical PDF page(s) ${[...citedPages].filter((page) => unresolved.has(page)).join(", ")}. ${check.summary}`,
    recommendedAction: "Manually review the unresolved source page(s) and confirm the documentary fact before release.",
  };
}

export function applyDocumentIntegrityGuard(review: TitleReviewResult, ledger: PacketExtractionLedger): TitleReviewResult {
  const integrity = summarizeDocumentIntegrity(ledger);
  if (integrity.state !== "MANUAL_REVIEW_REQUIRED") return review;

  const unresolved = pageSet([...integrity.unresolvedPages, ...integrity.skippedOcrPages]);
  const checks = review.qc.checks.map((check) => downgradeCheck(check, unresolved));
  const warning = `DOCUMENT INTEGRITY — manual review required for physical PDF page(s): ${[...unresolved].sort((a, b) => a - b).join(", ")}. Readable pages remain valid evidence; unreadable pages must never create a substantive title FAIL by themselves.`;
  const dataQualityWarnings = review.record.dataQualityWarnings.includes(warning)
    ? review.record.dataQualityWarnings
    : [...review.record.dataQualityWarnings, warning];

  const integrityIssue: CurativeIssue = {
    code: "DOCUMENT_INTEGRITY_MANUAL_REVIEW",
    category: "DOCUMENT_INTEGRITY",
    severity: "REVIEW",
    title: "One or more packet pages could not be read reliably",
    recommendedAction: `Manually inspect physical PDF page(s) ${[...unresolved].sort((a, b) => a - b).join(", ")} before final release. Do not treat unreadability itself as a title defect.`,
    checkId: "DOCUMENT_INTEGRITY",
    evidence: [],
    evidenceIds: [],
  };

  const curativeIssues = review.qc.curativeIssues.some((issue) => issue.code === integrityIssue.code)
    ? review.qc.curativeIssues
    : [...review.qc.curativeIssues, integrityIssue];

  const existingReadableFail = checks.some((check) => check.status === "FAIL" && check.critical);
  return {
    ...review,
    record: { ...review.record, dataQualityWarnings },
    qc: {
      ...review.qc,
      checks,
      qcStatus: existingReadableFail ? "FAIL" : "REVIEW",
      foreclosureReadiness: existingReadableFail ? review.qc.foreclosureReadiness : "CANNOT_CONFIRM",
      curativeIssues,
      unresolvedCount: Math.max(review.qc.unresolvedCount, unresolved.size),
    },
  };
}
