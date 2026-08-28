import { NextResponse } from "next/server";
import { get, list } from "@vercel/blob";
import type { ReviewReceipt } from "@/lib/review-history";

export const runtime = "nodejs";
export const maxDuration = 60;

const RECEIPT_PREFIX = "cybrid-title/review-receipts/";

async function receiptPathnames(): Promise<string[]> {
  const pathnames: string[] = [];
  let cursor: string | undefined;
  do {
    const result = await list({ prefix: RECEIPT_PREFIX, cursor, limit: 1000 });
    pathnames.push(...result.blobs.map((blob) => blob.pathname));
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);
  return pathnames;
}

async function readReceipt(pathname: string): Promise<ReviewReceipt | null> {
  try {
    const result = await get(pathname, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return await new Response(result.stream).json() as ReviewReceipt;
  } catch {
    return null;
  }
}

export async function GET() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({
      configured: false,
      totals: { reviews: 0, pdfPages: 0, pass: 0, fail: 0 },
    });
  }

  const pathnames = await receiptPathnames();
  const receipts = (await Promise.all(pathnames.map(readReceipt))).filter((item): item is ReviewReceipt => Boolean(item));
  const totals = receipts.reduce((acc, receipt) => {
    acc.reviews += 1;
    acc.pdfPages += receipt.pageCount || 0;
    if (receipt.status === "Pass") acc.pass += 1;
    else acc.fail += 1;
    if (receipt.extractionCacheHit) acc.cacheHits += 1;
    if (receipt.extractionMode === "native-text") acc.nativeTextReviews += 1;
    else if (receipt.extractionMode === "openai-pdf-fallback") acc.visionFallbackReviews += 1;
    acc.extractionMs += receipt.extractionMs || 0;
    acc.modelMs += receipt.modelMs || 0;
    return acc;
  }, {
    reviews: 0,
    pdfPages: 0,
    pass: 0,
    fail: 0,
    cacheHits: 0,
    nativeTextReviews: 0,
    visionFallbackReviews: 0,
    extractionMs: 0,
    modelMs: 0,
  });

  const bySearchType = receipts.reduce<Record<string, number>>((acc, receipt) => {
    acc[receipt.searchType || "Unknown"] = (acc[receipt.searchType || "Unknown"] || 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    configured: true,
    totals: {
      reviews: totals.reviews,
      pdfPages: totals.pdfPages,
      pass: totals.pass,
      fail: totals.fail,
      averagePagesPerReview: totals.reviews ? Number((totals.pdfPages / totals.reviews).toFixed(1)) : 0,
      extractionCacheHits: totals.cacheHits,
      extractionCacheHitRate: totals.reviews ? Number(((totals.cacheHits / totals.reviews) * 100).toFixed(1)) : 0,
      nativeTextReviews: totals.nativeTextReviews,
      visionFallbackReviews: totals.visionFallbackReviews,
      averageExtractionMs: totals.reviews ? Math.round(totals.extractionMs / totals.reviews) : 0,
      averageModelMs: totals.reviews ? Math.round(totals.modelMs / totals.reviews) : 0,
    },
    bySearchType,
    privacy: "Aggregate operational metrics only. No property addresses, order numbers, parcel IDs, or document text are returned by this endpoint.",
  });
}
