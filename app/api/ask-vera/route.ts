import { NextRequest, NextResponse } from "next/server";
import { askVera } from "@/lib/ask-vera";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as { reviewId?: string; question?: string } | null;
    const reviewId = String(body?.reviewId || "").trim();
    const question = String(body?.question || "").trim();
    if (!reviewId || !question) return NextResponse.json({ code: "INVALID_REQUEST", error: "reviewId and question are required." }, { status: 400 });
    if (question.length > 3000) return NextResponse.json({ code: "QUESTION_TOO_LONG", error: "Question must be 3000 characters or fewer." }, { status: 400 });
    return NextResponse.json(await askVera(reviewId, question));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ask Vera failed.";
    const notFound = message.startsWith("REVIEW_DOSSIER_NOT_FOUND");
    const input = message.startsWith("QUESTION_REQUIRED");
    return NextResponse.json({ code: notFound ? "DOSSIER_NOT_FOUND" : input ? "INVALID_REQUEST" : "ASK_VERA_FAILED", error: message.replace(/^[A-Z_]+:\s*/, "") }, { status: notFound ? 404 : input ? 400 : 500 });
  }
}
