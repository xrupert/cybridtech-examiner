import { createHash, randomUUID } from "node:crypto";
import { list, put } from "@vercel/blob";
import { AUDIT_RULE_VERSION } from "./audit-rules";
import type { VeraExam } from "./vera";

const RECEIPT_PREFIX = "cybrid-title/review-receipts";
const INDEX_PREFIX = "cybrid-title/review-index";

export interface ReviewReceipt {
  version: 1;
  reviewId: string;
  matterKey: string;
  matterRevision: number;
  identityKeys: string[];
  packetHash: string;
  sourceFile: string;
  clientOrder: string;
  propertyAddress: string;
  parcelId: string;
  state: string;
  county: string;
  searchType: string;
  searchEffectiveDate: string;
  status: "Pass" | "Fail";
  pageCount: number;
  ruleVersion: string;
  model: string;
  extractionMode: string;
  extractionCacheHit: boolean;
  textCoverage: number;
  extractionMs: number;
  modelMs: number;
  createdAt: string;
}

function normalizeIdentity(value: string): string {
  return value
    .toUpperCase()
    .replace(/\b(AKA|A\/K\/A)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function usable(value: string): boolean {
  const normalized = normalizeIdentity(value || "");
  return Boolean(normalized && !["NOT PROVIDED", "NOT STATED", "CANNOT CONFIRM", "NA", "N A"].includes(normalized));
}

function opaqueKey(kind: string, value: string): string {
  return `${kind}-${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

export function matterIdentityKeys(exam: VeraExam): string[] {
  const keys: string[] = [];
  if (usable(exam.clientOrder)) keys.push(opaqueKey("order", normalizeIdentity(exam.clientOrder)));
  if (usable(exam.parcelId)) keys.push(opaqueKey("parcel", [normalizeIdentity(exam.state), normalizeIdentity(exam.county), normalizeIdentity(exam.parcelId)].join("|")));
  if (usable(exam.propertyAddress)) keys.push(opaqueKey("address", [normalizeIdentity(exam.state), normalizeIdentity(exam.propertyAddress)].join("|")));
  if (!keys.length && exam.packetHash) keys.push(opaqueKey("packet", exam.packetHash));
  return [...new Set(keys)];
}

async function indexedReviewIds(identityKey: string): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!process.env.BLOB_READ_WRITE_TOKEN) return ids;
  let cursor: string | undefined;
  do {
    const result = await list({ prefix: `${INDEX_PREFIX}/${identityKey}/`, cursor, limit: 1000 });
    for (const blob of result.blobs) {
      const filename = blob.pathname.split("/").pop() || "";
      const reviewId = filename.replace(/\.json$/i, "");
      if (reviewId) ids.add(reviewId);
    }
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);
  return ids;
}

export async function recordCompletedReview(exam: VeraExam, model: string): Promise<VeraExam> {
  const reviewId = randomUUID();
  const identityKeys = matterIdentityKeys(exam);
  const matterKey = identityKeys.find((key) => key.startsWith("parcel-"))
    || identityKeys.find((key) => key.startsWith("address-"))
    || identityKeys.find((key) => key.startsWith("order-"))
    || identityKeys[0]
    || opaqueKey("review", reviewId);

  const previousIds = new Set<string>();
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    for (const identityKey of identityKeys) {
      const ids = await indexedReviewIds(identityKey);
      for (const id of ids) previousIds.add(id);
    }
  }
  const matterRevision = previousIds.size + 1;
  const updated: VeraExam = { ...exam, reviewId, matterKey, matterRevision, matterIdentityKeys: identityKeys };

  if (!process.env.BLOB_READ_WRITE_TOKEN) return updated;

  const receipt: ReviewReceipt = {
    version: 1,
    reviewId,
    matterKey,
    matterRevision,
    identityKeys,
    packetHash: exam.packetHash,
    sourceFile: exam.sourceFile,
    clientOrder: exam.clientOrder,
    propertyAddress: exam.propertyAddress,
    parcelId: exam.parcelId,
    state: exam.state,
    county: exam.county,
    searchType: exam.searchType,
    searchEffectiveDate: exam.searchEffectiveDate,
    status: exam.status,
    pageCount: exam.packetPageCount,
    ruleVersion: AUDIT_RULE_VERSION,
    model,
    extractionMode: exam.documentEngine.extractionMode,
    extractionCacheHit: exam.documentEngine.extractionCacheHit,
    textCoverage: exam.documentEngine.textCoverage,
    extractionMs: exam.documentEngine.extractionMs,
    modelMs: exam.documentEngine.modelMs,
    createdAt: new Date().toISOString(),
  };

  try {
    await put(`${RECEIPT_PREFIX}/${reviewId}.json`, JSON.stringify(receipt), {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json",
    });
    await Promise.all(identityKeys.map((identityKey) => put(`${INDEX_PREFIX}/${identityKey}/${reviewId}.json`, JSON.stringify({ reviewId, matterKey, packetHash: exam.packetHash }), {
      access: "private",
      addRandomSuffix: false,
      contentType: "application/json",
    })));
  } catch (error) {
    console.warn("CYBRID_TITLE_REVIEW_RECEIPT_WRITE_FAILED", JSON.stringify({ reviewId, message: error instanceof Error ? error.message : "unknown" }));
  }

  console.info("CYBRID_TITLE_REVIEW_RECEIPT", JSON.stringify({
    reviewId,
    matterKey,
    matterRevision,
    relatedPreviousReviews: previousIds.size,
    packetHash: exam.packetHash,
    pageCount: exam.packetPageCount,
    extractionMode: exam.documentEngine.extractionMode,
    cacheHit: exam.documentEngine.extractionCacheHit,
  }));
  return updated;
}
