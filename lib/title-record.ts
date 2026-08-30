import type { AuditFinding, EvidenceRef, VeraExam } from "./vera";

export type ForeclosureReadiness = "CLEAR" | "QC_DEFICIENCY" | "CURATIVE_REQUIRED" | "CANNOT_CONFIRM";
export type CurativeSeverity = "BLOCKING" | "REVIEW" | "QC" | "INFO";

export interface CurativeIssue {
  code: string;
  category: string;
  severity: CurativeSeverity;
  title: string;
  recommendedAction: string;
  findingNumber: number;
  evidence: EvidenceRef[];
}

export interface CanonicalTitleRecord {
  recordId: string;
  reviewId: string;
  sourceFile: string;
  clientName: string;
  tsNumber: string;
  clientOrderNumber: string;
  searchType: string;
  state: string;
  county: string;
  borrowerName: string;
  borrowerBasis: string;
  propertyAddress: string;
  parcelId: string;
  targetLien: {
    instrumentNumber: string;
    amount: string;
    beneficiary: string;
    reportedPosition: string;
    positionBasis: string;
  };
  qcStatus: "PASS" | "FAIL" | "REVIEW";
  criticalPassRate: number;
  foreclosureReadiness: ForeclosureReadiness;
  curativeIssues: CurativeIssue[];
  packetHash: string;
  matterRevision: number;
  effectiveDate: string;
}

export const EXPORT_FIELDS = [
  { key: "tsNumber", label: "TS Number" },
  { key: "borrowerName", label: "Borrower Name" },
  { key: "propertyAddress", label: "Property Address" },
  { key: "lienPosition", label: "Lien Position" },
  { key: "targetLienAmount", label: "Target Lien Amount" },
  { key: "targetLienInstrument", label: "Target Lien Instrument" },
  { key: "targetLienBeneficiary", label: "Target Lien Beneficiary" },
  { key: "clientOrderNumber", label: "Client Order Number" },
  { key: "searchType", label: "Search Type" },
  { key: "state", label: "State" },
  { key: "county", label: "County" },
  { key: "parcelId", label: "Parcel ID" },
  { key: "qcStatus", label: "QC Status" },
  { key: "foreclosureReadiness", label: "Foreclosure Readiness" },
  { key: "curativeCount", label: "Curative Issue Count" },
  { key: "curativeIssues", label: "Curative Issues" },
  { key: "effectiveDate", label: "Effective Date" },
  { key: "sourceFile", label: "Source File" },
  { key: "reviewId", label: "Review ID" },
] as const;

export type ExportFieldKey = (typeof EXPORT_FIELDS)[number]["key"];

export const NCALA_DEMO_EXPORT_FIELDS: ExportFieldKey[] = [
  "tsNumber",
  "borrowerName",
  "propertyAddress",
  "lienPosition",
  "qcStatus",
  "foreclosureReadiness",
  "curativeIssues",
];

function clean(value: string | undefined): string {
  const text = String(value || "").trim();
  return text && !/^not (provided|stated|applicable)$/i.test(text) ? text : "";
}

function finding(exam: VeraExam, number: number): AuditFinding | undefined {
  return exam.findings.find((item) => item.number === number);
}

function combinedFindingText(exam: VeraExam): string {
  return exam.findings.map((item) => `${item.response} ${item.proofReason} ${item.commentary || ""}`).join(" \n ");
}

function extractBorrower(exam: VeraExam): { value: string; basis: string } {
  const q4 = `${finding(exam, 4)?.response || ""} ${finding(exam, 4)?.proofReason || ""}`;
  const match = q4.match(/\bBorrower\s*(?:is|:|-)?\s*([A-Z][A-Za-z0-9 .,'&()/-]{2,90}?)(?=\s*(?:;|\||,\s*(?:Lender|Holder|Beneficiary|Trustee|Amount|Date|Recorded)|\$|$))/i);
  if (match?.[1]) return { value: match[1].trim(), basis: "Explicit borrower text in Q4 source reconciliation" };

  const grantee = clean(exam.deed?.grantee);
  if (grantee) return { value: grantee, basis: "Fallback to current vesting grantee; verify if borrower differs" };
  return { value: "Needs review", basis: "Borrower was not reliably normalized from the completed review" };
}

function extractLienPosition(exam: VeraExam): { value: string; basis: string } {
  const text = combinedFindingText(exam);
  const explicit = text.match(/\b(?:lien\s+position|position)\s*(?:is|:|#|-)?\s*(1st|first|2nd|second|3rd|third|4th|fourth|\d+)\b/i);
  if (explicit?.[1]) return { value: explicit[1], basis: "Explicit lien-position language in title review evidence" };
  return { value: "Needs review", basis: "No explicit lien-position statement was established from the packet" };
}

function issueRule(number: number): { code: string; category: string; severity: CurativeSeverity; action: string } {
  switch (number) {
    case 4: return { code: "TITLE_DATA_MISMATCH", category: "Deed / Mortgage", severity: "REVIEW", action: "Reconcile the deed/mortgage parties, amounts, and recording facts before foreclosure referral." };
    case 5: return { code: "MISSING_OR_MISMATCHED_RECORDING", category: "Recorded Documents", severity: "BLOCKING", action: "Obtain or correct the missing/mismatched recorded instrument and re-run QC." };
    case 6: return { code: "RECORDING_ORDER_ISSUE", category: "Chain", severity: "REVIEW", action: "Confirm the required chain/order sequence and correct the title summary if needed." };
    case 7: return { code: "ASSIGNMENT_CHAIN_GAP", category: "Assignment", severity: "BLOCKING", action: "Cure the assignment/vesting chain or obtain the missing recorded assignment evidence." };
    case 8: return { code: "LEGAL_DESCRIPTION_DISCREPANCY", category: "Legal Description", severity: "BLOCKING", action: "Resolve the legal-description discrepancy against the controlling recorded instrument." };
    case 9: return { code: "MERS_MIN_ISSUE", category: "MERS / MIN", severity: "REVIEW", action: "Confirm MERS/MIN applicability and correct the title summary if required." };
    case 10: return { code: "FEDERAL_TAX_LIEN", category: "Lien", severity: "BLOCKING", action: "Confirm the lien status, priority, and required foreclosure treatment before proceeding." };
    case 11: return { code: "RELEASE_SATISFACTION_ISSUE", category: "Release", severity: "BLOCKING", action: "Obtain or reconcile the applicable release/satisfaction evidence." };
    case 12: return { code: "PROPERTY_IDENTITY_ISSUE", category: "Property", severity: "BLOCKING", action: "Resolve the property/address/security mismatch before foreclosure referral." };
    case 17: return { code: "MATERIAL_REPORT_ERROR", category: "QC", severity: "QC", action: "Correct the material title-report or Run Sheet error and re-run QC." };
    case 18: return { code: "PLAT_MAP_ISSUE", category: "Plat", severity: "QC", action: "Obtain/correct the referenced plat when required by the selected order profile." };
    case 19: return { code: "MIN_DATA_ISSUE", category: "MERS / MIN", severity: "QC", action: "Correct or confirm the MIN field when applicable." };
    case 20: return { code: "RUN_SHEET_ACCURACY", category: "Run Sheet", severity: "QC", action: "Correct Run Sheet entries that do not reconcile to the packet evidence." };
    default: return { code: `Q${number}_ISSUE`, category: "QC", severity: "INFO", action: "Review and resolve the documented exception." };
  }
}

function buildCurativeIssues(exam: VeraExam): CurativeIssue[] {
  return exam.findings
    .filter((item) => item.status === "FAIL" || (item.critical && ["CANNOT_CONFIRM", "UNDETERMINED", "NOT_STATED"].includes(item.status)))
    .map((item) => {
      const base = issueRule(item.number);
      const unresolved = item.status !== "FAIL";
      return {
        code: unresolved ? `CANNOT_CONFIRM_${base.code}` : base.code,
        category: base.category,
        severity: unresolved && base.severity !== "BLOCKING" ? "REVIEW" : base.severity,
        title: item.response || item.question,
        recommendedAction: unresolved ? `Evidence is insufficient to close this critical item. ${base.action}` : base.action,
        findingNumber: item.number,
        evidence: item.evidence,
      } satisfies CurativeIssue;
    });
}

function readiness(issues: CurativeIssue[]): ForeclosureReadiness {
  if (issues.some((item) => item.severity === "BLOCKING")) return "CURATIVE_REQUIRED";
  if (issues.some((item) => item.severity === "REVIEW")) return "CANNOT_CONFIRM";
  if (issues.some((item) => item.severity === "QC")) return "QC_DEFICIENCY";
  return "CLEAR";
}

function qcStatus(exam: VeraExam): CanonicalTitleRecord["qcStatus"] {
  if (exam.findings.some((item) => item.critical && ["CANNOT_CONFIRM", "UNDETERMINED", "NOT_STATED"].includes(item.status))) return "REVIEW";
  return exam.status === "Pass" ? "PASS" : "FAIL";
}

export function buildCanonicalTitleRecord(exam: VeraExam, clientName = "Ncala"): CanonicalTitleRecord {
  const borrower = extractBorrower(exam);
  const lienPosition = extractLienPosition(exam);
  const mortgage = exam.mortgages?.[0];
  const issues = buildCurativeIssues(exam);

  return {
    recordId: exam.reviewId || `${exam.packetHash || exam.sourceFile}-${exam.matterRevision || 1}`,
    reviewId: exam.reviewId || "",
    sourceFile: exam.sourceFile,
    clientName,
    tsNumber: clean(exam.clientOrder) || "Needs review",
    clientOrderNumber: clean(exam.clientOrder) || "Needs review",
    searchType: exam.searchType,
    state: exam.state,
    county: exam.county,
    borrowerName: borrower.value,
    borrowerBasis: borrower.basis,
    propertyAddress: exam.propertyAddress,
    parcelId: exam.parcelId,
    targetLien: {
      instrumentNumber: clean(mortgage?.instrument) || "Needs review",
      amount: clean(mortgage?.amount) || "Needs review",
      beneficiary: clean(mortgage?.holder) || "Needs review",
      reportedPosition: lienPosition.value,
      positionBasis: lienPosition.basis,
    },
    qcStatus: qcStatus(exam),
    criticalPassRate: exam.criticalPassRate,
    foreclosureReadiness: readiness(issues),
    curativeIssues: issues,
    packetHash: exam.packetHash,
    matterRevision: exam.matterRevision,
    effectiveDate: exam.searchEffectiveDate,
  };
}

export function exportValue(record: CanonicalTitleRecord, key: ExportFieldKey): string | number {
  switch (key) {
    case "tsNumber": return record.tsNumber;
    case "borrowerName": return record.borrowerName;
    case "propertyAddress": return record.propertyAddress;
    case "lienPosition": return record.targetLien.reportedPosition;
    case "targetLienAmount": return record.targetLien.amount;
    case "targetLienInstrument": return record.targetLien.instrumentNumber;
    case "targetLienBeneficiary": return record.targetLien.beneficiary;
    case "clientOrderNumber": return record.clientOrderNumber;
    case "searchType": return record.searchType;
    case "state": return record.state;
    case "county": return record.county;
    case "parcelId": return record.parcelId;
    case "qcStatus": return record.qcStatus;
    case "foreclosureReadiness": return record.foreclosureReadiness;
    case "curativeCount": return record.curativeIssues.length;
    case "curativeIssues": return record.curativeIssues.map((item) => `${item.code}: ${item.title}`).join(" | ");
    case "effectiveDate": return record.effectiveDate;
    case "sourceFile": return record.sourceFile;
    case "reviewId": return record.reviewId;
  }
}

function csvQuote(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function titleRecordsToCsv(records: CanonicalTitleRecord[], fields: ExportFieldKey[]): string {
  const headers = fields.map((key) => EXPORT_FIELDS.find((field) => field.key === key)?.label || key);
  const rows = records.map((record) => fields.map((key) => csvQuote(exportValue(record, key))).join(","));
  return [headers.map(csvQuote).join(","), ...rows].join("\n");
}

export function titleRecordsToJson(records: CanonicalTitleRecord[], fields: ExportFieldKey[]): string {
  const payload = records.map((record) => Object.fromEntries(fields.map((key) => [
    EXPORT_FIELDS.find((field) => field.key === key)?.label || key,
    exportValue(record, key),
  ])));
  return JSON.stringify(payload, null, 2);
}
