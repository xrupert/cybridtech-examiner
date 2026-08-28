import { VeraExam } from "./vera";

function evidenceText(quote: string, page: number, documentType: string, source: string): string {
  return `[Evidence: '${quote}' Page ${page}; ${documentType}; ${source}]`;
}

function evidenceLines(exam: VeraExam, number: number): string[] {
  const finding = exam.findings.find((item) => item.number === number);
  if (!finding) return [];
  const lines = finding.evidence.length
    ? finding.evidence.map((ev) => evidenceText(ev.quote, ev.page, ev.documentType, ev.source))
    : ["[Evidence: Not Stated]"];
  if (finding.critical) lines.push(
    `[Status: ${finding.status === "PASS" || finding.status === "NOT_APPLICABLE" ? "PASS" : "FAIL"}]`,
    `[Proof/Reason: '${finding.proofReason}']`,
  );
  return lines;
}

export function examToPlain(exam: VeraExam): string {
  const summaryEvidence = exam.summaryEvidence.flatMap((field) => [
    `${field.field}: ${field.value}`,
    ...(field.evidence.length ? field.evidence.map((ev) => evidenceText(ev.quote, ev.page, ev.documentType, ev.source)) : ["[Evidence: Not Stated]"]),
    `[Proof/Reason: '${field.proofReason}']`,
    "",
  ]);

  const questionLines = exam.findings.flatMap((finding) => [
    `${finding.number}. ${finding.question}`,
    `Response: ${finding.response}`,
    ...evidenceLines(exam, finding.number),
    finding.commentary ? `Optional Commentary: ${finding.commentary}` : "",
    "",
  ]).filter(Boolean);

  const documentLines = exam.documents.flatMap((doc) => [
    `${doc.documentType} — Pages ${doc.pageStart}${doc.pageEnd !== doc.pageStart ? `-${doc.pageEnd}` : ""}${doc.instrumentNumber ? ` — Instrument ${doc.instrumentNumber}` : ""}`,
    doc.recordingDate ? `Recording Date: ${doc.recordingDate}` : "",
    doc.excerpt,
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
    "Property, Tax & Header Evidence",
    ...summaryEvidence,
    "Required Questions (1–20)",
    ...questionLines,
    "Packet Document Inventory",
    ...documentLines,
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
