import { NextRequest, NextResponse } from "next/server";
import { critique } from "@/lib/critic";
import { FIXTURES } from "@/lib/fixtures";
import type { VeraExam } from "@/lib/vera";
import { analyzePdfWithOpenAI, analyzeTextWithOpenAI, openAIDocumentIntelligenceConfigured, openAIDocumentModel } from "@/lib/openai-document-intelligence";

export const runtime = "nodejs";
export const maxDuration = 300;

const COST_MODEL = "gpt-5.6-luna";

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
  return { state: state.trim().toUpperCase() || "TX", searchType: searchType.trim() || "General Search", sourceFile };
}

export async function GET() {
  return NextResponse.json({
    engine: "openai-multimodal-forensic",
    openAIConfigured: openAIDocumentIntelligenceConfigured(),
    documentModel: openAIDocumentModel(),
    verificationModel: process.env.OPENAI_VERIFY_MODEL || COST_MODEL,
    verificationPasses: 2,
    azureRequired: false,
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
      const searchType = String(form.get("searchType") || "General Search");
      if (!files.length) return NextResponse.json({ error: "No files uploaded" }, { status: 400 });

      for (const file of files) {
        if (!(file instanceof File)) continue;
        const name = file.name || "upload";
        const context = auditContext(state, searchType, name);
        if (name.toLowerCase().endsWith(".pdf")) {
          exams.push(critique(await analyzePdfWithOpenAI(await file.arrayBuffer(), context)));
        } else {
          const text = await file.text();
          if (!text.trim()) return NextResponse.json({ error: `Could not read text from ${name}` }, { status: 422 });
          exams.push(critique(await analyzeTextWithOpenAI(text, context)));
        }
      }
    } else {
      const body = (await req.json()) as { fixtureId?: string; text?: string; sourceFile?: string; state?: string; searchType?: string };
      const state = body.state || "TX";
      const searchType = body.searchType || "General Search";
      if (body.fixtureId) {
        const fixture = FIXTURES.find((item) => item.id === body.fixtureId);
        if (!fixture) return NextResponse.json({ error: "Unknown fixture" }, { status: 404 });
        exams.push(critique(await analyzeTextWithOpenAI(fixture.text, auditContext(state, searchType, fixture.name))));
      } else if (body.text?.trim()) {
        exams.push(critique(await analyzeTextWithOpenAI(body.text, auditContext(state, searchType, body.sourceFile || "pasted-text"))));
      } else {
        return NextResponse.json({ error: "Provide files, text, or fixtureId" }, { status: 400 });
      }
    }

    return NextResponse.json({
      exam: exams[0],
      exams,
      count: exams.length,
      openAIConfigured: true,
      documentModel: openAIDocumentModel(),
      verificationModel: process.env.OPENAI_VERIFY_MODEL || COST_MODEL,
      verificationPasses: 2,
      costPolicy: "GPT-5.6 Luna only by default; no automatic Terra/Sol escalation.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Examine failed";
    return NextResponse.json({ error: message, openAIConfigured: openAIDocumentIntelligenceConfigured() }, { status: 500 });
  }
}
