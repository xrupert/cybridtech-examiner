import { loadReviewDossier } from "@/lib/review-dossier";
import { NextRequest, NextResponse } from "next/server";
import { loadReviewDecisions, saveReviewDecision, type ExaminerDecision } from "@/lib/review-decisions";
import type { QcStatus } from "@/lib/title-domain";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const reviewId = request.nextUrl.searchParams.get("reviewId")?.trim() || "";
  if (!reviewId) return NextResponse.json({ error: "reviewId is required." }, { status: 400 });
  if (!await loadReviewDossier(reviewId)) return NextResponse.json({ error: "Review not found in this client instance." }, { status: 404 });
  return NextResponse.json(await loadReviewDecisions(reviewId));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      reviewId?: string;
      checkId?: string;
      decision?: ExaminerDecision;
      correctedStatus?: QcStatus;
      correctedValue?: string;
      reason?: string;
      actor?: string;
    };
    if (!body.reviewId || !body.checkId || !body.decision) return NextResponse.json({ error: "reviewId, checkId, and decision are required." }, { status: 400 });
    const dossier = await loadReviewDossier(body.reviewId);
    if (!dossier || !dossier.review.qc.checks.some((check) => check.id === body.checkId)) return NextResponse.json({ error: "Review or check not found in this client instance." }, { status: 404 });
    const manifest = await saveReviewDecision({
      reviewId: body.reviewId,
      checkId: body.checkId,
      decision: body.decision,
      correctedStatus: body.correctedStatus,
      correctedValue: body.correctedValue,
      reason: body.reason || "Examiner disposition",
      actor: "unattributed-preview-access",
    });
    return NextResponse.json(manifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save review decision.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
