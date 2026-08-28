import { NextRequest, NextResponse } from "next/server";
import { critique } from "@/lib/critic";
import { FIXTURES } from "@/lib/fixtures";
import type { VeraExam } from "@/lib/vera";
import { AUDIT_RULE_VERSION, isSupportedSearchType } from "@/lib/audit-rules";
import { analyzePdfWithOpenAI, analyzeTextWithOpenAI, openAIDocumentIntelligenceConfigured, openAIDocumentModel } from "@/lib/openai-document-intelligence";
import { accessProtectionConfigured, checkExaminerAccess } from "@/lib/examiner-auth";
import { deletePrivateBlobs, filesFromPrivateBlobs } from "@/lib/blob-files";

export const runtime = "nodejs";
export const maxDuration = 300;

const COST_MODEL = "gpt-5.6-luna";
const DEFAULT_SEARCH_TYPE = "Foreclosure";

function applyOpenAIKeyAlias() {
  if (!process.env.OPENAI_API_KEY && process.env.OPEN_AI_KEY) {
    process.env.OPENAI_API_KEY = process.env.OPEN_AI_KEY;
  }
}

function applyCostPolicy() {
  const allowPremium = process.env.OPENAI_ALLOW_PREMIUM_MODEL === "true";
  const documentModel = process.env.OPENAI_DOCUMENT_MODEL;
  const verifyModel = process.env.OPENAI_VERIFY_MODEL;
  if (!documentModel || (!allowPremium && documentModel !== COST_MODEL)) process.env.OPENAI_DOCUMENT_MODEL = COST_MODEL;
  if (!verifyModel || (!allowPremium && verifyModel !== COST_MODEL)) process.env.OPENAI_VERIFY_MODEL = COST_MODEL;
}

applyOpenAIKeyAlias();
applyCostPolicy();

function auditContext(state: string, searchType: string, sourceFile: string) {
  const normalizedSearchType = searchType.trim() || DEFAULT_SEARCH_TYPE;
  if (!isSupportedSearchType(normalizedSearchType)) {
    throw new Error(`Unsupported MVP search type: ${normalizedSearchType}. Use Foreclosure, 2nd Lien, or Current Owner Search.`);
  }
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

export async function GET() {
  applyOpenAIKeyAlias();
  return NextResponse.json({
    engine: "openai-multimodal-forensic",
    openAIConfigured: openAIDocumentIntelligenceConfigured(),
    openAIKeyAliasAccepted: Boolean(process.env.OPEN_AI_KEY),
    accessProtectionConfigured: accessProtectionConfigured(),
    largeFileStorageConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    documentModel: openAIDocumentModel(),
    verificationModel: process.env.OPENAI_VERIFY_MODEL || COST_MODEL,
    verificationPasses: 2,
    azureRequired: false,
    ruleVersion: AUDIT_RULE_VERSION,
    mvp: {
      onePacketPerReview: true,
      supportedSearchTypes: ["Foreclosure", "2nd Lien", "Current Owner Search"],
      veraTemplate: "VERA v3",
      rcsOrderRulesLoaded: true,
      legalDescriptionProtocolLoaded: true,
      quickReferenceChecklistLoaded: true,
    },
    costPolicy: {
      defaultModel: COST_MODEL,
      premiumModelsBlocked: process.env.OPENAI_ALLOW_PREMIUM_MODEL !== "true",
      automaticPremiumEscalation: false,
      inputUsdPerMillionTokens: 0.20,
      outputUsdPerMillionTokens: 1.20,
      longContextThresholdTokens: 272000,
    },
  });
}

export async function POST(req: NextRequest) {
  let cleanupPathnames: string[] = [];
  try {
    applyOpenAIKeyAlias();
    applyCostPolicy();
    if (!openAIDocumentIntelligenceConfigured()) {
      return NextResponse.json({ error: "OpenAI forensic document intelligence is not configured yet. Configure OPEN_AI_KEY or OPENAI_API_KEY in the Vercel project environment and redeploy Production." }, { status: 503 });
    }
    const access = checkExaminerAccess(req);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

    const ctype = req.headers.get("content-type") || "";
    let exam: VeraExam;

    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const files = form.getAll("files").filter((item): item is File => item instanceof File);
      const state = String(form.get("state") || "TX");
      const searchType = String(form.get("searchType") || DEFAULT_SEARCH_TYPE);
      if (!files.length) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
      if (files.length > 1) return NextResponse.json({ error: "The VERA MVP reviews one title-report packet at a time. Upload one packet." }, { status: 400 });
      exam = await examineFile(files[0], state, searchType);
    } else if (ctype.includes("application/json")) {
      const body = (await req.json()) as {
        fixtureId?: string;
        text?: string;
        sourceFile?: string;
        state?: string;
        searchType?: string;
        blobPathnames?: string[];
      };
      const state = body.state || "TX";
      const searchType = body.searchType || DEFAULT_SEARCH_TYPE;
      if (body.blobPathnames?.length) {
        if (body.blobPathnames.length !== 1) return NextResponse.json({ error: "The VERA MVP reviews one title-report packet at a time." }, { status: 400 });
        cleanupPathnames = body.blobPathnames;
        const files = await filesFromPrivateBlobs(body.blobPathnames);
        exam = await examineFile(files[0], state, searchType);
      } else if (body.fixtureId) {
        const fixture = FIXTURES.find((item) => item.id === body.fixtureId);
        if (!fixture) return NextResponse.json({ error: "Unknown fixture" }, { status: 404 });
        exam = critique(await analyzeTextWithOpenAI(fixture.text, auditContext(state, searchType, fixture.name)));
      } else if (body.text?.trim()) {
        exam = critique(await analyzeTextWithOpenAI(body.text, auditContext(state, searchType, body.sourceFile || "pasted-text")));
      } else {
        return NextResponse.json({ error: "Provide one file, pasted text, fixtureId, or private upload pathname." }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: "Unsupported request format." }, { status: 415 });
    }

    return NextResponse.json({
      exam,
      exams: [exam],
      count: 1,
      openAIConfigured: true,
      documentModel: openAIDocumentModel(),
      verificationModel: process.env.OPENAI_VERIFY_MODEL || COST_MODEL,
      verificationPasses: 2,
      veraTemplate: "VERA v3",
      ruleVersion: AUDIT_RULE_VERSION,
      rcsOrderRulesLoaded: true,
      legalDescriptionProtocolLoaded: true,
      quickReferenceChecklistLoaded: true,
      costPolicy: "GPT-5.6 Luna only by default; no automatic Terra/Sol escalation.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Examine failed";
    const status = message.startsWith("Unsupported MVP search type:") ? 400 : 500;
    return NextResponse.json({ error: message, openAIConfigured: openAIDocumentIntelligenceConfigured() }, { status });
  } finally {
    await deletePrivateBlobs(cleanupPathnames);
  }
}
