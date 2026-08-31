import type { CanonicalTitleRecord, QcCheckResult, QcProfileResult, QcStatus } from "./title-domain";

export type VeraAuditStatus = "ACCURATE" | "COMPLETE" | "PARTIAL" | "INCOMPLETE" | "DISCREPANCIES" | "PRESENT" | "NONE";
export interface VeraAuditArea {
  key: "VESTING" | "CHAIN" | "MORTGAGE" | "TAX" | "JUDGMENTS_LIENS" | "EASEMENTS_RESTRICTIONS";
  label: string;
  status: VeraAuditStatus;
  summary: string;
  checkIds: string[];
}

function checksById(qc: QcProfileResult, ids: string[]): QcCheckResult[] {
  const wanted = new Set(ids);
  return qc.checks.filter((check) => wanted.has(check.id));
}

function aggregate(checks: QcCheckResult[], accurate: VeraAuditStatus = "ACCURATE"): VeraAuditStatus {
  if (checks.some((check) => check.status === "FAIL")) return "DISCREPANCIES";
  if (checks.some((check) => check.status === "CANNOT_CONFIRM")) return "INCOMPLETE";
  return accurate;
}

function compact(checks: QcCheckResult[]): string {
  const material = checks.filter((check) => check.status !== "PASS" && check.status !== "NOT_APPLICABLE");
  if (material.length) return material.map((check) => `${check.label}: ${check.summary}`).join(" | ");
  return checks.map((check) => check.summary).filter(Boolean).slice(0, 3).join(" | ") || "No applicable exception identified.";
}

function valueIsNegative(value: string): boolean {
  return /^(?:no|none|not found|not applicable|n\/a)/i.test(value.trim());
}

export function buildVeraAccuracyAudit(record: CanonicalTitleRecord, qc: QcProfileResult): VeraAuditArea[] {
  const vestingChecks = checksById(qc, ["CURRENT_OWNER_ESTABLISHED", "PRIOR_OWNER_ESTABLISHED", "DEED_MORTGAGE_ACCURACY", "LEGAL_DESCRIPTION_RECONCILES"]);
  const chainChecks = checksById(qc, ["OWNERSHIP_CHAIN_COMPLETE", "RECORDING_ORDER_RECONCILES", "ASSIGNMENT_CHAIN_COMPLETE", "RECORDED_DOCUMENTS_RECONCILE"]);
  const mortgageChecks = checksById(qc, ["DEED_MORTGAGE_ACCURACY", "MERS_BENEFICIARY_REVIEWED", "RELEASES_RECONCILED", "PROPERTY_IDENTITY_RECONCILES", "LOAN_DOCUMENT_TYPE_REVIEWED", "LOAN_RECORDING_DATE_REVIEWED", "LOAN_STATUS_REVIEWED", "MIN_RUN_SHEET_REVIEWED"]);
  const taxChecks = checksById(qc, ["FEDERAL_TAX_LIEN_REVIEWED"]);
  const lienChecks = checksById(qc, ["RELEASES_RECONCILED", "RECORDED_DOCUMENTS_RECONCILE", "MATERIAL_REPORT_ERRORS_REVIEWED"]);
  const restrictionChecks = checksById(qc, ["CCRS_REVIEWED", "HOA_STATUS_REVIEWED", "HOA_NAME_AMOUNTS_REVIEWED", "PLAT_REQUIREMENT_REVIEWED"]);

  const chainStatus = aggregate(chainChecks, "COMPLETE");
  const taxStatus: VeraAuditStatus = taxChecks.some((check) => check.status === "FAIL")
    ? "DISCREPANCIES"
    : record.taxes.status.state === "CONFIRMED"
      ? "ACCURATE"
      : "INCOMPLETE";

  const openLiens = record.foreclosureAnalysis.lienStack.filter((entry) => entry.status === "OPEN");
  const unknownLiens = record.foreclosureAnalysis.lienStack.filter((entry) => entry.status === "UNKNOWN");
  const lienStatus: VeraAuditStatus = lienChecks.some((check) => check.status === "FAIL") || unknownLiens.length
    ? "DISCREPANCIES"
    : openLiens.length ? "PRESENT" : "NONE";
  const lienSummary = unknownLiens.length
    ? `${openLiens.length} supported open lien(s); ${unknownLiens.length} lien identity/identities have unresolved open/released status.`
    : openLiens.length
      ? `${openLiens.length} supported open lien(s): ${openLiens.map((entry) => `${entry.instrumentType} ${entry.instrumentNumber}`).join("; ")}.`
      : "No supported open lien identity remains in the developed stack.";

  const restrictionsPresent = record.references.some((reference) => /easement|restriction|covenant|cc&r|declaration/i.test(`${reference.documentType} ${reference.description}`))
    || (record.flags.ccrs.state === "CONFIRMED" && !valueIsNegative(record.flags.ccrs.value));
  const restrictionsStatus: VeraAuditStatus = restrictionChecks.some((check) => check.status === "FAIL")
    ? "DISCREPANCIES"
    : restrictionChecks.some((check) => check.status === "CANNOT_CONFIRM")
      ? "INCOMPLETE"
      : restrictionsPresent ? "PRESENT" : "NONE";

  return [
    { key: "VESTING", label: "Vesting Deed Information", status: aggregate(vestingChecks), summary: compact(vestingChecks), checkIds: vestingChecks.map((check) => check.id) },
    { key: "CHAIN", label: "Chain of Title", status: chainStatus, summary: compact(chainChecks), checkIds: chainChecks.map((check) => check.id) },
    { key: "MORTGAGE", label: "Mortgage Information", status: aggregate(mortgageChecks), summary: compact(mortgageChecks), checkIds: mortgageChecks.map((check) => check.id) },
    { key: "TAX", label: "Tax Information", status: taxStatus, summary: record.taxes.status.state === "CONFIRMED" ? `Tax status: ${record.taxes.status.value}; fiscal year: ${record.taxes.fiscalYear.value}.` : "Tax status/fiscal-year evidence is incomplete or unconfirmed.", checkIds: taxChecks.map((check) => check.id) },
    { key: "JUDGMENTS_LIENS", label: "Judgments and Liens", status: lienStatus, summary: lienSummary, checkIds: lienChecks.map((check) => check.id) },
    { key: "EASEMENTS_RESTRICTIONS", label: "Easements and Restrictions", status: restrictionsStatus, summary: restrictionsPresent ? `Restriction/easement-related references are present. ${compact(restrictionChecks)}` : compact(restrictionChecks), checkIds: restrictionChecks.map((check) => check.id) },
  ];
}

export function veraPassFailReason(qc: QcProfileResult): { status: "Pass" | "Fail"; reason: string; confirmation: string } {
  const failed = qc.checks.filter((check) => check.status === "FAIL");
  const unresolved = qc.checks.filter((check) => check.status === "CANNOT_CONFIRM");
  if (failed.length) return { status: "Fail", reason: `${failed.length} confirmed QC failure${failed.length === 1 ? "" : "s"}: ${failed.slice(0, 3).map((check) => check.label).join("; ")}.`, confirmation: "The document contains the issues identified above and does not meet quality standards." };
  if (unresolved.length) return { status: "Fail", reason: `${unresolved.length} review item${unresolved.length === 1 ? " remains" : "s remain"} unconfirmed; quality standards cannot be certified until resolved.`, confirmation: "The document contains unresolved review items and cannot yet be certified as meeting quality standards." };
  return { status: "Pass", reason: "All applicable Vera review checks are resolved without an identified QC failure.", confirmation: "The document meets all quality standards with no identified issues." };
}
