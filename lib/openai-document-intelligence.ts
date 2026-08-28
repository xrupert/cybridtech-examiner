import { AUDIT_DOCTRINE, AUTHORITATIVE_RULE_PACKS, CRITICAL_QUESTION_NUMBERS, REQUIRED_QUESTIONS } from "./audit-rules";
import { emptyVera, type AuditFinding, type EvidenceRef, type FieldEvidence, type FindingStatus, type PacketDocument, type PageEvidence, type VeraExam } from "./vera";

const OPENAI_API = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-5.6-sol";
const MAX_OUTPUT_TOKENS = 12000;

type AuditContext = { state: string; searchType: string; sourceFile: string };
type RawEvidence = { quote: string; page: number; documentType: string; instrumentNumber: string };
type RawFieldEvidence = { field: string; value: string; status: FindingStatus; evidence: RawEvidence[]; proofReason: string };
type RawFinding = { number: number; question: string; critical: boolean; response: string; status: FindingStatus; evidence: RawEvidence[]; proofReason: string; commentary: string };
type RawAudit = {
  header: { county: string; clientOrder: string; propertyAddress: string; searchEffectiveDate: string; minNumber: string; parcelId: string; landValue: string; improvements: string; taxStatus: string; fiscalYear: string; mobileHome: "Yes" | "No" | "Not Provided"; condoHoa: "Applicable" | "Not Applicable" | "Not Provided"; legalDescription: string };
  deed: { grantor: string; grantee: string; date: string; bookPage: string; instrument: string; consideration: string };
  mortgages: Array<{ index: number; amount: string; holder: string; date: string; bookPage: string; instrument: string; maturityDate: string }>;
  audit: { vestingDeed: string; chainOfTitle: string; mortgageInformation: string; taxInformation: string; judgmentsAndLiens: string; easementsAndRestrictions: string };
  summaryEvidence: RawFieldEvidence[];
  findings: RawFinding[];
  pages: Array<{ page: number; documentType: string; excerpt: string; visualReviewRequired: boolean }>;
  documents: Array<{ documentType: string; pageStart: number; pageEnd: number; instrumentNumber: string; recordingDate: string; excerpt: string }>;
  manualReviewRequired: boolean;
  extractionSummary: string;
  notes: string;
};

const evidenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["quote", "page", "documentType", "instrumentNumber"],
  properties: {
    quote: { type: "string" },
    page: { type: "integer", minimum: 1 },
    documentType: { type: "string" },
    instrumentNumber: { type: "string" },
  },
} as const;

const statusSchema = { type: "string", enum: ["UNDETERMINED", "PASS", "FAIL", "CANNOT_CONFIRM", "NOT_APPLICABLE", "NOT_STATED"] } as const;

const auditSchema = {
  type: "object",
  additionalProperties: false,
  required: ["header", "deed", "mortgages", "audit", "summaryEvidence", "findings", "pages", "documents", "manualReviewRequired", "extractionSummary", "notes"],
  properties: {
    header: {
      type: "object",
      additionalProperties: false,
      required: ["county", "clientOrder", "propertyAddress", "searchEffectiveDate", "minNumber", "parcelId", "landValue", "improvements", "taxStatus", "fiscalYear", "mobileHome", "condoHoa", "legalDescription"],
      properties: {
        county: { type: "string" }, clientOrder: { type: "string" }, propertyAddress: { type: "string" }, searchEffectiveDate: { type: "string" }, minNumber: { type: "string" }, parcelId: { type: "string" }, landValue: { type: "string" }, improvements: { type: "string" }, taxStatus: { type: "string" }, fiscalYear: { type: "string" }, mobileHome: { type: "string", enum: ["Yes", "No", "Not Provided"] }, condoHoa: { type: "string", enum: ["Applicable", "Not Applicable", "Not Provided"] }, legalDescription: { type: "string" },
      },
    },
    deed: {
      type: "object",
      additionalProperties: false,
      required: ["grantor", "grantee", "date", "bookPage", "instrument", "consideration"],
      properties: { grantor: { type: "string" }, grantee: { type: "string" }, date: { type: "string" }, bookPage: { type: "string" }, instrument: { type: "string" }, consideration: { type: "string" } },
    },
    mortgages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "amount", "holder", "date", "bookPage", "instrument", "maturityDate"],
        properties: { index: { type: "integer", minimum: 1 }, amount: { type: "string" }, holder: { type: "string" }, date: { type: "string" }, bookPage: { type: "string" }, instrument: { type: "string" }, maturityDate: { type: "string" } },
      },
    },
    audit: {
      type: "object",
      additionalProperties: false,
      required: ["vestingDeed", "chainOfTitle", "mortgageInformation", "taxInformation", "judgmentsAndLiens", "easementsAndRestrictions"],
      properties: { vestingDeed: { type: "string" }, chainOfTitle: { type: "string" }, mortgageInformation: { type: "string" }, taxInformation: { type: "string" }, judgmentsAndLiens: { type: "string" }, easementsAndRestrictions: { type: "string" } },
    },
    summaryEvidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "value", "status", "evidence", "proofReason"],
        properties: { field: { type: "string" }, value: { type: "string" }, status: statusSchema, evidence: { type: "array", items: evidenceSchema }, proofReason: { type: "string" } },
      },
    },
    findings: {
      type: "array",
      minItems: 20,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["number", "question", "critical", "response", "status", "evidence", "proofReason", "commentary"],
        properties: { number: { type: "integer", minimum: 1, maximum: 20 }, question: { type: "string" }, critical: { type: "boolean" }, response: { type: "string" }, status: statusSchema, evidence: { type: "array", items: evidenceSchema }, proofReason: { type: "string" }, commentary: { type: "string" } },
      },
    },
    pages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["page", "documentType", "excerpt", "visualReviewRequired"],
        properties: { page: { type: "integer", minimum: 1 }, documentType: { type: "string" }, excerpt: { type: "string" }, visualReviewRequired: { type: "boolean" } },
      },
    },
    documents: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["documentType", "pageStart", "pageEnd", "instrumentNumber", "recordingDate", "excerpt"],
        properties: { documentType: { type: "string" }, pageStart: { type: "integer", minimum: 1 }, pageEnd: { type: "integer", minimum: 1 }, instrumentNumber: { type: "string" }, recordingDate: { type: "string" }, excerpt: { type: "string" } },
      },
    },
    manualReviewRequired: { type: "boolean" },
    extractionSummary: { type: "string" },
    notes: { type: "string" },
  },
} as const;

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OpenAI is not configured. Add OPENAI_API_KEY to the Vercel project.");
  return key;
}

export function openAIDocumentIntelligenceConfigured(): boolean { return Boolean(process.env.OPENAI_API_KEY); }
export function openAIDocumentModel(): string { return process.env.OPENAI_DOCUMENT_MODEL || DEFAULT_MODEL; }

function retryDelayMs(response: Response): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(15000, Math.max(1000, seconds * 1000));
  }
  return 2500;
}

async function openAIFetch(url: string, init: RequestInit): Promise<Response> {
  let response = await fetch(url, init);
  if (response.ok) return response;

  if (response.status === 429 || response.status >= 500) {
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response)));
    response = await fetch(url, init);
    if (response.ok) return response;
  }

  const body = await response.text().catch(() => "");
  throw new Error(`OpenAI request failed (${response.status})${body ? `: ${body.slice(0, 1200)}` : ""}`);
}

async function uploadPdf(buffer: ArrayBuffer, filename: string): Promise<string> {
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("expires_after[anchor]", "created_at");
  form.append("expires_after[seconds]", "3600");
  form.append("file", new Blob([buffer], { type: "application/pdf" }), filename);
  const response = await openAIFetch(`${OPENAI_API}/files`, { method: "POST", headers: { Authorization: `Bearer ${apiKey()}` }, body: form });
  const data = await response.json() as { id?: string };
  if (!data.id) throw new Error("OpenAI accepted the PDF upload but did not return a file id.");
  return data.id;
}

async function deleteFile(fileId: string): Promise<void> {
  try {
    await fetch(`${OPENAI_API}/files/${fileId}`, { method: "DELETE", headers: { Authorization: `Bearer ${apiKey()}` } });
  } catch {
    // Cleanup failure must not erase a completed audit.
  }
}

function doctrinePrompt(context: AuditContext): string {
  const doctrine = Object.entries(AUDIT_DOCTRINE).map(([key, value]) => `- ${key}: ${value}`).join("\n");
  const questions = REQUIRED_QUESTIONS.map((question, index) => `${index + 1}. ${question}${CRITICAL_QUESTION_NUMBERS.has(index + 1) ? " [CRITICAL]" : ""}`).join("\n");

  return `You are Cybrid Title's forensic non-insured title report auditor. Complete the review in ONE full-packet pass. Before returning your final structured answer, internally self-check every proposed FAIL and every critical PASS against the packet again.\n\nAUDIT CONTEXT\nState: ${context.state || "TX"}\nRCS Order Type: ${context.searchType || "General Search"}\nSource File: ${context.sourceFile}\n\nNON-NEGOTIABLE DOCTRINE\n${doctrine}\n\nREQUIRED QUESTIONS\n${questions}\n\nOPERATING RULES\n- Read the ENTIRE supplied packet, including scans/images, tables, stamps, exhibits, legal descriptions, assessor/tax pages, bankruptcy/PACER material, recorded instruments, and report/run-sheet summary pages.\n- Treat page numbers as 1-based physical PDF page numbers.\n- Never infer a negative merely because a word is absent. Missing information is a defect only when explicitly referenced or required by a loaded rule.\n- Every supported PASS or FAIL must cite at least one short exact packet quote with physical PDF page and document type.\n- If a referenced comparison document is missing or unreadable, use CANNOT_CONFIRM.\n- Cross-check report/run-sheet values against supporting documents CHARACTER BY CHARACTER where material: dates, years, amounts, party names, parcel IDs, book/page, instrument numbers, legal-description bearings/distances, lien data, and addresses.\n- Specifically reconcile summary tax values against assessor/tax attachments; bankruptcy-search conclusions against any included bankruptcy/PACER results; and every referenced assignment/release against the actual included instrument.\n- For chain and assignment review, identify a referenced-but-missing assignment or release rather than silently accepting later holder language.\n- For recording data, distinguish document date, execution date, recording date, book/page, and instrument number. Flag transposed digits, wrong years, or mismatched book/page references when supported by packet evidence.\n- MERS: a DOT naming MERS with a MIN does not require assignments solely because MERS is beneficiary. If MERS is not identified, do not invent it.\n- HOA: if not referenced and not required by the selected order type, mark NOT_APPLICABLE. Quote HOA name/amount only if expressly stated.\n- Legal description: apply the loaded Legal Description Compliance Protocol. Compare all supplied deed/DOT/report descriptions, including small bearing/distance/symbol differences. Material differences FAIL; uncertain or missing referenced sources CANNOT_CONFIRM.\n- Run Sheet: audit bidirectionally only if an identifiable run sheet/report recording list is actually supplied. If no separate run sheet exists, say so rather than inventing one.\n- Apply the selected RCS order-type packaging requirements. Do not call expected RCS category ordering a chronological defect merely because the whole PDF is not globally date-sorted.\n- Typos: flag material legal/recording errors and meaningful contradictions. Ignore harmless formatting.\n- Return EXACTLY 20 findings numbered 1-20.\n- Questions 4-12 and 17-20 are critical. The server independently computes the final verdict after enforcing evidence requirements.\n- pages: DO NOT return one entry per page. Return only pages actually cited in findings/summary or pages requiring manual visual review. This keeps output compact while still requiring you to read the entire packet.\n- documents: return one concise entry per distinct important recorded/supporting instrument, not one per page.\n- summaryEvidence: include source-backed entries for the VERA summary/property/tax fields when stated.\n- Keep responses concise but specific enough to identify the discrepancy and the correct packet value.\n\nAUTHORITATIVE RULE PACKS\n${AUTHORITATIVE_RULE_PACKS.join("\n")}`;
}

function extractOutputText(data: unknown): string {
  const payload = data as { output_text?: string; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  for (const item of payload.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new Error("OpenAI completed the audit but returned no structured output text.");
}

async function responseAudit(args: { fileId?: string; text?: string; context: AuditContext; model: string }): Promise<RawAudit> {
  const started = Date.now();
  const content: Array<Record<string, unknown>> = [{ type: "input_text", text: args.fileId ? "Review the attached title packet now and return the final VERA audit." : `Review this title-report text as Page 1:\n\n${args.text || ""}` }];
  if (args.fileId) content.push({ type: "input_file", file_id: args.fileId });

  const response = await openAIFetch(`${OPENAI_API}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: args.model,
      store: false,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      reasoning: { effort: "low" },
      instructions: doctrinePrompt(args.context),
      input: [{ role: "user", content }],
      text: { verbosity: "low", format: { type: "json_schema", name: "cybrid_forensic_title_audit", strict: true, schema: auditSchema } },
    }),
  });

  const data = await response.json() as {
    output_text?: string;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  };
  const text = extractOutputText(data);
  console.info("CYBRID_TITLE_MODEL_PASS", JSON.stringify({
    pass: "single-full-packet",
    model: args.model,
    effort: "low",
    ms: Date.now() - started,
    inputTokens: data.usage?.input_tokens,
    outputTokens: data.usage?.output_tokens,
    totalTokens: data.usage?.total_tokens,
  }));

  try {
    return JSON.parse(text) as RawAudit;
  } catch {
    throw new Error("OpenAI returned structured output that could not be parsed as the forensic audit schema.");
  }
}

function normalizeText(value: string): string { return (value || "").replace(/\s+/g, " ").trim().toLowerCase(); }

function uniqueEvidence(items: RawEvidence[], sourceFile: string): EvidenceRef[] {
  const seen = new Set<string>();
  const out: EvidenceRef[] = [];
  for (const item of items || []) {
    const key = `${item.page}|${normalizeText(item.documentType)}|${normalizeText(item.quote)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      quote: item.quote || "Not Stated",
      page: Math.max(1, item.page || 1),
      documentType: item.documentType || "Unclassified",
      source: "openai-file",
      sourceFile,
      instrumentNumber: item.instrumentNumber && item.instrumentNumber !== "Not Stated" ? item.instrumentNumber : undefined,
    });
  }
  return out;
}

function mapFindings(raw: RawFinding[], sourceFile: string): AuditFinding[] {
  const byNumber = new Map((raw || []).map((item) => [item.number, item]));
  return REQUIRED_QUESTIONS.map((question, index) => {
    const number = index + 1;
    const item = byNumber.get(number);
    if (!item) {
      return {
        number,
        question,
        critical: CRITICAL_QUESTION_NUMBERS.has(number),
        response: "Cannot Confirm",
        status: "CANNOT_CONFIRM",
        evidence: [],
        proofReason: "The model did not return this required VERA finding.",
        commentary: "Server structural gate supplied the missing question.",
      };
    }
    return {
      number,
      question,
      critical: CRITICAL_QUESTION_NUMBERS.has(number),
      response: item.response || "Not Provided",
      status: item.status,
      evidence: uniqueEvidence(item.evidence || [], sourceFile),
      proofReason: item.proofReason || "Not Stated",
      commentary: item.commentary || "",
    };
  });
}

function mapSummaryEvidence(raw: RawFieldEvidence[], sourceFile: string): FieldEvidence[] {
  return (raw || []).map((item) => ({
    field: item.field,
    value: item.value,
    status: item.status,
    evidence: uniqueEvidence(item.evidence || [], sourceFile),
    proofReason: item.proofReason,
  }));
}

function mapPages(raw: RawAudit["pages"]): PageEvidence[] {
  const map = new Map<number, PageEvidence>();
  for (const page of raw || []) {
    if (!page.page || page.page < 1) continue;
    if (!map.has(page.page)) map.set(page.page, { page: page.page, text: page.excerpt || "", source: "openai-file", documentType: page.documentType || "Unclassified" });
  }
  return [...map.values()].sort((a, b) => a.page - b.page);
}

function mapDocuments(raw: RawAudit["documents"]): PacketDocument[] {
  return (raw || []).map((doc) => ({
    documentType: doc.documentType || "Unclassified",
    pageStart: Math.max(1, doc.pageStart || 1),
    pageEnd: Math.max(doc.pageStart || 1, doc.pageEnd || doc.pageStart || 1),
    instrumentNumber: doc.instrumentNumber && doc.instrumentNumber !== "Not Stated" ? doc.instrumentNumber : undefined,
    recordingDate: doc.recordingDate && doc.recordingDate !== "Not Stated" ? doc.recordingDate : undefined,
    excerpt: doc.excerpt || "",
  })).sort((a, b) => a.pageStart - b.pageStart);
}

function q(findings: AuditFinding[], number: number): string { return findings.find((item) => item.number === number)?.response || "Not Provided"; }

function normalizeLoanDocumentType(value: string): VeraExam["loanDocumentType"] {
  const lower = value.toLowerCase();
  if (lower.includes("deed of trust") || lower === "dot") return "Deed of Trust";
  if (lower.includes("mortgage")) return "Mortgage";
  if (lower.includes("not provided") || lower.includes("not stated") || lower.includes("cannot confirm")) return "Not Provided";
  return "Other";
}

function normalizeLoanStatus(value: string): VeraExam["loanStatus"] {
  const lower = value.toLowerCase();
  if (lower.includes("default") || lower.includes("foreclos")) return "Default";
  if (lower.includes("satisfied") || lower.includes("released") || lower.includes("paid")) return "Satisfied";
  if (lower.includes("active") || lower.includes("open") || lower.includes("current")) return "Active";
  return "Not Provided";
}

function finalize(raw: RawAudit, context: AuditContext, model: string): VeraExam {
  const findings = mapFindings(raw.findings, context.sourceFile);
  const pages = mapPages(raw.pages);
  const documents = mapDocuments(raw.documents);

  return emptyVera({
    state: context.state || "TX",
    county: raw.header.county || "Not Stated",
    searchType: context.searchType || "Foreclosure",
    clientOrder: raw.header.clientOrder || "Not Provided",
    propertyAddress: raw.header.propertyAddress || "Not Provided",
    searchEffectiveDate: raw.header.searchEffectiveDate || "Not Provided",
    minNumber: raw.header.minNumber || "Not Provided",
    parcelId: raw.header.parcelId || "Not Provided",
    landValue: raw.header.landValue || "Not Provided",
    improvements: raw.header.improvements || "Not Provided",
    taxStatus: raw.header.taxStatus || "Not Provided",
    fiscalYear: raw.header.fiscalYear || "Not Provided",
    mobileHome: raw.header.mobileHome,
    condoHoa: raw.header.condoHoa,
    hoaPresent: q(findings, 1),
    ccrs: q(findings, 2),
    hoaNameAmounts: q(findings, 3),
    deedMortgageAccurate: q(findings, 4),
    deed: raw.deed,
    mortgages: raw.mortgages,
    recordingsAvailable: q(findings, 5),
    recordingsChronological: q(findings, 6),
    assignmentVesting: q(findings, 7),
    legalDescriptionConfirmed: q(findings, 8),
    legalDescription: raw.header.legalDescription || "Not Provided",
    originalBeneficiaryMers: q(findings, 9),
    federalTaxLien: q(findings, 10),
    documentReleases: q(findings, 11),
    propertySecuredAddressMatch: q(findings, 12),
    loanDocumentType: normalizeLoanDocumentType(q(findings, 13)),
    recordingDate: q(findings, 14),
    loanStatus: normalizeLoanStatus(q(findings, 15)),
    recourse: q(findings, 16),
    typosOrErrors: q(findings, 17),
    platMapLabeled: q(findings, 18),
    minInRunSheet: q(findings, 19),
    runSheetAccurate: q(findings, 20),
    audit: raw.audit,
    summaryEvidence: mapSummaryEvidence(raw.summaryEvidence, context.sourceFile),
    findings,
    pages,
    documents,
    manualReviewRequired: raw.manualReviewRequired,
    extractionSummary: `${model} completed one full-packet forensic audit. Cybrid Title then applies its deterministic evidence/structure critic before any final PASS/FAIL is accepted.`,
    rulePackStatus: "VERA v3 + RCS Foreclosure/2nd Lien/Current Owner rules + Quick Reference Checklist + Legal Description Compliance Protocol loaded.",
    notes: raw.notes || raw.extractionSummary || "",
    sourceFile: context.sourceFile,
    extractedAt: new Date().toISOString(),
    rawExcerpt: pages.map((page) => `P${page.page}: ${page.text}`).join("\n").slice(0, 1800),
  });
}

export async function analyzePdfWithOpenAI(buffer: ArrayBuffer, context: AuditContext): Promise<VeraExam> {
  const overallStarted = Date.now();
  const uploadStarted = Date.now();
  const fileId = await uploadPdf(buffer, context.sourceFile);
  console.info("CYBRID_TITLE_FILE_UPLOAD", JSON.stringify({ sourceFile: context.sourceFile, ms: Date.now() - uploadStarted }));
  const model = openAIDocumentModel();

  try {
    const raw = await responseAudit({ fileId, context, model });
    const exam = finalize(raw, context, model);
    console.info("CYBRID_TITLE_FORENSIC_COMPLETE", JSON.stringify({ sourceFile: context.sourceFile, model, modelPasses: 1, ms: Date.now() - overallStarted }));
    return exam;
  } finally {
    await deleteFile(fileId);
  }
}

export async function analyzeTextWithOpenAI(text: string, context: AuditContext): Promise<VeraExam> {
  const started = Date.now();
  const model = openAIDocumentModel();
  const raw = await responseAudit({ text, context, model });
  const exam = finalize(raw, context, model);
  console.info("CYBRID_TITLE_FORENSIC_COMPLETE", JSON.stringify({ sourceFile: context.sourceFile, model, modelPasses: 1, ms: Date.now() - started }));
  return exam;
}
