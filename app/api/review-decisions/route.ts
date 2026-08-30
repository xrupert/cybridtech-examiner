import { NextRequest, NextResponse } from "next/server";
import { checkExaminerAccess } from "@/lib/examiner-auth";
import { loadReviewDecisions, saveReviewDecision, type ExaminerDecision } from "@/lib/review-decisions";
import type { QcStatus } from "@/lib/title-domain";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = checkExaminerAccess(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const reviewId = request.nextUrl.searchParams.get("reviewId")?.trim() || "";
  if (!reviewId) return NextResponse.json({ error: "reviewId is required." }, { status: 400 });
  return NextResponse.json(await loadReviewDecisions(reviewId));
}

export async function POST(request: NextRequest) {
  try {
    const access = checkExaminerAccess(request);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
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
    const manifest = await saveReviewDecision({
      reviewId: body.reviewId,
      checkId: body.checkId,
      decision: body.decision,
      correctedStatus: body.correctedStatus,
      correctedValue: body.correctedValue,
      reason: body.reason || "Examiner disposition",
      actor: body.actor || "examiner",
    });
    return NextResponse.json(manifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save review decision.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
