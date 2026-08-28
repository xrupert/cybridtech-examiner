import type { EvidenceRef } from "./vera";

export type RunSheetCategory =
  | "Conveyance"
  | "Mortgage/DOT"
  | "Assignment"
  | "Release/Satisfaction"
  | "Judgment/Lien"
  | "Tax"
  | "HOA/CC&R"
  | "Plat"
  | "Probate/Estate"
  | "Other";

export type VerificationStatus = "VERIFIED" | "REVIEW";

export interface RunSheetRow {
  sequence: number;
  category: RunSheetCategory;
  instrumentType: string;
  documentDate: string;
  recordingDate: string;
  instrumentNumber: string;
  book: string;
  page: string;
  grantorBorrower: string;
  granteeBeneficiary: string;
  amount: string;
  status: string;
  legalDescriptionSummary: string;
  notes: string;
  evidence: EvidenceRef[];
  verificationStatus: VerificationStatus;
  verificationNote: string;
}

export interface RunSheetBuild {
  state: string;
  county: string;
  searchType: string;
  propertyAddress: string;
  parcelId: string;
  legalDescription: string;
  sourceFiles: string[];
  rows: RunSheetRow[];
  requirementsReview: string[];
  buildSummary: string;
  manualReviewRequired: boolean;
  generatedAt: string;
}

function parseDate(value: string): number | null {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function dateSort(a: string, b: string, direction: "asc" | "desc"): number {
  const av = parseDate(a);
  const bv = parseDate(b);
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return direction === "asc" ? av - bv : bv - av;
}

export function sortRunSheetRows(rows: RunSheetRow[], searchType: string): RunSheetRow[] {
  const categoryOrder: RunSheetCategory[] = [
    "Conveyance",
    "Mortgage/DOT",
    "Assignment",
    "Release/Satisfaction",
    "Judgment/Lien",
    "Tax",
    "HOA/CC&R",
    "Plat",
    "Probate/Estate",
    "Other",
  ];
  const sorted = [...rows].sort((a, b) => {
    const categoryDelta = categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
    if (categoryDelta !== 0) return categoryDelta;
    const newestFirst = a.category === "Conveyance" || a.category === "Judgment/Lien";
    const direction = newestFirst ? "desc" : "asc";
    return dateSort(a.recordingDate || a.documentDate, b.recordingDate || b.documentDate, direction);
  });
  return sorted.map((row, index) => ({ ...row, sequence: index + 1 }));
}

export function runSheetToCsv(build: RunSheetBuild): string {
  const headers = [
    "Sequence",
    "Category",
    "Instrument Type",
    "Document Date",
    "Recording Date",
    "Instrument Number",
    "Book",
    "Page",
    "Grantor / Borrower",
    "Grantee / Beneficiary",
    "Amount",
    "Status",
    "Legal Description Summary",
    "Notes",
    "Verification",
    "Verification Note",
    "Evidence Pages",
  ];
  const quote = (value: string | number) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = build.rows.map((row) => [
    row.sequence,
    row.category,
    row.instrumentType,
    row.documentDate,
    row.recordingDate,
    row.instrumentNumber,
    row.book,
    row.page,
    row.grantorBorrower,
    row.granteeBeneficiary,
    row.amount,
    row.status,
    row.legalDescriptionSummary,
    row.notes,
    row.verificationStatus,
    row.verificationNote,
    row.evidence.map((item) => `${item.page}:${item.quote}`).join(" | "),
  ].map(quote).join(","));
  return [headers.map(quote).join(","), ...rows].join("\n");
}
