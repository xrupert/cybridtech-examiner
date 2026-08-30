import { createHash, randomUUID } from "node:crypto";
import { list, put } from "@vercel/blob";
import { AUDIT_RULE_VERSION } from "./audit-rules";
import type { TitleReviewResult } from "./title-domain";

const RECEIPT_PREFIX = "cybrid-title/review-receipts";
const INDEX_PREFIX = "cybrid-title/canonical-review-index-v1";

export interface CanonicalReviewTelemetry {
  pageCount: number;
  extractionMode: string;
  extractionCacheHit: boolean;
  textCoverage: number;
  extractionMs: number;
  extractionModelMs: number;
  checkModelMs: number;
  extractionModel: string;
  checkModel: string;
}

function normalize(value: string): string {
  return String(value || "").toUpperCase().replace(/\b(AKA|A\/K\/A)\b/g, " ").replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function usable(value: string): boolean {
  const v = normalize(value);
  return Boolean(v && !["NEEDS REVIEW", "NOT PROVIDED", "NOT STATED", "CANNOT CONFIRM", "NA", "N A"].includes(v));
}

function opaqueKey(kind: string, value: string): string {
  return `${kind}-${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

function clientScope(clientName: string): string {
  return opaqueKey("client", normalize(clientName) || "UNSCOPED");
}

export function canonicalMatterIdentityKeys(review: TitleReviewResult): string[] {
  const record = review.record;
  const scope = clientScope(record.clientName);
  const keys: string[] = [];
  if (usable(record.orderNumber.value)) keys.push(opaqueKey("order", `${scope}|${normalize(record.orderNumber.value)}`));
  if (usable(record.parcelId.value)) keys.push(opaqueKey("parcel", `${scope}|${normalize(record.state.value)}|${normalize(record.county.value)}|${normalize(record.parcelId.value)}`));
  if (usable(record.propertyAddress.value)) keys.push(opaqueKey("address", `${scope}|${normalize(record.state.value)}|${normalize(record.propertyAddress.value)}`));
  if (!keys.length && record.packetHash) keys.push(opaqueKey("packet", `${scope}|${record.packetHash}`));
  return [...new Set(keys)];
}

async function indexedReviewIds(identityKey: string): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!process.env.BLOB_READ_WRITE_TOKEN) return ids;
  let cursor: string | undefined;
  do {
    const result = await list({ prefix: `${INDEX_PREFIX}/${identityKey}/`, cursor, limit: 1000 });
    result.blobs.forEach((blob) => {
      const reviewId = (blob.pathname.split("/").pop() || "").replace(/\.json$/i, "");
      if (reviewId) ids.add(reviewId);
    });
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);
  return ids;
}

export async function recordCanonicalReview(review: TitleReviewResult, telemetry: CanonicalReviewTelemetry): Promise<TitleReviewResult> {
  const reviewId = randomUUID();
  const withId: TitleReviewResult = { ...review, record: { ...review.record, reviewId, recordId: reviewId } };
  const identityKeys = canonicalMatterIdentityKeys(withId);
  const previousIds = new Set<string>();
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    for (const identityKey of identityKeys) {
      const ids = await indexedReviewIds(identityKey);
      ids.forEach((id) => previousIds.add(id));
    }
  }
  const matterRevision = previousIds.size + 1;
  const updated: TitleReviewResult = { ...withId, record: { ...withId.record, matterRevision } };
  if (!process.env.BLOB_READ_WRITE_TOKEN) return updated;

  const matterKey = identityKeys.find((key) => key.startsWith("parcel-")) || identityKeys.find((key) => key.startsWith("address-")) || identityKeys.find((key) => key.startsWith("order-")) || identityKeys[0] || opaqueKey("review", reviewId);
  const record = updated.record;
  const receipt = {
    version: 2,
    engineVersion: updated.engineVersion,
    reviewId,
    matterKey,
    matterRevision,
    identityKeys,
    clientScope: clientScope(record.clientName),
    clientName: record.clientName,
    packetHash: record.packetHash,
    sourceFile: record.sourceFile,
    clientOrder: record.orderNumber.value,
    propertyAddress: record.propertyAddress.value,
    parcelId: record.parcelId.value,
    state: record.state.value,
    county: record.county.value,
    searchType: record.orderType.value,
    searchEffectiveDate: record.effectiveDate.value,
    status: updated.qc.qcStatus === "PASS" ? "Pass" : "Fail",
    qcStatus: updated.qc.qcStatus,
    foreclosureReadiness: updated.qc.foreclosureReadiness,
    curativeIssueCount: updated.qc.curativeIssues.length,
    pageCount: telemetry.pageCount,
    ruleVersion: AUDIT_RULE_VERSION,
    model: `${telemetry.extractionModel} -> ${telemetry.checkModel}`,
    extractionMode: telemetry.extractionMode,
    extractionCacheHit: telemetry.extractionCacheHit,
    textCoverage: telemetry.textCoverage,
    extractionMs: telemetry.extractionMs,
    modelMs: telemetry.extractionModelMs + telemetry.checkModelMs,
    extractionModelMs: telemetry.extractionModelMs,
    checkModelMs: telemetry.checkModelMs,
    createdAt: new Date().toISOString(),
  };

  try {
    await put(`${RECEIPT_PREFIX}/${reviewId}.json`, JSON.stringify(receipt), { access: "private", addRandomSuffix: false, contentType: "application/json" });
    await Promise.all(identityKeys.map((identityKey) => put(`${INDEX_PREFIX}/${identityKey}/${reviewId}.json`, JSON.stringify({ reviewId, matterKey, packetHash: record.packetHash, clientScope: receipt.clientScope }), { access: "private", addRandomSuffix: false, contentType: "application/json" })));
  } catch (error) {
    console.warn("CYBRID_TITLE_CANONICAL_RECEIPT_WRITE_FAILED", JSON.stringify({ reviewId, message: error instanceof Error ? error.message : "unknown" }));
  }

  console.info("CYBRID_TITLE_CANONICAL_REVIEW_RECEIPT", JSON.stringify({ reviewId, matterKey, matterRevision, relatedPreviousReviews: previousIds.size, packetHash: record.packetHash, clientScope: receipt.clientScope, readiness: updated.qc.foreclosureReadiness }));
  return updated;
}
