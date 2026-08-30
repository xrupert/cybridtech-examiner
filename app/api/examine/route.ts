import { NextRequest, NextResponse } from "next/server";
import { critique } from "@/lib/critic";
import { FIXTURES } from "@/lib/fixtures";
import type { VeraExam } from "@/lib/vera";
import { AUDIT_RULE_VERSION, SEARCH_TYPES, isSupportedSearchType } from "@/lib/audit-rules";
import { detectPdfSearchType, detectSearchTypeFromText } from "@/lib/document-engine";
import { analyzePdfWithOpenAI, analyzeTextWithOpenAI, openAIDocumentIntelligenceConfigured, openAIDocumentModel } from "@/lib/openai-document-intelligence";
import { accessProtectionConfigured, checkExaminerAccess, examinerAuthenticationMode } from "@/lib/examiner-auth";
import { deletePrivateBlobs, filesFromPrivateBlobs } from "@/lib/blob-files";
import { classifyOpenAIProviderFailure } from "@/lib/openai-provider-error";
import { recordCompletedReview } from "@/lib/review-history";

export const runtime = "nodejs";
export const maxDuration = 800;

const REVIEW_MODEL = process.env.OPENAI_REVIEW_MODEL || "gpt-5.6-sol";
const DEFAULT_SEARCH_TYPE = "Foreclosure";
const AUTO_DETECT_SEARCH_TYPE = "Auto Detect";

function applyOpenAIKeyAlias() {
  if (!process.env.OPENAI_API_KEY && process.env.OPEN_AI_KEY) process.env.OPENAI_API_KEY = process.env.OPEN_AI_KEY;
}

function applyReviewPolicy() {
  process.env.OPENAI_DOCUMENT_MODEL = REVIEW_MODEL;
}

applyOpenAIKeyAlias();
applyReviewPolicy();

function auditContext(state: string, searchType: string, sourceFile: string) {
  const normalizedSearchType = searchType.trim() || DEFAULT_SEARCH_TYPE;
  if (!isSupportedSearchType(normalizedSearchType)) throw new Error(`Unsupported MVP search type: ${normalizedSearchType}. Use ${SEARCH_TYPES.join(", ")}.`);
  return { state: state.trim().toUpperCase() || "TX", searchType: normalizedSearchType, sourceFile };
}

async function resolvePdfSearchType(buffer: ArrayBuffer, sourceFile: string, requested: string): Promise<string> {
  if (requested !== AUTO_DETECT_SEARCH_TYPE) return requested;
  const detected = await detectPdfSearchType(buffer, sourceFile);
  if (!detected.searchType) {
    throw new Error(`AUTO_DETECT_SEARCH_TYPE_FAILED: Cybrid Title could not establish the order/search type from the opening title-summary pages. Select the QC profile manually for ${sourceFile}.`);
  }
  console.info("CYBRID_TITLE_SEARCH_TYPE_DETECTED", JSON.stringify({ sourceFile, searchType: detected.searchType, evidence: detected.evidence, confidence: detected.confidence }));
  return detected.searchType;
}

function resolveTextSearchType(text: string, sourceFile: string, requested: string): string {
  if (requested !== AUTO_DETECT_SEARCH_TYPE) return requested;
  const detected = detectSearchTypeFromText(text.slice(0, 30000));
  if (!detected.searchType) {
    throw new Error(`AUTO_DETECT_SEARCH_TYPE_FAILED: Cybrid Title could not establish the order/search type from the supplied title-summary text. Select the QC profile manually for ${sourceFile}.`);
  }
  return detected.searchType;
}

async function examineFile(file: File, state: string, searchType: string): Promise<VeraExam> {
  const name = file.name || "upload";
  if (name.toLowerCase().endsWith(".pdf")) {
    const buffer = await file.arrayBuffer();
    const resolvedSearchType = await resolvePdfSearchType(buffer, name, searchType);
    return critique(await analyzePdfWithOpenAI(buffer, auditContext(state, resolvedSearchType, name)));
  }
  const text = await file.text();
  if (!text.trim()) throw new Error(`Could not read text from ${name}`);
  const resolvedSearchType = resolveTextSearchType(text, name, searchType);
  return critique(await analyzeTextWithOpenAI(text, auditContext(state, resolvedSearchType, name)));
}

function reviewedPageCount(exam: VeraExam): number {
  if (exam.packetPageCount > 0) return exam.packetPageCount;
  return Math.max(0, ...exam.pages.map((page) => page.page || 0), ...exam.documents.map((document) => document.pageEnd || 0));
}

export async function GET() {
  applyOpenAIKeyAlias();
  applyReviewPolicy();
  return NextResponse.json({
    product: "Cybrid Title",
    engine: "cybrid-title-document-engine-v1",
    openAIConfigured: openAIDocumentIntelligenceConfigured(),
    openAIKeyAliasAccepted: Boolean(process.env.OPEN_AI_KEY),
    authenticationMode: examinerAuthenticationMode(),
    accessProtectionConfigured: accessProtectionConfigured(),
    largeFileStorageConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    documentModel: openAIDocumentModel(),
    modelPasses: 1,
    verificationMode: "deterministic-server-evidence-gate",
    maxReviewDurationSeconds: maxDuration,
    azureRequired: false,
    ruleVersion: AUDIT_RULE_VERSION,
    documentEngine: {
      packetIdentity: "sha256-exact-bytes",
      extractionCache: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      nativePdfTextFirst: true,
      scannedPdfFallback: "openai-pdf-vision",
      physicalPageMarkers: true,
      functionalRunSheetDetection: true,
      orderProfileAutoDetection: true,
      repeatPropertyPolicy: "new packet bytes always create a new packet identity; matching order/address/parcel only links related reviews",
      reviewReceipts: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    },
    mvp: {
      onePacketPerReviewJob: true,
      batchOrchestration: "client workbench submits one independent review job per packet",
      supportedSearchTypes: [AUTO_DETECT_SEARCH_TYPE, ...SEARCH_TYPES],
      veraTemplate: "VERA v3",
      rcsOrderRulesLoaded: true,
      legalDescriptionProtocolLoaded: true,
      quickReferenceChecklistLoaded: true,
    },
    reviewPolicy: {
      defaultModel: REVIEW_MODEL,
      fullPacketModelPasses: 1,
      deterministicCritic: true,
      goal: "extract once, preserve page evidence, review fast, never reuse stale property content",
    },
  });
}

export async function POST(req: NextRequest) {
  let cleanupPathnames: string[] = [];
  try {
    applyOpenAIKeyAlias();
    applyReviewPolicy();
    if (!openAIDocumentIntelligenceConfigured()) {
      return NextResponse.json({ code: "OPENAI_NOT_CONFIGURED", error: "OpenAI document review is not configured yet. Configure OPEN_AI_KEY or OPENAI_API_KEY and redeploy Production.", retryable: true }, { status: 503 });
    }

    const access = checkExaminerAccess(req);
    if (!access.ok) return NextResponse.json({ code: "AUTH_REQUIRED", error: access.error, retryable: false }, { status: access.status });

    const ctype = req.headers.get("content-type") || "";
    let exam: VeraExam;

    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const files = form.getAll("files").filter((item): item is File => item instanceof File);
      const state = String(form.get("state") || "TX");
      const searchType = String(form.get("searchType") || AUTO_DETECT_SEARCH_TYPE);
      if (!files.length) return NextResponse.json({ code: "NO_FILE", error: "No file uploaded." }, { status: 400 });
      if (files.length > 1) return NextResponse.json({ code: "TOO_MANY_FILES", error: "Each review job accepts one complete title-report packet. Use Batch QC to submit multiple independent jobs." }, { status: 400 });
      exam = await examineFile(files[0], state, searchType);
    } else if (ctype.includes("application/json")) {
      const body = (await req.json()) as { fixtureId?: string; text?: string; sourceFile?: string; state?: string; searchType?: string; blobPathnames?: string[] };
      const state = body.state || "TX";
      const searchType = body.searchType || AUTO_DETECT_SEARCH_TYPE;
      if (body.blobPathnames?.length) {
        if (body.blobPathnames.length !== 1) return NextResponse.json({ code: "TOO_MANY_FILES", error: "Each review job accepts one title packet. Use Batch QC for multiple packets." }, { status: 400 });
        cleanupPathnames = body.blobPathnames;
        const files = await filesFromPrivateBlobs(body.blobPathnames);
        exam = await examineFile(files[0], state, searchType);
      } else if (body.fixtureId) {
        const fixture = FIXTURES.find((item) => item.id === body.fixtureId);
        if (!fixture) return NextResponse.json({ code: "UNKNOWN_FIXTURE", error: "Unknown fixture." }, { status: 404 });
        const resolvedSearchType = resolveTextSearchType(fixture.text, fixture.name, searchType);
        exam = critique(await analyzeTextWithOpenAI(fixture.text, auditContext(state, resolvedSearchType, fixture.name)));
      } else if (body.text?.trim()) {
        const sourceFile = body.sourceFile || "pasted-text";
        const resolvedSearchType = resolveTextSearchType(body.text, sourceFile, searchType);
        exam = critique(await analyzeTextWithOpenAI(body.text, auditContext(state, resolvedSearchType, sourceFile)));
      } else {
        return NextResponse.json({ code: "NO_INPUT", error: "Provide one file, pasted text, fixtureId, or private upload pathname." }, { status: 400 });
      }
    } else {
      return NextResponse.json({ code: "UNSUPPORTED_REQUEST", error: "Unsupported request format." }, { status: 415 });
    }

    exam = await recordCompletedReview(exam, openAIDocumentModel());

    const usage = {
      reviews: 1,
      pdfs: exam.sourceFile.toLowerCase().endsWith(".pdf") ? 1 : 0,
      pages: reviewedPageCount(exam),
      model: openAIDocumentModel(),
      modelPasses: 1,
      verificationMode: "deterministic-server-evidence-gate",
      extractionMode: exam.documentEngine.extractionMode,
      extractionCacheHit: exam.documentEngine.extractionCacheHit,
      packetHash: exam.packetHash,
      reviewId: exam.reviewId,
      matterRevision: exam.matterRevision,
      extractionMs: exam.documentEngine.extractionMs,
      modelMs: exam.documentEngine.modelMs,
    };
    console.info("CYBRID_TITLE_USAGE", JSON.stringify({ mode: "review", ...usage, state: exam.state, searchType: exam.searchType }));

    return NextResponse.json({
      exam,
      exams: [exam],
      count: 1,
      usage,
      openAIConfigured: true,
      documentModel: openAIDocumentModel(),
      modelPasses: 1,
      verificationMode: "deterministic-server-evidence-gate",
      veraTemplate: "VERA v3",
      ruleVersion: AUDIT_RULE_VERSION,
      rcsOrderRulesLoaded: true,
      legalDescriptionProtocolLoaded: true,
      quickReferenceChecklistLoaded: true,
      reviewPolicy: "Document Engine v1 extracts/caches exact packets by SHA-256, auto-detects the order profile when requested, then runs one Sol audit plus deterministic evidence/structure validation.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Examine failed";
    const providerFailure = classifyOpenAIProviderFailure(message);
    if (providerFailure) {
      console.warn("CYBRID_TITLE_PROVIDER_ERROR", JSON.stringify({ mode: "review", code: providerFailure.code, message: message.slice(0, 600) }));
      return NextResponse.json(providerFailure, { status: providerFailure.status });
    }
    const userInputError = message.startsWith("Unsupported MVP search type:") || message.startsWith("AUTO_DETECT_SEARCH_TYPE_FAILED:");
    const status = userInputError ? 400 : 500;
    return NextResponse.json({ code: message.startsWith("AUTO_DETECT_SEARCH_TYPE_FAILED:") ? "AUTO_DETECT_SEARCH_TYPE_FAILED" : status === 400 ? "UNSUPPORTED_SEARCH_TYPE" : "REVIEW_FAILED", error: message.replace(/^AUTO_DETECT_SEARCH_TYPE_FAILED:\s*/, ""), retryable: status !== 400, openAIConfigured: openAIDocumentIntelligenceConfigured() }, { status });
  } finally {
    await deletePrivateBlobs(cleanupPathnames);
  }
}
