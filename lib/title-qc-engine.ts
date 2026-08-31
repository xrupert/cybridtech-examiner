import type { ProfileCheckId } from "./qc-profiles";
import type { CurativeIssue, CurativeSeverity, QcCheckResult, QcProfileResult } from "./title-domain";

export function issueMetadata(id: ProfileCheckId): { code: string; severity: CurativeSeverity; action: string } {
  switch (id) {
    case "CURRENT_OWNER_ESTABLISHED": return { code: "CURRENT_OWNER_UNRESOLVED", severity: "BLOCKING", action: "Establish current vesting from the controlling deed evidence." };
    case "PRIOR_OWNER_ESTABLISHED": return { code: "PRIOR_OWNER_UNRESOLVED", severity: "BLOCKING", action: "Establish the qualifying prior-owner/full-value conveyance required by the selected order profile." };
    case "OWNERSHIP_CHAIN_COMPLETE": return { code: "OWNERSHIP_CHAIN_GAP", severity: "BLOCKING", action: "Establish the ownership-chain or concurrent-PMM evidence required by the selected order profile." };
    case "TARGET_LIEN_FOUND": return { code: "TARGET_LIEN_UNRESOLVED", severity: "BLOCKING", action: "Identify the exact lien being foreclosed and its recorded instrument." };
    case "TARGET_LIEN_POSITION_ESTABLISHED": return { code: "LIEN_POSITION_UNRESOLVED", severity: "BLOCKING", action: "Confirm the foreclosure lien position from title evidence; do not infer position from document order." };
    case "RECORDED_DOCUMENTS_RECONCILE": return { code: "MISSING_OR_MISMATCHED_RECORDING", severity: "BLOCKING", action: "Obtain or correct the missing or mismatched recorded instrument and re-run QC." };
    case "RECORDING_ORDER_RECONCILES": return { code: "RECORDING_CHAIN_ORDER_ISSUE", severity: "REVIEW", action: "Reconcile the required chain/order sequence against the recorded source documents." };
    case "ASSIGNMENT_CHAIN_COMPLETE": return { code: "ASSIGNMENT_CHAIN_GAP", severity: "BLOCKING", action: "Cure the assignment/vesting chain or obtain the missing recorded assignment evidence." };
    case "LEGAL_DESCRIPTION_RECONCILES": return { code: "LEGAL_DESCRIPTION_DISCREPANCY", severity: "BLOCKING", action: "Resolve the legal-description discrepancy against the controlling recorded instrument." };
    case "FEDERAL_TAX_LIEN_REVIEWED": return { code: "FEDERAL_TAX_LIEN_REVIEW", severity: "BLOCKING", action: "Confirm any federal tax lien status and applicable treatment required by the selected order profile." };
    case "RELEASES_RECONCILED": return { code: "RELEASE_SATISFACTION_ISSUE", severity: "BLOCKING", action: "Obtain or reconcile the applicable release/satisfaction evidence." };
    case "PROPERTY_IDENTITY_RECONCILES": return { code: "PROPERTY_IDENTITY_ISSUE", severity: "BLOCKING", action: "Resolve the property/address/security mismatch against the controlling source documents." };
    case "MATERIAL_REPORT_ERRORS_REVIEWED": return { code: "MATERIAL_REPORT_ERROR", severity: "QC", action: "Correct the material title-report/source-document error and re-run QC." };
    case "PLAT_REQUIREMENT_REVIEWED": return { code: "PLAT_MAP_ISSUE", severity: "QC", action: "Obtain or correct the referenced plat when the selected order profile requires it." };
    case "RUN_SHEET_RECONCILES": return { code: "RUN_SHEET_ACCURACY", severity: "QC", action: "Correct the distinct Run Sheet/Abstractor Sheet values that do not reconcile to supporting instruments." };
  }
}

export function enforceGroundedConclusions(checks: QcCheckResult[]): QcCheckResult[] {
  return checks.map((check) => {
    if ((check.status === "PASS" || check.status === "FAIL") && !check.evidence.length) {
      return {
        ...check,
        status: "CANNOT_CONFIRM" as const,
        summary: `Cannot Confirm — conclusive result lacked grounded source evidence: ${check.summary}`,
        recommendedAction: check.recommendedAction === "No curative action required for this check." ? "Review the source evidence required to support this check." : check.recommendedAction,
      };
    }
    return check;
  });
}

function curativeIssue(check: QcCheckResult): CurativeIssue | null {
  if (check.status === "PASS" || check.status === "NOT_APPLICABLE") return null;
  const meta = issueMetadata(check.id as ProfileCheckId);
  return {
    code: check.status === "CANNOT_CONFIRM" ? `CANNOT_CONFIRM_${meta.code}` : meta.code,
    category: check.category,
    severity: check.status === "CANNOT_CONFIRM" && meta.severity === "QC" ? "REVIEW" : meta.severity,
    title: check.summary,
    recommendedAction: check.recommendedAction,
    checkId: check.id,
    evidence: check.evidence,
    evidenceIds: check.evidenceIds || [],
  };
}

function readiness(issues: CurativeIssue[]): QcProfileResult["foreclosureReadiness"] {
  if (issues.some((item) => item.severity === "BLOCKING" && !item.code.startsWith("CANNOT_CONFIRM_"))) return "CURATIVE_REQUIRED";
  if (issues.some((item) => item.code.startsWith("CANNOT_CONFIRM_") || item.severity === "REVIEW")) return "CANNOT_CONFIRM";
  if (issues.some((item) => item.severity === "QC")) return "QC_DEFICIENCY";
  return "CLEAR";
}

export function reduceQcChecks(profile: Pick<QcProfileResult, "profileId" | "profileVersion" | "profileName">, checks: QcCheckResult[]): QcProfileResult {
  const issues = checks.map(curativeIssue).filter((item): item is CurativeIssue => Boolean(item));
  const unresolvedCount = checks.filter((check) => check.status === "CANNOT_CONFIRM").length;
  const failed = checks.some((check) => check.status === "FAIL");
  return { ...profile, checks, qcStatus: unresolvedCount ? "REVIEW" : failed ? "FAIL" : "PASS", foreclosureReadiness: readiness(issues), curativeIssues: issues, unresolvedCount };
}
