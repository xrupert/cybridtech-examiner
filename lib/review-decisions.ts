import { database, databaseConfigured } from "./database";
import { clientInstanceConfig } from "./client-instance";
import { clientBlobPrefix } from "./client-instance";
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



function path(reviewId: string): string {
  return `${clientBlobPrefix("review-decisions-v1")}/${encodeURIComponent(reviewId)}.json`;
}

export async function loadReviewDecisions(reviewId: string): Promise<ReviewDecisionManifest> {
  if (databaseConfigured()) {
    const result = await database().query("SELECT DISTINCT ON(check_id) decision FROM vera_decision_events WHERE client_id=$1 AND review_id=$2 ORDER BY check_id,sequence DESC", [clientInstanceConfig().clientId, reviewId]);
    const decisions = result.rows.map((row) => row.decision as ReviewDecisionRecord);
    return { version: 1, reviewId, decisions, updatedAt: decisions.map((d) => d.decidedAt).sort().at(-1) || new Date(0).toISOString() };
  }
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
  if (!["CONFIRM", "CORRECT", "NEEDS_EVIDENCE"].includes(input.decision)) throw new Error("Invalid examiner decision.");
  if (input.correctedStatus !== undefined && !["PASS", "FAIL", "CANNOT_CONFIRM", "NOT_APPLICABLE"].includes(input.correctedStatus)) throw new Error("Invalid corrected status.");
  if (!input.reviewId.trim() || !input.checkId.trim()) throw new Error("reviewId and checkId are required.");
  if (input.decision === "CORRECT" && !input.correctedStatus) throw new Error("A corrected status is required when correcting a finding.");
  if (!input.reason.trim()) throw new Error("A decision reason is required.");

  if (databaseConfigured()) {
    const decision = { ...input, decidedAt: new Date().toISOString() };
    await database().query("INSERT INTO vera_decision_events(client_id,review_id,check_id,decision) VALUES($1,$2,$3,$4)", [clientInstanceConfig().clientId, input.reviewId, input.checkId, decision]);
    return loadReviewDecisions(input.reviewId);
  }
  if (process.env.VERA_COMPLIANCE_MODE === "1") throw new Error("Durable decision storage is required.");
  const current = await loadReviewDecisions(input.reviewId);
  const decision: ReviewDecisionRecord = { ...input, decidedAt: new Date().toISOString() };
  const decisions = [...current.decisions.filter((item) => item.checkId !== input.checkId), decision];
  const manifest: ReviewDecisionManifest = { version: 1, reviewId: input.reviewId, decisions, updatedAt: decision.decidedAt };
  await put(path(input.reviewId), JSON.stringify(manifest), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
  return manifest;
}
