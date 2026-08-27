import { VeraExam } from "./vera";

const MISSING = new Set(["Not Provided", "Not yet examined", ""]);

function missing(v: string): boolean {
  return MISSING.has(v.trim());
}

export function critique(exam: VeraExam): VeraExam {
  const issues: string[] = [];

  if (missing(exam.propertyAddress)) issues.push("Property address not extracted");
  if (missing(exam.parcelId)) issues.push("Parcel / APN missing");
  if (missing(exam.searchEffectiveDate)) issues.push("Effective / search date missing");
  if (missing(exam.legalDescription)) issues.push("Legal description missing");
  if (missing(exam.deed.grantor) && missing(exam.deed.grantee)) issues.push("Vesting deed parties missing");
  if (exam.typosOrErrors.toLowerCase().includes("mock")) issues.push("Source packet is mock / incomplete by its own legend");
  if (exam.deed.bookPage === "Not Provided") issues.push("Deed book/page not on packet");
  if (exam.minNumber === "Not Provided") issues.push("MIN# not on packet");
  if (exam.loanDocumentType === "Not Provided") issues.push("No DOT / mortgage instrument typed");

  const hardFail =
    missing(exam.propertyAddress) ||
    missing(exam.parcelId) ||
    missing(exam.legalDescription) ||
    exam.typosOrErrors.toLowerCase().includes("placeholder");

  const status = hardFail ? "Fail" : issues.length > 3 ? "Fail" : "Pass";
  const reason = hardFail
    ? issues.slice(0, 4).join("; ") || "Missing key information"
    : issues.length
      ? `Extracted with caveats: ${issues.slice(0, 3).join("; ")}`
      : "All core Vera fields extracted from the packet";

  return {
    ...exam,
    status,
    reason,
    confirmation:
      status === "Fail"
        ? "The document contains the issues identified above and does not meet quality standards."
        : "The document meets all quality standards with no identified issues.",
    notes: [
      exam.notes,
      `Critic flags (${issues.length}): ${issues.join(" | ") || "none"}`,
      "Examiner output is a QA worksheet, not a title insurance policy or legal opinion.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}
