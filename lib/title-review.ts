import { normalizeTitleRecord } from "./title-normalizer";
import { runQcProfile } from "./title-qc-engine";
import type { TitleReviewResult } from "./title-domain";
import type { VeraExam } from "./vera";

export const TITLE_REVIEW_ENGINE_VERSION = "cybrid-title-canonical-v1";

export function buildTitleReviewResult(exam: VeraExam, clientName = "Ncala"): TitleReviewResult {
  const record = normalizeTitleRecord(exam, clientName);
  const qc = runQcProfile(record, exam);
  return {
    engineVersion: TITLE_REVIEW_ENGINE_VERSION,
    record,
    qc,
    pipeline: {
      stages: ["INGEST", "EXTRACT", "CLASSIFY", "NORMALIZE", "CHECK", "GROUND", "RENDER", "RECORD"],
      completedThrough: "RECORD",
    },
  };
}
