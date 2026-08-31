import { preparePdfPacket } from "./document-engine";
import { buildCanonicalTitleRecordFromExtraction } from "./canonical-title-builder";
import { initialCanonicalQc, applyCheckerResolutions } from "./canonical-qc-engine";
import { ledgerEvidenceByIds } from "./title-evidence-ledger";
import { extractPdfTitlePacket } from "./openai-title-extractor";
import { resolveSemanticChecks } from "./openai-title-checker";
import { reconcileRunSheet, reconcileTitleSummary, type RunSheetReconciliation } from "./run-sheet-reconciler";
import { createPipelineState, advancePipeline, assertCanonicalPipeline, type PipelineState } from "./pipeline";
import { recordCanonicalReview } from "./canonical-review-history";
import type { TitleReviewResult } from "./title-domain";
import type { TitleEvidenceLedger } from "./title-extraction-model";

export const CANONICAL_TITLE_ENGINE_VERSION = "cybrid-title-canonical-v3";

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
    clientName: options.clientName || "Ncala",
    requestedState: options.requestedState,
    requestedSearchType: options.requestedSearchType,
  });
  pipeline = advancePipeline(pipeline, "CLASSIFY", `Title summary detected=${record.titleSummary.detected}; distinct Run Sheet detected=${record.runSheet.detected}; instruments=${record.instruments.length}; references=${record.references.length}`);

  const titleSummaryReconciliation = reconcileTitleSummary(record);
  const runSheetReconciliation = reconcileRunSheet(record);
  pipeline = advancePipeline(pipeline, "NORMALIZE", `${record.instruments.length} instruments normalized; ${record.titleSummary.entries.length} title-summary entries; ${record.runSheet.entries.length} distinct Run Sheet entries`);

  const initialQc = initialCanonicalQc(record, titleSummaryReconciliation, runSheetReconciliation);
  const checker = await resolveSemanticChecks(record, initialQc, extracted.ledger);
  const qc = applyCheckerResolutions(initialQc, checker.resolutions, (ids) => ledgerEvidenceByIds(extracted.ledger, ids));
  pipeline = advancePipeline(pipeline, "CHECK", `${qc.checks.length} profile checks; ${checker.resolutions.length} semantic resolutions`);

  const conclusiveWithoutEvidence = qc.checks.filter((check) => (check.status === "PASS" || check.status === "FAIL") && !check.evidence.length);
  const groundedQc = conclusiveWithoutEvidence.length
    ? applyCheckerResolutions(qc, conclusiveWithoutEvidence.map((check) => ({ checkId: check.id, status: "CANNOT_CONFIRM", summary: `Cannot Confirm — conclusive result lacked grounded evidence: ${check.summary}`, evidenceIds: [] })), () => [])
    : qc;
  pipeline = advancePipeline(pipeline, "GROUND", `${groundedQc.checks.filter((check) => check.evidence.length).length}/${groundedQc.checks.length} checks carry source evidence; unsupported conclusions fail closed`);

  let review: TitleReviewResult = {
    engineVersion: CANONICAL_TITLE_ENGINE_VERSION,
    record,
    qc: groundedQc,
    pipeline: { stages: ["INGEST", "EXTRACT", "CLASSIFY", "NORMALIZE", "CHECK", "GROUND", "RENDER", "RECORD"], completedThrough: "RECORD" },
  };
  pipeline = advancePipeline(pipeline, "RENDER", "Canonical review result prepared for workbench/export adapters");

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
  pipeline = advancePipeline(pipeline, "COMPLETE", `Foreclosure readiness=${review.qc.foreclosureReadiness}`);
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
    pageCount: prepared.ledger.pageCount,
    extractionMode: extracted.ledger.extractionMode,
    evidenceNodes: extracted.ledger.evidence.length,
    titleSummaryDetected: record.titleSummary.detected,
    distinctRunSheetDetected: record.runSheet.detected,
    titleSummaryMismatches: titleSummaryReconciliation.mismatched,
    qcStatus: review.qc.qcStatus,
    foreclosureReadiness: review.qc.foreclosureReadiness,
    curativeIssues: review.qc.curativeIssues.length,
  }));

  return { review, ledger: extracted.ledger, diagnostics };
}
