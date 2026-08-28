import { NextRequest, NextResponse } from "next/server";
import { isSupportedSearchType } from "@/lib/audit-rules";
import { buildRunSheetWithOpenAI } from "@/lib/openai-run-sheet";

export const runtime = "nodejs";
export const maxDuration = 300;

const COST_MODEL = "gpt-5.6-luna";

function applyCostPolicy() {
  const allowPremium = process.env.OPENAI_ALLOW_PREMIUM_MODEL === "true";
  const documentModel = process.env.OPENAI_DOCUMENT_MODEL;
  if (!documentModel || (!allowPremium && documentModel !== COST_MODEL)) process.env.OPENAI_DOCUMENT_MODEL = COST_MODEL;
}

export async function GET() {
  applyCostPolicy();
  return NextResponse.json({
    mode: "build-run-sheet",
    openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_DOCUMENT_MODEL || COST_MODEL,
    verificationPasses: 2,
    supportedSearchTypes: ["Foreclosure", "2nd Lien", "Current Owner Search"],
  });
}

export async function POST(request: NextRequest) {
  try {
    applyCostPolicy();
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OpenAI is not configured yet. Add OPENAI_API_KEY to the Vercel project environment." }, { status: 503 });
    }
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) return NextResponse.json({ error: "Upload title documents as multipart/form-data." }, { status: 415 });
    const form = await request.formData();
    const files = form.getAll("files").filter((item): item is File => item instanceof File);
    const state = String(form.get("state") || "TX").trim().toUpperCase() || "TX";
    const searchType = String(form.get("searchType") || "Foreclosure").trim();
    if (!isSupportedSearchType(searchType)) return NextResponse.json({ error: `Unsupported MVP search type: ${searchType}.` }, { status: 400 });
    if (!files.length) return NextResponse.json({ error: "Upload at least one title document." }, { status: 400 });
    if (files.some((file) => !/\.(pdf|txt|md)$/i.test(file.name))) return NextResponse.json({ error: "The MVP accepts PDF, TXT, and MD title documents." }, { status: 400 });

    const build = await buildRunSheetWithOpenAI(files, { state, searchType });
    return NextResponse.json({
      build,
      model: process.env.OPENAI_DOCUMENT_MODEL || COST_MODEL,
      verificationPasses: 2,
      output: "evidence-first-run-sheet",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Run Sheet build failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
