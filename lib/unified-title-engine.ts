import { preparePdfPacket, type PacketExtractionLedger } from "./document-engine";
import { preservePartialPacketEvidence } from "./partial-packet";
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
import { applyDocumentIntegrityGuard, summarizeDocumentIntegrity, type DocumentIntegritySummary } from "./document-integrity";
import { saveReviewDossier } from "./review-dossier";
import type { CanonicalTitleRecord, TitleReviewResult } from "./title-domain";
import type { TitleEvidenceLedger } from "./title-extraction-model";

export const UNIFIED_TITLE_ENGINE_VERSION = "cybrid-title-vera-unified-v1";

export interface UnifiedReviewOptions {
  clientName?: string;
  requestedState?: string;
  requestedSearchType?: string;
}

export interface UnifiedReviewDiagnostics {
  packetHash: string;
  pageCount: number;
  nativeTextCoverage: number;
  textCoverage: number;
  initialLowTextPages: number[];
  lowTextPages: number[];
  ocrRecoveredPages: number[];
  ocrSkippedPages: number[];
  blankPages: number[];
  ocrProvidersUsed: string[];
  extractionMode: string;
  extractionCacheHit: boolean;
  extractionMs: number;
  extractionModel: string;
  extractionModelMs: number;
  checkModel: string;
  checkModelMs: number;
  evidenceNodes: number;
  nativeVerifiedEvidenceNodes: number;
  textVerifiedEvidenceNodes: number;
  titleSummaryReconciliation: RunSheetReconciliation;
  runSheetReconciliation: RunSheetReconciliation;
  documentIntegrity: DocumentIntegritySummary;
  dossierPersisted: boolean;
  pipeline: PipelineState;
}

export interface UnifiedReviewExecution {
  review: TitleReviewResult;
  ledger: TitleEvidenceLedger;
  pageLedger: PacketExtractionLedger;
  diagnostics: UnifiedReviewDiagnostics;
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

export async function reviewTitlePdfUnified(buffer: ArrayBuffer, sourceFile: string, options: UnifiedReviewOptions = {}): Promise<UnifiedReviewExecution> {
  let pipeline = createPipelineState();
  pipeline = advancePipeline(pipeline, "INGEST", `Accepted exact source packet ${sourceFile}`);

  // Critical reliability rule: if the PDF opens, keep every physical page represented.
  // A single unresolved scan never forces otherwise-readable pages into an all-or-nothing path.
  const prepared = preservePartialPacketEvidence(await preparePdfPacket(buffer.slice(0), sourceFile));
  const documentIntegrity = summarizeDocumentIntegrity(prepared.ledger);

  const extracted = await extractPdfTitlePacket(buffer, sourceFile, prepared, {
    requestedState: options.requestedState,
    requestedSearchType: options.requestedSearchType,
  });
  pipeline = advancePipeline(pipeline, "EXTRACT", `${extracted.ledger.evidence.length} evidence nodes extracted using ${extracted.ledger.extractionMode}; document integrity=${documentIntegrity.state}`);

  const record = buildCanonicalTitleRecordFromExtraction({
    extraction: extracted.extraction,
    ledger: extracted.ledger,
    clientName: options.clientName || "Client",
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
        recommendedAction: check.recommendedAction === "No curative action required for this check."
          ? "Review the source evidence required to support this check."
          : check.recommendedAction,
      };
    }
    return check;
  });
  const groundedQc = reduceQcChecks(qc, groundedChecks);
  pipeline = advancePipeline(pipeline, "GROUND", `${groundedQc.checks.filter((check) => check.evidence.length).length}/${groundedQc.checks.length} checks carry source evidence; unsupported conclusions fail closed`);

  let review: TitleReviewResult = {
    engineVersion: UNIFIED_TITLE_ENGINE_VERSION,
    record,
    qc: groundedQc,
    pipeline: { stages: ["INGEST", "EXTRACT", "CLASSIFY", "NORMALIZE", "CHECK", "GROUND", "RENDER", "RECORD"], completedThrough: "RECORD" },
  };

  // Unreadability is a document-integrity problem, not a title defect.  Keep any
  // independently proven FAIL, but otherwise route the packet to examiner review.
  review = applyDocumentIntegrityGuard(review, prepared.ledger);
  pipeline = advancePipeline(pipeline, "RENDER", "Canonical Vera-20 review, document-integrity guard, lien analysis, jurisdiction actions, and export result prepared");

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

  let dossierPersisted = false;
  try {
    await saveReviewDossier({ review, evidenceLedger: extracted.ledger, pageLedger: prepared.ledger });
    dossierPersisted = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  } catch (error) {
    console.warn("CYBRID_TITLE_DOSSIER_WRITE_FAILED", JSON.stringify({
      reviewId: review.record.reviewId,
      message: error instanceof Error ? error.message : "unknown",
    }));
  }

  pipeline = advancePipeline(pipeline, "RECORD", `Review receipt assigned as ${review.record.reviewId}; evidence dossier persisted=${dossierPersisted}`);
  pipeline = advancePipeline(pipeline, "COMPLETE", `Review readiness=${review.qc.foreclosureReadiness}; integrity=${documentIntegrity.state}`);
  assertCanonicalPipeline(pipeline);

  const diagnostics: UnifiedReviewDiagnostics = {
    packetHash: prepared.packetHash,
    pageCount: prepared.ledger.pageCount,
    nativeTextCoverage: prepared.ledger.nativeTextCoverage,
    textCoverage: prepared.ledger.textCoverage,
    initialLowTextPages: prepared.ledger.initialLowTextPages,
    lowTextPages: prepared.ledger.lowTextPages,
    ocrRecoveredPages: prepared.ledger.ocrRecoveredPages,
    ocrSkippedPages: prepared.ledger.ocrSkippedPages,
    blankPages: prepared.ledger.blankPages,
    ocrProvidersUsed: prepared.ledger.ocrProvidersUsed,
    extractionMode: extracted.ledger.extractionMode,
    extractionCacheHit: prepared.cacheHit,
    extractionMs: prepared.extractionMs,
    extractionModel: extracted.model,
    extractionModelMs: extracted.modelMs,
    checkModel: checker.model,
    checkModelMs: checker.modelMs,
    evidenceNodes: extracted.ledger.evidence.length,
    nativeVerifiedEvidenceNodes: extracted.ledger.evidence.filter((node) => node.nativeVerified).length,
    textVerifiedEvidenceNodes: extracted.ledger.evidence.filter((node) => node.textVerified).length,
    titleSummaryReconciliation,
    runSheetReconciliation,
    documentIntegrity,
    dossierPersisted,
    pipeline,
  };

  console.info("CYBRID_TITLE_UNIFIED_REVIEW_COMPLETE", JSON.stringify({
    reviewId: review.record.reviewId,
    packetHash: prepared.packetHash,
    sourceFile,
    pageCount: prepared.ledger.pageCount,
    extractionMode: extracted.ledger.extractionMode,
    integrity: documentIntegrity.state,
    unresolvedPages: documentIntegrity.unresolvedPages,
    ocrRecoveredPages: prepared.ledger.ocrRecoveredPages,
    evidenceNodes: extracted.ledger.evidence.length,
    qcStatus: review.qc.qcStatus,
    reviewReadiness: review.qc.foreclosureReadiness,
    dossierPersisted,
  }));

  return { review, ledger: extracted.ledger, pageLedger: prepared.ledger, diagnostics };
}
