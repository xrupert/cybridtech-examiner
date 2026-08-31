import { NextRequest, NextResponse } from "next/server";
import { AUDIT_RULE_VERSION, SEARCH_TYPES } from "@/lib/audit-rules";
import { reviewTitlePdf, CANONICAL_TITLE_ENGINE_VERSION } from "@/lib/canonical-title-engine";
import { titleExtractionModel } from "@/lib/openai-title-extractor";
import { accessProtectionConfigured, checkExaminerAccess, examinerAuthenticationMode } from "@/lib/examiner-auth";
import { deletePrivateBlobs, filesFromPrivateBlobs } from "@/lib/blob-files";
import { classifyOpenAIProviderFailure } from "@/lib/openai-provider-error";

export const runtime = "nodejs";
export const maxDuration = 800;

const AUTO_DETECT_SEARCH_TYPE = "Auto Detect";
const AUTO_DETECT_STATE = "AUTO";

function applyOpenAIKeyAlias() {
  if (!process.env.OPENAI_API_KEY && process.env.OPEN_AI_KEY) process.env.OPENAI_API_KEY = process.env.OPEN_AI_KEY;
}

applyOpenAIKeyAlias();

function openAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY);
}

function validatePdf(file: File): void {
  if (!file.name.toLowerCase().endsWith(".pdf")) throw new Error("CANONICAL_PDF_REQUIRED: Cybrid Title's canonical QC engine accepts complete PDF title-report packets.");
}

async function reviewFile(file: File, args: { state: string; searchType: string; clientName: string }) {
  validatePdf(file);
  const buffer = await file.arrayBuffer();
  if (!buffer.byteLength) throw new Error(`EMPTY_PACKET: ${file.name} is empty.`);
  return reviewTitlePdf(buffer, file.name, {
    clientName: args.clientName,
    requestedState: args.state,
    requestedSearchType: args.searchType,
  });
}

export async function GET() {
  applyOpenAIKeyAlias();
  return NextResponse.json({
    product: "Cybrid Title",
    engine: CANONICAL_TITLE_ENGINE_VERSION,
    openAIConfigured: openAIConfigured(),
    openAIKeyAliasAccepted: Boolean(process.env.OPEN_AI_KEY),
    authenticationMode: examinerAuthenticationMode(),
    accessProtectionConfigured: accessProtectionConfigured(),
    largeFileStorageConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    extractionModel: titleExtractionModel(),
    checkModel: process.env.OPENAI_CHECK_MODEL || process.env.OPENAI_REVIEW_MODEL || "gpt-5.6-sol",
    maxReviewDurationSeconds: maxDuration,
    ruleVersion: AUDIT_RULE_VERSION,
    pipeline: ["INGEST", "EXTRACT", "CLASSIFY", "NORMALIZE", "CHECK", "GROUND", "RENDER", "RECORD"],
    documentEngine: {
      packetIdentity: "sha256-exact-bytes",
      nativePdfTextFirst: true,
      scanPath: "full-pdf visual extraction into evidence ledger when native text is insufficient",
      extractionBeforeChecking: true,
      immutableEvidenceIds: true,
      nativeQuotePageVerification: true,
      functionalRunSheetSegmentation: true,
      bidirectionalRunSheetReconciliation: true,
      canonicalTitleRecord: true,
      versionedQcProfiles: true,
      semanticCheckerReadsLedgerNotPdf: true,
      lienStackDevelopment: true,
      lienPriorityMethod: "first-in-time recording chronology with exception gates",
      foreclosureAnalysisForEveryOrder: true,
      mccallaExportRequiresLienAmountAndPosition: true,
      curativeProjection: true,
      configurableClientExports: true,
      tenantScopedMatterHistory: true,
      persistentExaminerDecisions: true,
      durableBatchManifests: true,
    },
    supportedSearchTypes: [AUTO_DETECT_SEARCH_TYPE, ...SEARCH_TYPES],
    stateSelection: "auto-detect from packet; API supports explicit examiner override",
    unknownPolicy: "fail closed to Needs review / Cannot Confirm; never substitute owner for borrower; develop lien position from reliable first-in-time recording evidence but downgrade when recording sequence or statutory priority exceptions make legal priority uncertain",
  });
}

export async function POST(request: NextRequest) {
  let cleanupPathnames: string[] = [];
  try {
    applyOpenAIKeyAlias();
    if (!openAIConfigured()) return NextResponse.json({ code: "OPENAI_NOT_CONFIGURED", error: "OpenAI document extraction/checking is not configured.", retryable: true }, { status: 503 });

    const access = checkExaminerAccess(request);
    if (!access.ok) return NextResponse.json({ code: "AUTH_REQUIRED", error: access.error, retryable: false }, { status: access.status });

    const contentType = request.headers.get("content-type") || "";
    let file: File;
    let state = AUTO_DETECT_STATE;
    let searchType = AUTO_DETECT_SEARCH_TYPE;
    let clientName = "McCalla";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const files = form.getAll("files").filter((item): item is File => item instanceof File);
      if (!files.length) return NextResponse.json({ code: "NO_FILE", error: "No title-report PDF was uploaded." }, { status: 400 });
      if (files.length !== 1) return NextResponse.json({ code: "TOO_MANY_FILES", error: "Each packet job accepts one title-report PDF. Batch QC creates one isolated job per packet." }, { status: 400 });
      file = files[0];
      state = String(form.get("state") || AUTO_DETECT_STATE);
      searchType = String(form.get("searchType") || AUTO_DETECT_SEARCH_TYPE);
      clientName = String(form.get("clientName") || "McCalla");
    } else if (contentType.includes("application/json")) {
      const body = await request.json() as { blobPathnames?: string[]; state?: string; searchType?: string; clientName?: string };
      if (!body.blobPathnames?.length) return NextResponse.json({ code: "NO_FILE", error: "Provide one private title-report upload pathname." }, { status: 400 });
      if (body.blobPathnames.length !== 1) return NextResponse.json({ code: "TOO_MANY_FILES", error: "Each packet job accepts one title-report PDF. Batch QC creates one isolated job per packet." }, { status: 400 });
      cleanupPathnames = body.blobPathnames;
      const files = await filesFromPrivateBlobs(body.blobPathnames);
      file = files[0];
      state = body.state || AUTO_DETECT_STATE;
      searchType = body.searchType || AUTO_DETECT_SEARCH_TYPE;
      clientName = body.clientName || "McCalla";
    } else {
      return NextResponse.json({ code: "UNSUPPORTED_REQUEST", error: "Upload one PDF packet using multipart/form-data or the private Blob path." }, { status: 415 });
    }

    const execution = await reviewFile(file, { state, searchType, clientName });
    return NextResponse.json({
      review: execution.review,
      diagnostics: execution.diagnostics,
      count: 1,
      engine: CANONICAL_TITLE_ENGINE_VERSION,
      ruleVersion: AUDIT_RULE_VERSION,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Title QC failed.";
    const providerFailure = classifyOpenAIProviderFailure(message);
    if (providerFailure) {
      console.warn("CYBRID_TITLE_PROVIDER_ERROR", JSON.stringify({ engine: CANONICAL_TITLE_ENGINE_VERSION, code: providerFailure.code, message: message.slice(0, 600) }));
      return NextResponse.json(providerFailure, { status: providerFailure.status });
    }
    const input = /^(CANONICAL_PDF_REQUIRED|EMPTY_PACKET):/.test(message);
    return NextResponse.json({
      code: input ? message.split(":", 1)[0] : "REVIEW_FAILED",
      error: message.replace(/^(CANONICAL_PDF_REQUIRED|EMPTY_PACKET):\s*/, ""),
      retryable: !input,
      engine: CANONICAL_TITLE_ENGINE_VERSION,
    }, { status: input ? 400 : 500 });
  } finally {
    await deletePrivateBlobs(cleanupPathnames);
  }
}