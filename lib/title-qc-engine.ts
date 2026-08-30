import { profileForOrderType, type ProfileCheckId, type QcProfileCheck } from "./qc-profiles";
import type { CanonicalTitleRecord, CurativeIssue, QcCheckResult, QcProfileResult, QcStatus, CurativeSeverity } from "./title-domain";
import type { AuditFinding, EvidenceRef, VeraExam } from "./vera";

function finding(exam: VeraExam, number?: number): AuditFinding | undefined {
  return number ? exam.findings.find((item) => item.number === number) : undefined;
}

function mapFindingStatus(status: AuditFinding["status"]): QcStatus {
  if (status === "PASS") return "PASS";
  if (status === "NOT_APPLICABLE") return "NOT_APPLICABLE";
  if (status === "FAIL") return "FAIL";
  return "CANNOT_CONFIRM";
}

function issueMetadata(id: ProfileCheckId): { code: string; severity: CurativeSeverity; action: string } {
  switch (id) {
    case "CURRENT_OWNER_ESTABLISHED": return { code: "CURRENT_OWNER_UNRESOLVED", severity: "BLOCKING", action: "Establish current vesting from the controlling deed evidence before foreclosure referral." };
    case "PRIOR_OWNER_ESTABLISHED": return { code: "PRIOR_OWNER_UNRESOLVED", severity: "BLOCKING", action: "Establish the required prior owner/conveyance from recorded deed evidence." };
    case "OWNERSHIP_CHAIN_COMPLETE": return { code: "OWNERSHIP_CHAIN_GAP", severity: "BLOCKING", action: "Cure or obtain evidence for the missing ownership-chain link." };
    case "TARGET_LIEN_FOUND": return { code: "TARGET_LIEN_UNRESOLVED", severity: "BLOCKING", action: "Identify the exact lien being foreclosed and its recorded instrument." };
    case "TARGET_LIEN_POSITION_ESTABLISHED": return { code: "LIEN_POSITION_UNRESOLVED", severity: "BLOCKING", action: "Confirm the foreclosure lien position from title evidence; do not infer position from document order." };
    case "RECORDED_DOCUMENTS_RECONCILE": return { code: "MISSING_OR_MISMATCHED_RECORDING", severity: "BLOCKING", action: "Obtain/correct the missing or mismatched recorded instrument and re-run QC." };
    case "RECORDING_ORDER_RECONCILES": return { code: "RECORDING_CHAIN_ORDER_ISSUE", severity: "REVIEW", action: "Reconcile the required chain/order sequence against the recorded source documents." };
    case "ASSIGNMENT_CHAIN_COMPLETE": return { code: "ASSIGNMENT_CHAIN_GAP", severity: "BLOCKING", action: "Cure the assignment/vesting chain or obtain the missing recorded assignment evidence." };
    case "LEGAL_DESCRIPTION_RECONCILES": return { code: "LEGAL_DESCRIPTION_DISCREPANCY", severity: "BLOCKING", action: "Resolve the legal-description discrepancy against the controlling recorded instrument." };
    case "FEDERAL_TAX_LIEN_REVIEWED": return { code: "FEDERAL_TAX_LIEN_REVIEW", severity: "BLOCKING", action: "Confirm any federal tax lien status, priority, notice requirements, and foreclosure treatment." };
    case "RELEASES_RECONCILED": return { code: "RELEASE_SATISFACTION_ISSUE", severity: "BLOCKING", action: "Obtain or reconcile the applicable release/satisfaction evidence." };
    case "PROPERTY_IDENTITY_RECONCILES": return { code: "PROPERTY_IDENTITY_ISSUE", severity: "BLOCKING", action: "Resolve the property/address/security mismatch before foreclosure referral." };
    case "MATERIAL_REPORT_ERRORS_REVIEWED": return { code: "MATERIAL_REPORT_ERROR", severity: "QC", action: "Correct the material title-report/Run Sheet error and re-run QC." };
    case "PLAT_REQUIREMENT_REVIEWED": return { code: "PLAT_MAP_ISSUE", severity: "QC", action: "Obtain or correct the referenced plat when the order/rule requires it." };
    case "RUN_SHEET_RECONCILES": return { code: "RUN_SHEET_ACCURACY", severity: "QC", action: "Correct Run Sheet/title-summary values that do not reconcile to the supporting instruments." };
  }
}

function result(check: QcProfileCheck, status: QcStatus, summary: string, evidence: EvidenceRef[] = [], sourceStatus?: AuditFinding["status"]): QcCheckResult {
  const meta = issueMetadata(check.id);
  return {
    id: check.id,
    label: check.label,
    category: check.category,
    status,
    severity: meta.severity,
    critical: check.critical,
    summary,
    recommendedAction: status === "PASS" || status === "NOT_APPLICABLE" ? "No curative action required for this check." : meta.action,
    evidence,
    legacyQuestionNumber: check.legacyQuestionNumber,
    sourceStatus,
  };
}

function legacyResult(check: QcProfileCheck, exam: VeraExam): QcCheckResult {
  const source = finding(exam, check.legacyQuestionNumber);
  if (!source) return result(check, "CANNOT_CONFIRM", "The required QC check was not produced by the review engine.");
  const status = mapFindingStatus(source.status);
  return result(check, status, source.response || source.proofReason || check.label, source.evidence || [], source.status);
}

function evaluate(check: QcProfileCheck, record: CanonicalTitleRecord, exam: VeraExam): QcCheckResult {
  switch (check.id) {
    case "CURRENT_OWNER_ESTABLISHED":
      return record.currentOwner.state === "CONFIRMED"
        ? result(check, "PASS", `Current owner established as ${record.currentOwner.value}.`, record.currentOwner.evidence)
        : result(check, "CANNOT_CONFIRM", "Current owner/vesting was not established from grounded deed evidence.", record.currentOwner.evidence);

    case "PRIOR_OWNER_ESTABLISHED": {
      const deedCount = record.deeds.filter((instrument) => instrument.instrumentNumber !== "Needs review").length;
      return deedCount >= 2
        ? result(check, "PASS", `${deedCount} deed instruments were normalized for the ownership chain.`, record.deeds.flatMap((instrument) => instrument.evidence))
        : result(check, "CANNOT_CONFIRM", "The required prior owner/deed was not independently normalized from the packet.", record.deeds.flatMap((instrument) => instrument.evidence));
    }

    case "OWNERSHIP_CHAIN_COMPLETE": {
      const q6 = finding(exam, 6);
      if (q6) return result(check, mapFindingStatus(q6.status), q6.response || q6.proofReason, q6.evidence || [], q6.status);
      return result(check, "CANNOT_CONFIRM", "Ownership-chain completeness could not be established.");
    }

    case "TARGET_LIEN_FOUND":
      if (!record.mortgages.length) return result(check, "CANNOT_CONFIRM", "No mortgage/deed-of-trust lien was normalized from the supplied title packet.");
      if (record.targetLien.selectionRequired) return result(check, "CANNOT_CONFIRM", `${record.mortgages.length} mortgage liens were found; the foreclosure target must be selected explicitly.`, record.mortgages.flatMap((instrument) => instrument.evidence));
      return result(check, "PASS", `Target lien identified as ${record.targetLien.instrumentNumber.value}.`, record.targetLien.instrumentNumber.evidence);

    case "TARGET_LIEN_POSITION_ESTABLISHED":
      return record.targetLien.position.state === "CONFIRMED"
        ? result(check, "PASS", `Target lien position established as ${record.targetLien.position.value}.`, record.targetLien.position.evidence)
        : result(check, "CANNOT_CONFIRM", "Lien position was not expressly established by the supplied title evidence.", record.targetLien.position.evidence);

    case "RUN_SHEET_RECONCILES": {
      if (!record.runSheet.detected) {
        return result(check, "CANNOT_CONFIRM", "A functional Run Sheet/title-summary section was not confidently segmented. The check remains unresolved rather than being waived as N/A.");
      }
      return legacyResult(check, exam);
    }

    default:
      return legacyResult(check, exam);
  }
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
  };
}

function readiness(issues: CurativeIssue[]): QcProfileResult["foreclosureReadiness"] {
  if (issues.some((item) => item.severity === "BLOCKING" && !item.code.startsWith("CANNOT_CONFIRM_"))) return "CURATIVE_REQUIRED";
  if (issues.some((item) => item.code.startsWith("CANNOT_CONFIRM_") || item.severity === "REVIEW")) return "CANNOT_CONFIRM";
  if (issues.some((item) => item.severity === "QC")) return "QC_DEFICIENCY";
  return "CLEAR";
}

export function runQcProfile(record: CanonicalTitleRecord, exam: VeraExam): QcProfileResult {
  const profile = profileForOrderType(record.orderType.value);
  const checks = profile.checks.map((check) => evaluate(check, record, exam));
  const issues = checks.map(curativeIssue).filter((item): item is CurativeIssue => Boolean(item));
  const unresolvedCount = checks.filter((check) => check.status === "CANNOT_CONFIRM").length;
  const failed = checks.some((check) => check.status === "FAIL");
  return {
    profileId: profile.id,
    profileVersion: profile.version,
    profileName: profile.name,
    checks,
    qcStatus: unresolvedCount ? "REVIEW" : failed ? "FAIL" : "PASS",
    foreclosureReadiness: readiness(issues),
    curativeIssues: issues,
    unresolvedCount,
  };
}
