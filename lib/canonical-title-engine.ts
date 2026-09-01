import { preparePdfPacket } from "./document-engine";
import { buildCanonicalTitleRecordFromExtraction } from "./canonical-title-builder";
import { initialCanonicalQc, applyCheckerResolutions } from "./canonical-qc-engine";
import { jurisdictionAnalysisForRecord, mergeJurisdictionRequirements } from "./jurisdiction-rules";
import { ledgerEvidenceByIds } from "./title-evidence-ledger";
import { extractPdfTitlePacket } from "./openai-title-extractor";
import { resolveSemanticChecks } from "./openai-title-checker";
import { reconcileRunSheet, reconcileTitleSummary, type RunSheetReconciliation } from "./run-sheet-reconciler";
import { createPipelineState, advancePipeline, assertCanonicalPipeline, type PipelineState } from "./pipeline";
import { recordCanonicalReview } from "./canonical-review-history";
import { reduceQcChecks } from "./title-qc-engine";
import type { CanonicalTitleRecord, TitleReviewResult } from "./title-domain";
import type { TitleEvidenceLedger } from "./title-extraction-model";

export const CANONICAL_TITLE_ENGINE_VERSION = "cybrid-title-canonical-v4";

export interface CanonicalReviewOptions {
  clientName?: string;
  requestedState?: string;
  requestedSearchType?: string;
}

export interface CanonicalReviewDiagnostics {
  packetHash: string;
  pageCount: number;
  nativeTextCoverage: number;
  lowTextPages: number[];
  extractionMode: string;
  extractionCacheHit: boolean;
  extractionMs: number;
  extractionModel: string;
  extractionModelMs: number;
  checkModel: string;
  checkModelMs: number;
  evidenceNodes: number;
  nativeVerifiedEvidenceNodes: number;
  titleSummaryReconciliation: RunSheetReconciliation;
  runSheetReconciliation: RunSheetReconciliation;
  pipeline: PipelineState;
}

export interface CanonicalReviewExecution {
  review: TitleReviewResult;
  ledger: TitleEvidenceLedger;
  diagnostics: CanonicalReviewDiagnostics;
}

function normalizeReportRunSheetBounds(record: CanonicalTitleRecord): void {
  if (!record.titleSummary.detected) return;
  const pages = [
    ...record.titleSummary.evidence.map((item) => item.page),
    ...record.titleSummary.entries.flatMap((entry) => entry.evidence.map((item) => item.page)),
  ].filter((page) => Number.isInteger(page) && page > 0);
  if (!pages.length) return;
  record.titleSummary.pageStart = Math.min(...pages);
  record.titleSummary.pageEnd = Math.max(...pages);
  record.titleSummary.basis = `${record.titleSummary.basis} For RCS report formats this opening title/Exceptions section is the report run sheet used for Vera Question 20; a separately labeled Abstractor/Run Sheet remains distinct.`;
}

export async function reviewTitlePdf(buffer: ArrayBuffer, sourceFile: string, options: CanonicalReviewOptions = {}): Promise<CanonicalReviewExecution> {
  let pipeline = createPipelineState();
  pipeline = advancePipeline(pipeline, "INGEST", `Accepted exact source packet ${sourceFile}`);

  const prepared = await preparePdfPacket(buffer.slice(0), sourceFile);
  const extracted = await extractPdfTitlePacket(buffer, sourceFile, prepared, {
    requestedState: options.requestedState,
    requestedSearchType: options.requestedSearchType,
  });
  pipeline = advancePipeline(pipeline, "EXTRACT", `${extracted.ledger.evidence.length} evidence nodes extracted using ${extracted.ledger.extractionMode}`);

  const record = buildCanonicalTitleRecordFromExtraction({
    extraction: extracted.extraction,
    ledger: extracted.ledger,
    clientName: options.clientName || "McCalla",
    requestedState: options.requestedState,
    requestedSearchType: options.requestedSearchType,
  });
  normalizeReportRunSheetBounds(record);
  const jurisdiction = jurisdictionAnalysisForRecord(record);
  record.foreclosureAnalysis = mergeJurisdictionRequirements(record, jurisdiction);
  pipeline = advancePipeline(pipeline, "CLASSIFY", `Title summary/report run sheet detected=${record.titleSummary.detected}; distinct Abstractor/Run Sheet detected=${record.runSheet.detected}; instruments=${record.instruments.length}; jurisdiction=${jurisdiction.coverage.status}`);

  const titleSummaryReconciliation = reconcileTitleSummary(record);
  const runSheetReconciliation = reconcileRunSheet(record);
  pipeline = advancePipeline(pipeline, "NORMALIZE", `${record.instruments.length} instruments normalized; ${record.titleSummary.entries.length} report-run-sheet entries; ${record.runSheet.entries.length} distinct Abstractor/Run Sheet entries`);

  const initialQc = initialCanonicalQc(record, titleSummaryReconciliation, runSheetReconciliation);
  const checker = await resolveSemanticChecks(record, initialQc, extracted.ledger);
  const qc = applyCheckerResolutions(initialQc, checker.resolutions, (ids) => ledgerEvidenceByIds(extracted.ledger, ids));
  pipeline = advancePipeline(pipeline, "CHECK", `${qc.checks.length} profile checks; ${checker.resolutions.length} semantic resolutions`);

  const groundedChecks = qc.checks.map((check) => {
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
  const groundedQc = reduceQcChecks(qc, groundedChecks);
  pipeline = advancePipeline(pipeline, "GROUND", `${groundedQc.checks.filter((check) => check.evidence.length).length}/${groundedQc.checks.length} checks carry source evidence; unsupported conclusions fail closed`);

  let review: TitleReviewResult = {
    engineVersion: CANONICAL_TITLE_ENGINE_VERSION,
    record,
    qc: groundedQc,
    pipeline: { stages: ["INGEST", "EXTRACT", "CLASSIFY", "NORMALIZE", "CHECK", "GROUND", "RENDER", "RECORD"], completedThrough: "RECORD" },
  };
  pipeline = advancePipeline(pipeline, "RENDER", "Canonical Vera-20 review, lien analysis, jurisdiction actions, and export result prepared");

  review = await recordCanonicalReview(review, {
    pageCount: prepared.ledger.pageCount,
    extractionMode: extracted.ledger.extractionMode,
    extractionCacheHit: prepared.cacheHit,
    textCoverage: prepared.ledger.textCoverage,
    extractionMs: prepared.extractionMs,
    extractionModelMs: extracted.modelMs,
    checkModelMs: checker.modelMs,
    extractionModel: extracted.model,
    checkModel: checker.model,
  });
  pipeline = advancePipeline(pipeline, "RECORD", `Review receipt persisted/assigned as ${review.record.reviewId}`);
  pipeline = advancePipeline(pipeline, "COMPLETE", `Review readiness=${review.qc.foreclosureReadiness}`);
  assertCanonicalPipeline(pipeline);

  const diagnostics: CanonicalReviewDiagnostics = {
    packetHash: prepared.packetHash,
    pageCount: prepared.ledger.pageCount,
    nativeTextCoverage: prepared.ledger.textCoverage,
    lowTextPages: prepared.ledger.lowTextPages,
    extractionMode: extracted.ledger.extractionMode,
    extractionCacheHit: prepared.cacheHit,
    extractionMs: prepared.extractionMs,
    extractionModel: extracted.model,
    extractionModelMs: extracted.modelMs,
    checkModel: checker.model,
    checkModelMs: checker.modelMs,
    evidenceNodes: extracted.ledger.evidence.length,
    nativeVerifiedEvidenceNodes: extracted.ledger.evidence.filter((node) => node.nativeVerified).length,
    titleSummaryReconciliation,
    runSheetReconciliation,
    pipeline,
  };

  console.info("CYBRID_TITLE_CANONICAL_REVIEW_COMPLETE", JSON.stringify({
    reviewId: review.record.reviewId,
    packetHash: prepared.packetHash,
    sourceFile,
    orderType: review.record.orderType.value,
    state: review.record.state.value,
    county: review.record.county.value,
    pageCount: prepared.ledger.pageCount,
    extractionMode: extracted.ledger.extractionMode,
    evidenceNodes: extracted.ledger.evidence.length,
    reportRunSheetDetected: record.titleSummary.detected,
    reportRunSheetPages: [record.titleSummary.pageStart, record.titleSummary.pageEnd],
    distinctRunSheetDetected: record.runSheet.detected,
    titleSummaryMismatches: titleSummaryReconciliation.mismatched,
    veraQuestionCount: review.qc.checks.filter((check) => check.legacyQuestionNumber).length,
    jurisdictionCoverage: record.foreclosureAnalysis.jurisdictionCoverage?.status,
    qcStatus: review.qc.qcStatus,
    reviewReadiness: review.qc.foreclosureReadiness,
    curativeIssues: review.qc.curativeIssues.length,
  }));

  return { review, ledger: extracted.ledger, diagnostics };
}
