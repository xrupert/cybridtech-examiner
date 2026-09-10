import { databaseConfigured } from "@/lib/database";
import { enqueueJob } from "@/lib/durable-jobs";
import { assertUploadPaths } from "@/lib/upload-paths";
import { NextRequest, NextResponse } from "next/server";
import { AUDIT_RULE_VERSION, SEARCH_TYPES } from "@/lib/audit-rules";
import { reviewTitlePdfUnified, UNIFIED_TITLE_ENGINE_VERSION } from "@/lib/unified-title-engine";
import { titleExtractionModel } from "@/lib/openai-title-extractor";
import { accessProtectionConfigured, checkExaminerAccess, examinerAuthenticationMode } from "@/lib/examiner-auth";
import { filesFromPrivateBlobs } from "@/lib/blob-files";
import { classifyOpenAIProviderFailure } from "@/lib/openai-provider-error";
import { assertClientScope, clientInstanceConfig, clientPublicDescriptor } from "@/lib/client-instance";

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
  return reviewTitlePdfUnified(buffer, file.name, {
    clientName: args.clientName,
    requestedState: args.state,
    requestedSearchType: args.searchType,
  });
}

export async function GET() {
  applyOpenAIKeyAlias();
  const client = clientPublicDescriptor();
  return NextResponse.json({
    product: "Cybrid Title",
    engine: UNIFIED_TITLE_ENGINE_VERSION,
    client,
    openAIConfigured: openAIConfigured(),
    openAIKeyAliasAccepted: Boolean(process.env.OPEN_AI_KEY),
    authenticationMode: examinerAuthenticationMode(),
    accessProtectionConfigured: accessProtectionConfigured(),
    largeFileStorageConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    extractionModel: titleExtractionModel(),
    checkModel: process.env.OPENAI_CHECK_MODEL || process.env.OPENAI_REVIEW_MODEL || "gpt-5.6-sol",
    askVeraConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN && openAIConfigured()),
    processingMode: databaseConfigured() ? "durable-worker" : "synchronous-development",
    maxReviewDurationSeconds: maxDuration,
    ruleVersion: AUDIT_RULE_VERSION,
    pipeline: ["INGEST", "EXTRACT", "CLASSIFY", "NORMALIZE", "CHECK", "GROUND", "RENDER", "RECORD"],
    documentEngine: {
      packetIdentity: "sha256-exact-bytes",
      nativePdfTextFirst: true,
      scanPath: "page-isolated native extraction -> targeted OCR -> page vision; unresolved pages remain explicit and do not erase readable neighbors",
      unreadablePagePolicy: "manual-review/cannot-confirm, never substantive fail by unreadability alone",
      wholePdfVisionPolicy: "only when the PDF cannot be page-inventoried at all",
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
      persistedEvidenceDossier: true,
      askVeraEvidenceChat: true,
    },
    supportedSearchTypes: [AUTO_DETECT_SEARCH_TYPE, ...SEARCH_TYPES],
    stateSelection: "auto-detect from packet; API supports explicit examiner override",
    unknownPolicy: "fail closed to Needs review / Cannot Confirm; never substitute owner for borrower; develop lien position from reliable first-in-time recording evidence but downgrade when recording sequence or statutory priority exceptions make legal priority uncertain",
  });
}

export async function POST(request: NextRequest) {
  try {
    applyOpenAIKeyAlias();
    if (!openAIConfigured()) return NextResponse.json({ code: "OPENAI_NOT_CONFIGURED", error: "OpenAI document extraction/checking is not configured.", retryable: true }, { status: 503 });

    const access = checkExaminerAccess(request);
    if (!access.ok) return NextResponse.json({ code: "AUTH_REQUIRED", error: access.error, retryable: false }, { status: access.status });

    if (process.env.VERA_COMPLIANCE_MODE === "1" && !databaseConfigured()) return NextResponse.json({ error: "Durable job storage is required for client processing." }, { status: 503 });
    const instance = clientInstanceConfig();
    const contentType = request.headers.get("content-type") || "";
    let file: File;
    let state = AUTO_DETECT_STATE;
    let searchType = AUTO_DETECT_SEARCH_TYPE;
    let clientName = instance.clientName;

    if (contentType.includes("multipart/form-data")) {
      if (databaseConfigured()) return NextResponse.json({ error: "Upload the PDF to private storage before submitting a durable job." }, { status: 400 });
      const form = await request.formData();
      const files = form.getAll("files").filter((item): item is File => item instanceof File);
      if (!files.length) return NextResponse.json({ code: "NO_FILE", error: "No title-report PDF was uploaded." }, { status: 400 });
      if (files.length !== 1) return NextResponse.json({ code: "TOO_MANY_FILES", error: "Each packet job accepts one title-report PDF. Batch QC creates one isolated job per packet." }, { status: 400 });
      file = files[0];
      state = String(form.get("state") || AUTO_DETECT_STATE);
      searchType = String(form.get("searchType") || AUTO_DETECT_SEARCH_TYPE);
      clientName = String(form.get("clientName") || instance.clientName);
    } else if (contentType.includes("application/json")) {
      const body = await request.json() as { blobPathnames?: string[]; state?: string; searchType?: string; clientName?: string };
      if (!body.blobPathnames?.length) return NextResponse.json({ code: "NO_FILE", error: "Provide one private title-report upload pathname." }, { status: 400 });
      if (body.blobPathnames.length !== 1) return NextResponse.json({ code: "TOO_MANY_FILES", error: "Each packet job accepts one title-report PDF. Batch QC creates one isolated job per packet." }, { status: 400 });
      assertUploadPaths(body.blobPathnames);
      const scope = assertClientScope(body.clientName);
      if (databaseConfigured()) {
        if (body.state !== undefined && (typeof body.state !== "string" || body.state.length > 80)) return NextResponse.json({ error: "Invalid state." }, { status: 400 });
        if (body.searchType !== undefined && (typeof body.searchType !== "string" || body.searchType.length > 100)) return NextResponse.json({ error: "Invalid search type." }, { status: 400 });
        const job = await enqueueJob({ pathname: body.blobPathnames[0], state: body.state || AUTO_DETECT_STATE, searchType: body.searchType || AUTO_DETECT_SEARCH_TYPE, clientName: scope.clientName });
        return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
      }
      const files = await filesFromPrivateBlobs(body.blobPathnames);
      file = files[0];
      state = body.state || AUTO_DETECT_STATE;
      searchType = body.searchType || AUTO_DETECT_SEARCH_TYPE;
      clientName = body.clientName || instance.clientName;
    } else {
      return NextResponse.json({ code: "UNSUPPORTED_REQUEST", error: "Upload one PDF packet using multipart/form-data or the private Blob path." }, { status: 415 });
    }

    const scope = assertClientScope(clientName);
    const execution = await reviewFile(file, { state, searchType, clientName: scope.clientName });
    return NextResponse.json({
      review: execution.review,
      diagnostics: execution.diagnostics,
      count: 1,
      engine: UNIFIED_TITLE_ENGINE_VERSION,
      ruleVersion: AUDIT_RULE_VERSION,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Title QC failed.";
    const providerFailure = classifyOpenAIProviderFailure(message);
    if (providerFailure) {
      console.warn("CYBRID_TITLE_PROVIDER_ERROR", JSON.stringify({ engine: UNIFIED_TITLE_ENGINE_VERSION, code: providerFailure.code, message: message.slice(0, 600) }));
      return NextResponse.json(providerFailure, { status: providerFailure.status });
    }
    const input = /^(INVALID_UPLOAD|CANONICAL_PDF_REQUIRED|EMPTY_PACKET|CLIENT_INSTANCE_NOT_CONFIGURED|CLIENT_SCOPE_MISMATCH):/.test(message);
    return NextResponse.json({
      code: input ? message.split(":", 1)[0] : "REVIEW_FAILED",
      error: message.replace(/^(INVALID_UPLOAD|CANONICAL_PDF_REQUIRED|EMPTY_PACKET|CLIENT_INSTANCE_NOT_CONFIGURED|CLIENT_SCOPE_MISMATCH):\s*/, ""),
      retryable: !input,
      engine: UNIFIED_TITLE_ENGINE_VERSION,
    }, { status: input ? 400 : 500 });
  }
}
