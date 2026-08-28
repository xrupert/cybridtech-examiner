import { NextRequest, NextResponse } from "next/server";
import { critique } from "@/lib/critic";
import { FIXTURES } from "@/lib/fixtures";
import type { VeraExam } from "@/lib/vera";
import { AUDIT_RULE_VERSION, isSupportedSearchType } from "@/lib/audit-rules";
import { analyzePdfWithOpenAI, analyzeTextWithOpenAI, openAIDocumentIntelligenceConfigured, openAIDocumentModel } from "@/lib/openai-document-intelligence";
import { accessProtectionConfigured, checkExaminerAccess, examinerAuthenticationMode } from "@/lib/examiner-auth";
import { deletePrivateBlobs, filesFromPrivateBlobs } from "@/lib/blob-files";
import { classifyOpenAIProviderFailure } from "@/lib/openai-provider-error";
import { recordCompletedReview } from "@/lib/review-history";

export const runtime = "nodejs";
export const maxDuration = 800;

const REVIEW_MODEL = process.env.OPENAI_REVIEW_MODEL || "gpt-5.6-sol";
const DEFAULT_SEARCH_TYPE = "Foreclosure";

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
  if (!isSupportedSearchType(normalizedSearchType)) throw new Error(`Unsupported MVP search type: ${normalizedSearchType}. Use Foreclosure, 2nd Lien, or Current Owner Search.`);
  return { state: state.trim().toUpperCase() || "TX", searchType: normalizedSearchType, sourceFile };
}

async function examineFile(file: File, state: string, searchType: string): Promise<VeraExam> {
  const name = file.name || "upload";
  const context = auditContext(state, searchType, name);
  if (name.toLowerCase().endsWith(".pdf")) return critique(await analyzePdfWithOpenAI(await file.arrayBuffer(), context));
  const text = await file.text();
  if (!text.trim()) throw new Error(`Could not read text from ${name}`);
  return critique(await analyzeTextWithOpenAI(text, context));
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
      repeatPropertyPolicy: "new packet bytes always create a new packet identity; matching order/address/parcel only links related reviews",
      reviewReceipts: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    },
    mvp: {
      onePacketPerReview: true,
      supportedSearchTypes: ["Foreclosure", "2nd Lien", "Current Owner Search"],
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
      const searchType = String(form.get("searchType") || DEFAULT_SEARCH_TYPE);
      if (!files.length) return NextResponse.json({ code: "NO_FILE", error: "No file uploaded." }, { status: 400 });
      if (files.length > 1) return NextResponse.json({ code: "TOO_MANY_FILES", error: "The VERA review accepts one complete title-report packet at a time." }, { status: 400 });
      exam = await examineFile(files[0], state, searchType);
    } else if (ctype.includes("application/json")) {
      const body = (await req.json()) as { fixtureId?: string; text?: string; sourceFile?: string; state?: string; searchType?: string; blobPathnames?: string[] };
      const state = body.state || "TX";
      const searchType = body.searchType || DEFAULT_SEARCH_TYPE;
      if (body.blobPathnames?.length) {
        if (body.blobPathnames.length !== 1) return NextResponse.json({ code: "TOO_MANY_FILES", error: "The VERA review accepts one packet at a time." }, { status: 400 });
        cleanupPathnames = body.blobPathnames;
        const files = await filesFromPrivateBlobs(body.blobPathnames);
        exam = await examineFile(files[0], state, searchType);
      } else if (body.fixtureId) {
        const fixture = FIXTURES.find((item) => item.id === body.fixtureId);
        if (!fixture) return NextResponse.json({ code: "UNKNOWN_FIXTURE", error: "Unknown fixture." }, { status: 404 });
        exam = critique(await analyzeTextWithOpenAI(fixture.text, auditContext(state, searchType, fixture.name)));
      } else if (body.text?.trim()) {
        exam = critique(await analyzeTextWithOpenAI(body.text, auditContext(state, searchType, body.sourceFile || "pasted-text")));
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
      reviewPolicy: "Document Engine v1 extracts/caches exact packets by SHA-256, then runs one Sol audit plus deterministic evidence/structure validation.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Examine failed";
    const providerFailure = classifyOpenAIProviderFailure(message);
    if (providerFailure) {
      console.warn("CYBRID_TITLE_PROVIDER_ERROR", JSON.stringify({ mode: "review", code: providerFailure.code, message: message.slice(0, 600) }));
      return NextResponse.json(providerFailure, { status: providerFailure.status });
    }
    const status = message.startsWith("Unsupported MVP search type:") ? 400 : 500;
    return NextResponse.json({ code: status === 400 ? "UNSUPPORTED_SEARCH_TYPE" : "REVIEW_FAILED", error: message, retryable: status !== 400, openAIConfigured: openAIDocumentIntelligenceConfigured() }, { status });
  } finally {
    await deletePrivateBlobs(cleanupPathnames);
  }
}
