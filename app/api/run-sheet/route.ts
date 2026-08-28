import { NextRequest, NextResponse } from "next/server";
import { isSupportedSearchType } from "@/lib/audit-rules";
import { buildRunSheetWithOpenAI } from "@/lib/openai-run-sheet";
import { accessProtectionConfigured, checkExaminerAccess } from "@/lib/examiner-auth";
import { deletePrivateBlobs, filesFromPrivateBlobs } from "@/lib/blob-files";

export const runtime = "nodejs";
export const maxDuration = 300;

const COST_MODEL = "gpt-5.6-luna";

function applyOpenAIKeyAlias() {
  if (!process.env.OPENAI_API_KEY && process.env.OPEN_AI_KEY) {
    process.env.OPENAI_API_KEY = process.env.OPEN_AI_KEY;
  }
}

function applyCostPolicy() {
  const allowPremium = process.env.OPENAI_ALLOW_PREMIUM_MODEL === "true";
  const documentModel = process.env.OPENAI_DOCUMENT_MODEL;
  if (!documentModel || (!allowPremium && documentModel !== COST_MODEL)) process.env.OPENAI_DOCUMENT_MODEL = COST_MODEL;
}

export async function GET() {
  applyOpenAIKeyAlias();
  applyCostPolicy();
  return NextResponse.json({
    mode: "build-run-sheet",
    openAIConfigured: Boolean(process.env.OPENAI_API_KEY),
    openAIKeyAliasAccepted: Boolean(process.env.OPEN_AI_KEY),
    accessProtectionConfigured: accessProtectionConfigured(),
    largeFileStorageConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    model: process.env.OPENAI_DOCUMENT_MODEL || COST_MODEL,
    verificationPasses: 2,
    supportedSearchTypes: ["Foreclosure", "2nd Lien", "Current Owner Search"],
  });
}

export async function POST(request: NextRequest) {
  let cleanupPathnames: string[] = [];
  try {
    applyOpenAIKeyAlias();
    applyCostPolicy();
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OpenAI is not configured yet. Configure OPEN_AI_KEY or OPENAI_API_KEY in the Vercel project environment." }, { status: 503 });
    }
    const access = checkExaminerAccess(request);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const contentType = request.headers.get("content-type") || "";
    let files: File[] = [];
    let state = "TX";
    let searchType = "Foreclosure";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      files = form.getAll("files").filter((item): item is File => item instanceof File);
      state = String(form.get("state") || "TX").trim().toUpperCase() || "TX";
      searchType = String(form.get("searchType") || "Foreclosure").trim();
    } else if (contentType.includes("application/json")) {
      const body = await request.json() as { blobPathnames?: string[]; state?: string; searchType?: string };
      cleanupPathnames = body.blobPathnames || [];
      state = String(body.state || "TX").trim().toUpperCase() || "TX";
      searchType = String(body.searchType || "Foreclosure").trim();
      if (!cleanupPathnames.length) return NextResponse.json({ error: "Provide uploaded title-document pathnames." }, { status: 400 });
      files = await filesFromPrivateBlobs(cleanupPathnames);
    } else {
      return NextResponse.json({ error: "Upload title documents or provide private upload pathnames." }, { status: 415 });
    }

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
  } finally {
    await deletePrivateBlobs(cleanupPathnames);
  }
}
