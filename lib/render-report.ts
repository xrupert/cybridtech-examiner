import { VeraExam } from "./vera";

function evidenceLines(exam: VeraExam, number: number): string[] {
  const finding = exam.findings.find((item) => item.number === number);
  if (!finding) return [];
  const lines = finding.evidence.length
    ? finding.evidence.map((ev) => `[Evidence: '${ev.quote}' Page ${ev.page}; ${ev.documentType}; ${ev.source}${typeof ev.confidence === "number" ? `; confidence ${(ev.confidence * 100).toFixed(1)}%` : ""}]`)
    : ["[Evidence: Not Stated]"];
  if (finding.critical) lines.push(`[Status: ${finding.status === "PASS" || finding.status === "NOT_APPLICABLE" ? "PASS" : "FAIL"}]`, `[Proof/Reason: '${finding.proofReason}']`);
  return lines;
}

export function examToPlain(exam: VeraExam): string {
  const questionLines = exam.findings.flatMap((finding) => [
    `${finding.number}. ${finding.question}`,
    `Response: ${finding.response}`,
    ...evidenceLines(exam, finding.number),
    finding.commentary ? `Optional Commentary: ${finding.commentary}` : "",
    "",
  ]).filter(Boolean);

  return [
    "Title Report Review Summary",
    `State: ${exam.state}`,
    `County: ${exam.county}`,
    `Search Type: ${exam.searchType}`,
    `Client Order#: ${exam.clientOrder}`,
    `Address: ${exam.propertyAddress}`,
    `Effective Date: ${exam.searchEffectiveDate}`,
    `MIN#: ${exam.minNumber}`,
    "",
    "Property & Tax Information",
    `Parcel ID: ${exam.parcelId}`,
    `Land Value: ${exam.landValue}`,
    `Improvements: ${exam.improvements}`,
    `Tax Status: ${exam.taxStatus}`,
    `Fiscal Year: ${exam.fiscalYear}`,
    `Mobile Home: ${exam.mobileHome}`,
    `Condo/HOA: ${exam.condoHoa}`,
    "",
    "Required Questions (1–20)",
    ...questionLines,
    "Accuracy Audit",
    `Vesting Deed Response: ${exam.audit.vestingDeed}`,
    `Chain of Title Response: ${exam.audit.chainOfTitle}`,
    `Mortgage Info Response: ${exam.audit.mortgageInformation}`,
    `Tax Info Response: ${exam.audit.taxInformation}`,
    `Judgments and Liens Response: ${exam.audit.judgmentsAndLiens}`,
    `Easements and Restrictions Response: ${exam.audit.easementsAndRestrictions}`,
    "",
    "Pass/Fail Determination",
    `Status: ${exam.status.toUpperCase()} (${exam.criticalPassRate}% critical pass rate)`,
    `Reason: ${exam.reason}`,
    `Confirmation: ${exam.confirmation}`,
    `Manual Review Required: ${exam.manualReviewRequired ? "YES" : "NO"}`,
    "",
    "Extraction Audit Trail",
    exam.extractionSummary,
    `Rule Pack: ${exam.rulePackStatus}`,
    "",
    "Notes / Comments",
    exam.notes,
  ].join("\n");
}
