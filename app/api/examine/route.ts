import { NextRequest, NextResponse } from "next/server";
import { critique } from "@/lib/critic";
import { FIXTURES } from "@/lib/fixtures";
import type { VeraExam } from "@/lib/vera";
import { isSupportedSearchType } from "@/lib/audit-rules";
import { analyzePdfWithOpenAI, analyzeTextWithOpenAI, openAIDocumentIntelligenceConfigured, openAIDocumentModel } from "@/lib/openai-document-intelligence";

export const runtime = "nodejs";
export const maxDuration = 300;

const COST_MODEL = "gpt-5.6-luna";
const DEFAULT_SEARCH_TYPE = "Foreclosure";

function applyCostPolicy() {
  const allowPremium = process.env.OPENAI_ALLOW_PREMIUM_MODEL === "true";
  const documentModel = process.env.OPENAI_DOCUMENT_MODEL;
  const verifyModel = process.env.OPENAI_VERIFY_MODEL;

  if (!documentModel || (!allowPremium && documentModel !== COST_MODEL)) {
    process.env.OPENAI_DOCUMENT_MODEL = COST_MODEL;
  }
  if (!verifyModel || (!allowPremium && verifyModel !== COST_MODEL)) {
    process.env.OPENAI_VERIFY_MODEL = COST_MODEL;
  }
}

applyCostPolicy();

function auditContext(state: string, searchType: string, sourceFile: string) {
  const normalizedSearchType = searchType.trim() || DEFAULT_SEARCH_TYPE;
  if (!isSupportedSearchType(normalizedSearchType)) {
    throw new Error(`Unsupported MVP search type: ${normalizedSearchType}. Use Foreclosure, 2nd Lien, or Current Owner Search.`);
  }
  return { state: state.trim().toUpperCase() || "TX", searchType: normalizedSearchType, sourceFile };
}

export async function GET() {
  return NextResponse.json({
    engine: "openai-multimodal-forensic",
    openAIConfigured: openAIDocumentIntelligenceConfigured(),
    documentModel: openAIDocumentModel(),
    verificationModel: process.env.OPENAI_VERIFY_MODEL || COST_MODEL,
    verificationPasses: 2,
    azureRequired: false,
    mvp: {
      onePacketPerReview: true,
      supportedSearchTypes: ["Foreclosure", "2nd Lien", "Current Owner Search"],
      veraTemplate: "VERA v3",
      rcsOrderRulesLoaded: true,
      legalDescriptionProtocolLoaded: false,
      quickReferenceChecklistLoaded: false,
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
  try {
    applyCostPolicy();
    if (!openAIDocumentIntelligenceConfigured()) {
      return NextResponse.json({
        error: "OpenAI forensic document intelligence is not configured yet. Add OPENAI_API_KEY to the Vercel project environment.",
        openAIConfigured: false,
      }, { status: 503 });
    }

    const ctype = req.headers.get("content-type") || "";
    const exams: VeraExam[] = [];

    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const files = form.getAll("files");
      const state = String(form.get("state") || "TX");
      const searchType = String(form.get("searchType") || DEFAULT_SEARCH_TYPE);
      if (!files.length) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
      if (files.length > 1) return NextResponse.json({ error: "The VERA MVP reviews one title-report packet at a time. Upload one packet." }, { status: 400 });

      const file = files[0];
      if (!(file instanceof File)) return NextResponse.json({ error: "The uploaded item is not a readable file." }, { status: 400 });
      const name = file.name || "upload";
      const context = auditContext(state, searchType, name);
      if (name.toLowerCase().endsWith(".pdf")) {
        exams.push(critique(await analyzePdfWithOpenAI(await file.arrayBuffer(), context)));
      } else {
        const text = await file.text();
        if (!text.trim()) return NextResponse.json({ error: `Could not read text from ${name}` }, { status: 422 });
        exams.push(critique(await analyzeTextWithOpenAI(text, context)));
      }
    } else if (ctype.includes("application/json")) {
      const body = (await req.json()) as { fixtureId?: string; text?: string; sourceFile?: string; state?: string; searchType?: string };
      const state = body.state || "TX";
      const searchType = body.searchType || DEFAULT_SEARCH_TYPE;
      if (body.fixtureId) {
        const fixture = FIXTURES.find((item) => item.id === body.fixtureId);
        if (!fixture) return NextResponse.json({ error: "Unknown fixture" }, { status: 404 });
        exams.push(critique(await analyzeTextWithOpenAI(fixture.text, auditContext(state, searchType, fixture.name))));
      } else if (body.text?.trim()) {
        exams.push(critique(await analyzeTextWithOpenAI(body.text, auditContext(state, searchType, body.sourceFile || "pasted-text"))));
      } else {
        return NextResponse.json({ error: "Provide one file, pasted text, or fixtureId" }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: "Unsupported request format." }, { status: 415 });
    }

    return NextResponse.json({
      exam: exams[0],
      exams,
      count: exams.length,
      openAIConfigured: true,
      documentModel: openAIDocumentModel(),
      verificationModel: process.env.OPENAI_VERIFY_MODEL || COST_MODEL,
      verificationPasses: 2,
      veraTemplate: "VERA v3",
      rcsOrderRulesLoaded: true,
      costPolicy: "GPT-5.6 Luna only by default; no automatic Terra/Sol escalation.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Examine failed";
    const status = message.startsWith("Unsupported MVP search type:") ? 400 : 500;
    return NextResponse.json({ error: message, openAIConfigured: openAIDocumentIntelligenceConfigured() }, { status });
  }
}
