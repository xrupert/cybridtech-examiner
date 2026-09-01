"use client";

import type { QcCheckResult, TitleReviewResult } from "@/lib/title-domain";
import { buildVeraAccuracyAudit, veraPassFailReason } from "@/lib/vera-accuracy-audit";
import { ReviewDecisionControls, type ExaminerDecision, type SavedDecision } from "./ReviewDecisionControls";
import styles from "./ProfessionalReviewReport.module.css";

const QUESTION_TITLES: Record<number, string> = {
  1: "Is there an HOA or not applicable?",
  2: "Are there Covenants, Conditions, and Restrictions attached or Not Applicable?",
  3: "Is the HOA name and amounts listed or Not Applicable?",
  4: "Are the Deed/Mortgage amounts and names accurate?",
  5: "Are all document recordings available and match the report?",
  6: "Are recordings in chronological order?",
  7: "Is assignment vesting accurate or Not Applicable?",
  8: "Is the legal description confirmed and exact across vesting deed, DOT, and Title Report?",
  9: "Is the original beneficiary MERS and is it on beneficiary's line of Deed of Trust or Not Applicable?",
  10: "Is there a Federal Tax Lien or Not Applicable?",
  11: "Are there any document releases that are showing on the report?",
  12: "Is the property secured and does the Property Address match the Deed of Trust?",
  13: "What is the Loan Document type?",
  14: "What is the Recording Date?",
  15: "What is the Loan status, including the notes?",
  16: "Recourse?",
  17: "Are there any typos or errors in the report?",
  18: "Is the plat map labeled?",
  19: "Is the MIN# in the run sheet?",
  20: "Is the Run Sheet accurate?",
};

function clean(value?: string): string {
  if (!value || /^(?:needs review|unknown|not stated)$/i.test(value.trim())) return "Not Provided";
  return value;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function party(instrument: TitleReviewResult["record"]["instruments"][number], pattern: RegExp): string {
  return instrument.parties.filter((item) => pattern.test(item.role)).map((item) => item.name).join(" and ") || "Not Provided";
}

function controllingMortgage(review: TitleReviewResult) {
  const selected = review.record.targetLien.instrumentId
    ? review.record.mortgages.find((item) => item.id === review.record.targetLien.instrumentId)
    : undefined;
  return selected || (review.record.mortgages.length === 1 ? review.record.mortgages[0] : undefined);
}

function responseLead(check: QcCheckResult): string {
  if (check.status === "NOT_APPLICABLE") return "Not Applicable.";
  if (check.status === "PASS") return "Yes.";
  if (check.status === "FAIL") return "No.";
  return "Cannot Confirm.";
}

function questionResponse(review: TitleReviewResult, check: QcCheckResult): { lead?: string; text: string; details?: string[] } {
  const record = review.record;
  const mortgage = controllingMortgage(review);
  const number = check.legacyQuestionNumber || 0;
  switch (number) {
    case 1:
      return { text: record.flags.hoa.state === "CONFIRMED" ? clean(record.flags.hoa.value) : check.summary };
    case 2:
      return { text: record.flags.ccrs.state === "CONFIRMED" ? clean(record.flags.ccrs.value) : check.summary };
    case 3:
      return { text: check.summary };
    case 4: {
      const deedDetails = record.deeds.map((deed) => `Deed: ${party(deed, /grantor|seller/i)} → ${party(deed, /grantee|buyer|owner/i)}; dated ${clean(deed.documentDate)}; recorded ${clean(deed.recordingDate)}; Instrument #${clean(deed.instrumentNumber)}${deed.amount && deed.amount !== "Needs review" ? `; amount/consideration ${deed.amount}` : ""}.`);
      const mortgageDetails = record.mortgages.map((item, index) => `Mortgage ${index + 1} / ${clean(item.type)}: ${clean(item.amount)}; Borrower(s) ${party(item, /borrower|mortgagor|grantor/i)}; Beneficiary/Lender ${party(item, /beneficiary|lender|mortgagee/i)}; dated ${clean(item.documentDate)}; recorded ${clean(item.recordingDate)}; Instrument #${clean(item.instrumentNumber)}${record.flags.min.state === "CONFIRMED" ? `; MIN ${record.flags.min.value}` : ""}.`);
      return { lead: responseLead(check), text: check.summary, details: [...deedDetails, ...mortgageDetails] };
    }
    case 5:
    case 6:
    case 7:
    case 8:
    case 12:
    case 20:
      return { lead: responseLead(check), text: check.summary };
    case 9:
      return { lead: responseLead(check), text: record.flags.mers.state === "CONFIRMED" ? `${clean(record.flags.mers.value)}${record.flags.min.state === "CONFIRMED" ? ` MIN #${record.flags.min.value}.` : ""}` : check.summary };
    case 10:
      return { text: record.flags.federalTaxLien.state === "CONFIRMED" ? clean(record.flags.federalTaxLien.value) : check.summary };
    case 11:
      return { text: record.releases.length ? `${record.releases.length} release/satisfaction document(s) are normalized: ${record.releases.map((item) => `${clean(item.type)} ${clean(item.instrumentNumber)}`).join("; ")}. ${check.summary}` : check.summary };
    case 13:
      return { text: mortgage ? clean(mortgage.type) : check.summary };
    case 14:
      return { text: mortgage ? clean(mortgage.recordingDate) : check.summary };
    case 15:
      return { text: mortgage ? `${clean(mortgage.status)}. ${check.summary}` : check.summary };
    case 16:
      return { text: check.summary };
    case 17: {
      const related = review.qc.checks.filter((item) => item.status === "FAIL" || item.status === "CANNOT_CONFIRM");
      const issues = unique([
        ...record.dataQualityWarnings,
        ...related.map((item) => item.summary),
      ]);
      return { lead: issues.length ? "Yes. Major issues identified:" : responseLead(check), text: issues.length ? "" : check.summary, details: issues };
    }
    case 18:
      return { lead: responseLead(check), text: record.flags.plat.state === "CONFIRMED" ? clean(record.flags.plat.value) : check.summary };
    case 19:
      return { lead: responseLead(check), text: record.flags.min.state === "CONFIRMED" ? `MIN #${record.flags.min.value} is identified in the packet/report evidence.` : check.summary };
    default:
      return { lead: responseLead(check), text: check.summary };
  }
}

function taxDiscrepancies(review: TitleReviewResult): string[] {
  const audit = buildVeraAccuracyAudit(review.record, review.qc).find((area) => area.key === "TAX");
  const warnings = review.record.dataQualityWarnings.filter((value) => /tax|parcel|assess|fiscal|cad|isd|mud/i.test(value));
  if (audit && ["DISCREPANCIES", "INCOMPLETE"].includes(audit.status)) warnings.push(audit.summary);
  return unique(warnings);
}

function materialReason(review: TitleReviewResult): string {
  const material = unique(review.qc.checks
    .filter((check) => check.status === "FAIL" || check.status === "CANNOT_CONFIRM")
    .map((check) => check.summary));
  if (material.length) return material.join(" ");
  return veraPassFailReason(review.qc).reason;
}

export function ProfessionalReviewReport({
  review,
  fileName,
  reviewComplete,
  reviewedCount,
  currentDecision,
  onSaved,
  onOpenSource,
  onConfirmAllClean,
}: {
  review: TitleReviewResult;
  fileName: string;
  reviewComplete: boolean;
  reviewedCount: number;
  currentDecision: (checkId: string) => ExaminerDecision | undefined;
  onSaved: (check: QcCheckResult, saved: SavedDecision) => void;
  onOpenSource: (page: number) => void;
  onConfirmAllClean: () => void;
}) {
  const record = review.record;
  const veraChecks = [...review.qc.checks.filter((check) => check.legacyQuestionNumber)].sort((a, b) => (a.legacyQuestionNumber || 0) - (b.legacyQuestionNumber || 0));
  const audit = buildVeraAccuracyAudit(record, review.qc);
  const passFail = veraPassFailReason(review.qc);
  const taxIssues = taxDiscrepancies(review);
  const foreclosureActions = record.foreclosureAnalysis.requirements
    .filter((item) => item.severity !== "INFO")
    .map((item) => item.action);

  return <article className={styles.report}>
    <div className={styles.reportTopline}>
      <div><span className={styles.kicker}>Examiner Review</span><h1>Title Report Review Summary</h1></div>
      <div className={styles.screenOnly}><span className={reviewComplete ? styles.complete : styles.pending}>{reviewComplete ? "REVIEW COMPLETE" : `${reviewedCount}/20 REVIEWED`}</span></div>
    </div>

    <section className={styles.summarySection}>
      <p><strong>Search Type:</strong> {clean(record.orderType.value)}</p>
      <p><strong>Client Order#:</strong> {clean(record.orderNumber.value !== "Needs review" ? record.orderNumber.value : record.tsNumber.value)}</p>
      <p><strong>Property Address:</strong> {clean(record.propertyAddress.value)}</p>
      <p><strong>Search Effective Date:</strong> {clean(record.effectiveDate.value)}</p>
      <p><strong>MIN#:</strong> {record.flags.min.state === "CONFIRMED" ? clean(record.flags.min.value) : "Not Provided"}</p>
    </section>

    <section className={styles.section}>
      <h2>Property &amp; Tax Information</h2>
      <p><strong>Parcel ID:</strong> {clean(record.parcelId.value)}</p>
      <p><strong>Land Value:</strong> {clean(record.taxes.landValue.value)}</p>
      <p><strong>Improvements:</strong> {clean(record.taxes.improvements.value)}</p>
      <p><strong>Tax Status:</strong> {clean(record.taxes.status.value)}</p>
      <p><strong>Fiscal Year:</strong> {clean(record.taxes.fiscalYear.value)}</p>
      <p><strong>Mobile Home:</strong> Not Provided</p>
      <p><strong>Condo/HOA:</strong> {record.flags.hoa.state === "CONFIRMED" ? clean(record.flags.hoa.value) : "Not Provided"}</p>
      {taxIssues.length ? <div className={styles.discrepancy}><strong>Important tax discrepancy:</strong>{taxIssues.map((issue, index) => <p key={`${index}-${issue}`}>{issue}</p>)}</div> : null}
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHeadingRow}>
        <h2>Required Question Responses</h2>
        <button className={`${styles.screenOnly} ${styles.confirmAll}`} onClick={onConfirmAllClean}>Confirm all clean</button>
      </div>
      {veraChecks.map((check) => {
        const number = check.legacyQuestionNumber || 0;
        const response = questionResponse(review, check);
        return <div className={styles.question} key={check.id}>
          <div className={styles.questionTitleRow}>
            <h3>{number}. {QUESTION_TITLES[number] || check.label}</h3>
            <span className={`${styles.screenOnly} ${check.status === "PASS" || check.status === "NOT_APPLICABLE" ? styles.statusPass : check.status === "FAIL" ? styles.statusFail : styles.statusReview}`}>{check.status.replaceAll("_", " ")}</span>
          </div>
          <p className={styles.response}><strong>Response:</strong> {response.lead ? <><strong>{response.lead}</strong>{response.text ? ` ${response.text}` : ""}</> : response.text}</p>
          {response.details?.length ? <ol className={styles.detailList}>{response.details.map((detail, index) => <li key={`${check.id}-${index}`}>{detail}</li>)}</ol> : null}
          {check.status !== "PASS" && check.status !== "NOT_APPLICABLE" && check.recommendedAction ? <p className={styles.action}><strong>Required Action:</strong> {check.recommendedAction}</p> : null}
          <details className={`${styles.examinerTools} ${styles.screenOnly}`}>
            <summary>Evidence &amp; examiner decision</summary>
            <div className={styles.evidenceList}>
              {check.evidence.length ? check.evidence.slice(0, 4).map((evidence, index) => <div className={styles.evidence} key={`${check.id}-${evidence.page}-${index}`}><p><strong>Page {evidence.page} · {evidence.documentType}</strong><br />“{evidence.quote}”</p><button onClick={() => onOpenSource(evidence.page)}>Open source page {evidence.page}</button></div>) : <div className={styles.evidence}><p>No grounded source quote is attached to this conclusion. Independently verify it before confirming.</p></div>}
            </div>
            <ReviewDecisionControls reviewId={record.reviewId} check={check} currentDecision={currentDecision(check.id)} onSaved={(saved) => onSaved(check, saved)} />
          </details>
        </div>;
      })}
    </section>

    <section className={styles.section}>
      <h2>Title Report / Run Sheet Accuracy Audit</h2>
      {audit.map((area) => <p className={styles.auditLine} key={area.key}><strong>{area.label}:</strong> <strong>{area.status}</strong> — {area.summary}</p>)}
    </section>

    <section className={styles.section}>
      <h2>Pass/Fail Determination</h2>
      <p><strong>Status: {passFail.status.toUpperCase()}</strong></p>
      <p><strong>Reason:</strong> {materialReason(review)}</p>
      <p><strong>Confirmation:</strong> {passFail.confirmation}</p>
      {foreclosureActions.length ? <p><strong>Required cure / next action:</strong> {unique(foreclosureActions).join(" ")}</p> : null}
      {!reviewComplete ? <p className={styles.provisional}><strong>Review Status:</strong> Examiner dispositions are incomplete; this determination remains provisional and the professional review document remains blocked from final release.</p> : null}
    </section>

    <footer className={styles.footer}>
      <span>Source: {fileName}</span><span>Review ID: {record.reviewId}</span>
    </footer>
  </article>;
}
