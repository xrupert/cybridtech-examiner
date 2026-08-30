import { get, put } from "@vercel/blob";
import type { QcStatus } from "./title-domain";

export type ExaminerDecision = "CONFIRM" | "CORRECT" | "NEEDS_EVIDENCE";

export interface ReviewDecisionRecord {
  reviewId: string;
  checkId: string;
  decision: ExaminerDecision;
  correctedStatus?: QcStatus;
  correctedValue?: string;
  reason: string;
  actor: string;
  decidedAt: string;
}

export interface ReviewDecisionManifest {
  version: 1;
  reviewId: string;
  decisions: ReviewDecisionRecord[];
  updatedAt: string;
}

const PREFIX = "cybrid-title/review-decisions-v1";

function path(reviewId: string): string {
  return `${PREFIX}/${encodeURIComponent(reviewId)}.json`;
}

export async function loadReviewDecisions(reviewId: string): Promise<ReviewDecisionManifest> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { version: 1, reviewId, decisions: [], updatedAt: new Date(0).toISOString() };
  try {
    const result = await get(path(reviewId), { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) return { version: 1, reviewId, decisions: [], updatedAt: new Date(0).toISOString() };
    const parsed = await new Response(result.stream).json() as ReviewDecisionManifest;
    if (parsed?.version !== 1 || parsed.reviewId !== reviewId || !Array.isArray(parsed.decisions)) throw new Error("Invalid review decision manifest.");
    return parsed;
  } catch {
    return { version: 1, reviewId, decisions: [], updatedAt: new Date(0).toISOString() };
  }
}

export async function saveReviewDecision(input: Omit<ReviewDecisionRecord, "decidedAt">): Promise<ReviewDecisionManifest> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Persistent review decisions require the private Cybrid Title Blob store.");
  if (!input.reviewId.trim() || !input.checkId.trim()) throw new Error("reviewId and checkId are required.");
  if (input.decision === "CORRECT" && !input.correctedStatus) throw new Error("A corrected status is required when correcting a finding.");
  if (!input.reason.trim()) throw new Error("A decision reason is required.");

  const current = await loadReviewDecisions(input.reviewId);
  const decision: ReviewDecisionRecord = { ...input, decidedAt: new Date().toISOString() };
  const decisions = [...current.decisions.filter((item) => item.checkId !== input.checkId), decision];
  const manifest: ReviewDecisionManifest = { version: 1, reviewId: input.reviewId, decisions, updatedAt: decision.decidedAt };
  await put(path(input.reviewId), JSON.stringify(manifest), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
  });
  return manifest;
}
