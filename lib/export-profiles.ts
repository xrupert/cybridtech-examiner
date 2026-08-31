import type { CanonicalTitleRecord, QcProfileResult } from "./title-domain";
import { buildVeraAccuracyAudit, veraPassFailReason } from "./vera-accuracy-audit";

export type ExportPath =
  | "orderNumber" | "tsNumber" | "borrower" | "currentOwner" | "propertyAddress" | "state" | "county" | "parcelId" | "orderType" | "effectiveDate"
  | "targetLien.instrumentNumber" | "targetLien.amount" | "targetLien.beneficiary" | "targetLien.position" | "targetLien.positionBasis" | "targetLien.positionConfidence"
  | "foreclosure.openLienCount" | "foreclosure.seniorLiens" | "foreclosure.juniorLiens" | "foreclosure.requirements" | "foreclosure.status" | "foreclosure.jurisdictionCoverage"
  | "qc.vera20" | "qc.veraAudit" | "qc.veraPassFail" | "qc.qcStatus" | "qc.foreclosureReadiness" | "qc.curativeIssueCount" | "qc.curativeIssues" | "packetHash" | "reviewId" | "sourceFile";

export interface ExportColumn { key: string; label: string; path: ExportPath; required?: boolean; }
export interface ExportProfile { id: string; version: number; clientName: string; format: "csv" | "json"; columns: ExportColumn[]; }
export interface ExportRowContext { record: CanonicalTitleRecord; qc: QcProfileResult; }

export const MCCALLA_EXPORT_PROFILE: ExportProfile = {
  id: "mccalla-v3", version: 3, clientName: "McCalla", format: "csv",
  columns: [
    { key: "ts_number", label: "TS Number", path: "tsNumber", required: true },
    { key: "borrower_name", label: "Borrower Name", path: "borrower", required: true },
    { key: "property_address", label: "Property Address", path: "propertyAddress", required: true },
    { key: "lien_amount", label: "Lien Amount", path: "targetLien.amount", required: true },
    { key: "lien_position", label: "Lien Position", path: "targetLien.position", required: true },
    { key: "lien_position_basis", label: "Lien Position Basis", path: "targetLien.positionBasis", required: true },
    { key: "senior_liens", label: "Senior Liens", path: "foreclosure.seniorLiens" },
    { key: "foreclosure_requirements", label: "Foreclosure Cure / Action", path: "foreclosure.requirements" },
    { key: "vera_20_review", label: "Vera 20 Review", path: "qc.vera20" },
    { key: "vera_accuracy_audit", label: "Title Report / Run Sheet Accuracy Audit", path: "qc.veraAudit" },
    { key: "vera_pass_fail", label: "Vera Pass / Fail Determination", path: "qc.veraPassFail" },
    { key: "qc_status", label: "QC Status", path: "qc.qcStatus" },
    { key: "review_readiness", label: "Review Readiness", path: "qc.foreclosureReadiness" },
  ],
};

export const NCALA_DEMO_EXPORT_PROFILE = MCCALLA_EXPORT_PROFILE;

export const AVAILABLE_EXPORT_COLUMNS: ExportColumn[] = [
  ...MCCALLA_EXPORT_PROFILE.columns,
  { key: "current_owner", label: "Current Owner", path: "currentOwner" },
  { key: "order_number", label: "Client Order Number", path: "orderNumber" },
  { key: "order_type", label: "Order Type", path: "orderType" },
  { key: "state", label: "State", path: "state" },
  { key: "county", label: "County", path: "county" },
  { key: "parcel_id", label: "Parcel ID", path: "parcelId" },
  { key: "effective_date", label: "Effective Date", path: "effectiveDate" },
  { key: "target_lien_instrument", label: "Target Lien Instrument", path: "targetLien.instrumentNumber" },
  { key: "target_lien_beneficiary", label: "Target Lien Beneficiary", path: "targetLien.beneficiary" },
  { key: "target_lien_position_confidence", label: "Lien Position Confidence", path: "targetLien.positionConfidence" },
  { key: "open_lien_count", label: "Open Lien Count", path: "foreclosure.openLienCount" },
  { key: "junior_liens", label: "Junior Liens", path: "foreclosure.juniorLiens" },
  { key: "foreclosure_analysis_status", label: "Foreclosure Analysis Status", path: "foreclosure.status" },
  { key: "jurisdiction_coverage", label: "Jurisdiction Rule Coverage", path: "foreclosure.jurisdictionCoverage" },
  { key: "curative_issue_count", label: "Curative Issue Count", path: "qc.curativeIssueCount" },
  { key: "curative_issues", label: "QC Curative Issues", path: "qc.curativeIssues" },
  { key: "source_file", label: "Source File", path: "sourceFile" },
  { key: "review_id", label: "Review ID", path: "reviewId" },
  { key: "packet_hash", label: "Packet Hash", path: "packetHash" },
];

function stackLabel(record: CanonicalTitleRecord, ids: string[]): string {
  return ids.map((id) => record.foreclosureAnalysis.lienStack.find((entry) => entry.instrumentId === id))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .map((entry) => `${entry.positionLabel}: ${entry.instrumentType} ${entry.instrumentNumber} ${entry.amount}`)
    .join(" | ");
}

function combinedForeclosureRequirements(record: CanonicalTitleRecord, qc: QcProfileResult): string {
  const developed = record.foreclosureAnalysis.requirements.map((item) => {
    const scope = item.scope ? ` [${item.scope.replaceAll("_", " ")}]` : "";
    const authority = item.authority ? ` AUTHORITY: ${item.authority}` : "";
    const jurisdiction = item.jurisdiction ? ` JURISDICTION: ${item.jurisdiction}` : "";
    return `${item.type}${scope}: ${item.title} ACTION: ${item.action}${jurisdiction}${authority}`;
  });
  const qcIssues = qc.curativeIssues.map((issue) => `QC/CURE: ${issue.title} ACTION: ${issue.recommendedAction}`);
  return [...developed, ...qcIssues].join(" | ");
}

function jurisdictionCoverage(record: CanonicalTitleRecord): string {
  const coverage = record.foreclosureAnalysis.jurisdictionCoverage;
  if (!coverage) return "Not loaded";
  return `${coverage.status} · ${coverage.state} · ${coverage.county} · ${coverage.ruleSetVersion}: ${coverage.note}`;
}

function vera20(qc: QcProfileResult): string {
  return [...qc.checks]
    .filter((check) => check.legacyQuestionNumber)
    .sort((a, b) => (a.legacyQuestionNumber || 0) - (b.legacyQuestionNumber || 0))
    .map((check) => `Q${check.legacyQuestionNumber} ${check.status}: ${check.summary}`)
    .join(" | ");
}

function veraAudit(record: CanonicalTitleRecord, qc: QcProfileResult): string {
  return buildVeraAccuracyAudit(record, qc).map((area) => `${area.label} — ${area.status}: ${area.summary}`).join(" | ");
}

function veraPassFail(qc: QcProfileResult): string {
  const result = veraPassFailReason(qc);
  return `${result.status}: ${result.reason} ${result.confirmation}`;
}

function pathValue(context: ExportRowContext, path: ExportPath): string | number {
  const { record, qc } = context;
  switch (path) {
    case "orderNumber": return record.orderNumber.value;
    case "tsNumber": return record.tsNumber.value;
    case "borrower": return record.borrower.value;
    case "currentOwner": return record.currentOwner.value;
    case "propertyAddress": return record.propertyAddress.value;
    case "state": return record.state.value;
    case "county": return record.county.value;
    case "parcelId": return record.parcelId.value;
    case "orderType": return record.orderType.value;
    case "effectiveDate": return record.effectiveDate.value;
    case "targetLien.instrumentNumber": return record.targetLien.instrumentNumber.value;
    case "targetLien.amount": return record.targetLien.amount.value;
    case "targetLien.beneficiary": return record.targetLien.beneficiary.value;
    case "targetLien.position": return record.targetLien.position.value;
    case "targetLien.positionBasis": return record.targetLien.positionBasis;
    case "targetLien.positionConfidence": return record.targetLien.positionConfidence;
    case "foreclosure.openLienCount": return record.foreclosureAnalysis.openLienCount;
    case "foreclosure.seniorLiens": return stackLabel(record, record.foreclosureAnalysis.seniorLienIds);
    case "foreclosure.juniorLiens": return stackLabel(record, record.foreclosureAnalysis.juniorLienIds);
    case "foreclosure.requirements": return combinedForeclosureRequirements(record, qc);
    case "foreclosure.status": return record.foreclosureAnalysis.status;
    case "foreclosure.jurisdictionCoverage": return jurisdictionCoverage(record);
    case "qc.vera20": return vera20(qc);
    case "qc.veraAudit": return veraAudit(record, qc);
    case "qc.veraPassFail": return veraPassFail(qc);
    case "qc.qcStatus": return qc.qcStatus;
    case "qc.foreclosureReadiness": return qc.foreclosureReadiness;
    case "qc.curativeIssueCount": return qc.curativeIssues.length;
    case "qc.curativeIssues": return qc.curativeIssues.map((issue) => `${issue.code}: ${issue.title}`).join(" | ");
    case "packetHash": return record.packetHash;
    case "reviewId": return record.reviewId;
    case "sourceFile": return record.sourceFile;
  }
}

function csv(value: unknown): string { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

export function validateExportProfile(profile: ExportProfile, rows: ExportRowContext[]): string[] {
  const warnings: string[] = [];
  for (const column of profile.columns.filter((item) => item.required)) {
    rows.forEach((row, index) => {
      const value = String(pathValue(row, column.path) ?? "").trim();
      if (!value || /^needs review$|^unresolved$/i.test(value)) warnings.push(`Row ${index + 1}: required McCalla export field ${column.label} is unresolved.`);
    });
  }
  return warnings;
}

export function renderCsv(profile: ExportProfile, rows: ExportRowContext[]): string {
  const header = profile.columns.map((column) => csv(column.label)).join(",");
  const body = rows.map((row) => profile.columns.map((column) => csv(pathValue(row, column.path))).join(","));
  return [header, ...body].join("\r\n");
}

export function renderJson(profile: ExportProfile, rows: ExportRowContext[]): string {
  const payload = rows.map((row) => Object.fromEntries(profile.columns.map((column) => [column.key, pathValue(row, column.path)])));
  return JSON.stringify(payload, null, 2);
}

export function createExportProfile(clientName: string, columns: ExportColumn[], format: "csv" | "json" = "csv"): ExportProfile {
  const normalized = clientName.trim() || "Client";
  return { id: `${normalized.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-custom-v1`, version: 1, clientName: normalized, format, columns };
}
