import { AUDIT_DOCTRINE, AUTHORITATIVE_RULE_PACKS, CRITICAL_QUESTION_NUMBERS, REQUIRED_QUESTIONS } from "./audit-rules";
import { emptyVera, type AuditFinding, type EvidenceRef, type FieldEvidence, type FindingStatus, type PacketDocument, type PageEvidence, type VeraExam } from "./vera";

const OPENAI_API = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-5.6-sol";
const MAX_OUTPUT_TOKENS = 24000;

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

const evidenceSchema = { type: "object", additionalProperties: false, required: ["quote", "page", "documentType", "instrumentNumber"], properties: { quote: { type: "string" }, page: { type: "integer", minimum: 1 }, documentType: { type: "string" }, instrumentNumber: { type: "string" } } } as const;
const statusSchema = { type: "string", enum: ["UNDETERMINED", "PASS", "FAIL", "CANNOT_CONFIRM", "NOT_APPLICABLE", "NOT_STATED"] } as const;
const auditSchema = {
  type: "object", additionalProperties: false,
  required: ["header", "deed", "mortgages", "audit", "summaryEvidence", "findings", "pages", "documents", "manualReviewRequired", "extractionSummary", "notes"],
  properties: {
    header: { type: "object", additionalProperties: false, required: ["county", "clientOrder", "propertyAddress", "searchEffectiveDate", "minNumber", "parcelId", "landValue", "improvements", "taxStatus", "fiscalYear", "mobileHome", "condoHoa", "legalDescription"], properties: { county: { type: "string" }, clientOrder: { type: "string" }, propertyAddress: { type: "string" }, searchEffectiveDate: { type: "string" }, minNumber: { type: "string" }, parcelId: { type: "string" }, landValue: { type: "string" }, improvements: { type: "string" }, taxStatus: { type: "string" }, fiscalYear: { type: "string" }, mobileHome: { type: "string", enum: ["Yes", "No", "Not Provided"] }, condoHoa: { type: "string", enum: ["Applicable", "Not Applicable", "Not Provided"] }, legalDescription: { type: "string" } } },
    deed: { type: "object", additionalProperties: false, required: ["grantor", "grantee", "date", "bookPage", "instrument", "consideration"], properties: { grantor: { type: "string" }, grantee: { type: "string" }, date: { type: "string" }, bookPage: { type: "string" }, instrument: { type: "string" }, consideration: { type: "string" } } },
    mortgages: { type: "array", items: { type: "object", additionalProperties: false, required: ["index", "amount", "holder", "date", "bookPage", "instrument", "maturityDate"], properties: { index: { type: "integer", minimum: 1 }, amount: { type: "string" }, holder: { type: "string" }, date: { type: "string" }, bookPage: { type: "string" }, instrument: { type: "string" }, maturityDate: { type: "string" } } } },
    audit: { type: "object", additionalProperties: false, required: ["vestingDeed", "chainOfTitle", "mortgageInformation", "taxInformation", "judgmentsAndLiens", "easementsAndRestrictions"], properties: { vestingDeed: { type: "string" }, chainOfTitle: { type: "string" }, mortgageInformation: { type: "string" }, taxInformation: { type: "string" }, judgmentsAndLiens: { type: "string" }, easementsAndRestrictions: { type: "string" } } },
    summaryEvidence: { type: "array", items: { type: "object", additionalProperties: false, required: ["field", "value", "status", "evidence", "proofReason"], properties: { field: { type: "string" }, value: { type: "string" }, status: statusSchema, evidence: { type: "array", items: evidenceSchema }, proofReason: { type: "string" } } } },
    findings: { type: "array", minItems: 20, maxItems: 20, items: { type: "object", additionalProperties: false, required: ["number", "question", "critical", "response", "status", "evidence", "proofReason", "commentary"], properties: { number: { type: "integer", minimum: 1, maximum: 20 }, question: { type: "string" }, critical: { type: "boolean" }, response: { type: "string" }, status: statusSchema, evidence: { type: "array", items: evidenceSchema }, proofReason: { type: "string" }, commentary: { type: "string" } } } },
    pages: { type: "array", items: { type: "object", additionalProperties: false, required: ["page", "documentType", "excerpt", "visualReviewRequired"], properties: { page: { type: "integer", minimum: 1 }, documentType: { type: "string" }, excerpt: { type: "string" }, visualReviewRequired: { type: "boolean" } } } },
    documents: { type: "array", items: { type: "object", additionalProperties: false, required: ["documentType", "pageStart", "pageEnd", "instrumentNumber", "recordingDate", "excerpt"], properties: { documentType: { type: "string" }, pageStart: { type: "integer", minimum: 1 }, pageEnd: { type: "integer", minimum: 1 }, instrumentNumber: { type: "string" }, recordingDate: { type: "string" }, excerpt: { type: "string" } } } },
    manualReviewRequired: { type: "boolean" }, extractionSummary: { type: "string" }, notes: { type: "string" },
  },
} as const;

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OpenAI is not configured. Add OPENAI_API_KEY to the Vercel project.");
  return key;
}

export function openAIDocumentIntelligenceConfigured(): boolean { return Boolean(process.env.OPENAI_API_KEY); }
export function openAIDocumentModel(): string { return process.env.OPENAI_DOCUMENT_MODEL || DEFAULT_MODEL; }
function verifierModel(): string { return process.env.OPENAI_VERIFY_MODEL || process.env.OPENAI_DOCUMENT_MODEL || DEFAULT_MODEL; }

async function openAIFetch(url: string, init: RequestInit): Promise<Response> {
  let last: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, init);
    if (response.ok) return response;
    last = response;
    if (response.status !== 429 && response.status < 500) break;
    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
  }
  const body = last ? await last.text().catch(() => "") : "";
  throw new Error(`OpenAI request failed${last ? ` (${last.status})` : ""}${body ? `: ${body.slice(0, 500)}` : ""}`);
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

function doctrinePrompt(context: AuditContext, pass: "primary" | "verification"): string {
  const doctrine = Object.entries(AUDIT_DOCTRINE).map(([key, value]) => `- ${key}: ${value}`).join("\n");
  const questions = REQUIRED_QUESTIONS.map((question, index) => `${index + 1}. ${question}${CRITICAL_QUESTION_NUMBERS.has(index + 1) ? " [CRITICAL]" : ""}`).join("\n");
  return `You are the Cybrid Title forensic non-insured title report auditor.\n\nAUDIT CONTEXT\nState: ${context.state || "TX"}\nSearch Type: ${context.searchType || "General Search"}\nSource File: ${context.sourceFile}\nPass: ${pass === "primary" ? "PRIMARY FORENSIC AUDIT" : "INDEPENDENT VERIFICATION AUDIT"}\n\nNON-NEGOTIABLE DOCTRINE\n${doctrine}\n\nREQUIRED QUESTIONS\n${questions}\n\nOPERATING RULES\n- Reset context for this packet. Do not use facts from any other packet.\n- Read the entire supplied document, including scanned/image pages, tables, stamps, exhibits, legal descriptions, and recording data.\n- Treat page numbers as 1-based physical PDF page numbers.\n- Never infer a negative merely because a word is absent.\n- Every positive or negative factual conclusion must be tied to exact verbatim packet evidence. Keep quotes short but sufficient and preserve spelling/numbers.\n- If a field is not stated, write Not Stated or Not Provided rather than guessing.\n- For a referenced full deed, DOT, assignment, release, plat, HOA document, or other instrument that is needed for comparison but cannot be inspected, use CANNOT_CONFIRM.\n- PASS requires documentary proof or a true NOT_APPLICABLE condition. A missing quote cannot silently become PASS.\n- FAIL only for a quoted discrepancy/gap or a requirement established by the currently supplied rule doctrine. Do not invent state-law requirements.\n- MERS: a DOT naming MERS with a MIN does not require assignments solely because MERS is beneficiary.\n- HOA: if not referenced, NOT_APPLICABLE. Quote HOA name if referenced. Quote dues only if expressly stated.\n- Legal description: compare only descriptions actually supplied. Conflicting descriptions FAIL. Missing referenced comparison document = CANNOT_CONFIRM.\n- Run Sheet: audit in BOTH directions: every run-sheet recording to packet and every recorded packet document back to run sheet.\n- Typos: do not fail cosmetic spelling/spacing unless packet evidence shows legal impact under a loaded rule.\n- Plat: do not assume required. If referenced, verify inclusion.\n- Build a page/document inventory for the entire packet. For each page provide a short excerpt, not full-page transcription.\n- summaryEvidence must include evidence-backed entries for Client Order#, Property Address, Effective Date, MIN#, Parcel ID, Land Value, Improvements, Tax Status, Fiscal Year, Mobile Home, Condo/HOA, and Legal Description where those fields are stated.\n- Return EXACTLY 20 findings, numbered 1 through 20 once each.\n- Questions 4-12 and 17-20 are critical. The server independently determines overall PASS/FAIL from their statuses.\n- If page image/text is ambiguous, mark manualReviewRequired=true and use CANNOT_CONFIRM instead of choosing a convenient reading.\n- ${pass === "primary" ? "Perform the first complete forensic audit." : "Independently re-read the packet and challenge the first-pass outcome without assuming it was correct."}\n\nAuthoritative rule-pack status:\n${AUTHORITATIVE_RULE_PACKS.join("\n")}`;
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

async function responseAudit(args: { fileId?: string; text?: string; context: AuditContext; pass: "primary" | "verification"; model: string }): Promise<RawAudit> {
  const started = Date.now();
  const content: Array<Record<string, unknown>> = [{ type: "input_text", text: args.fileId ? "Audit the attached title-report packet." : `Audit this title-report text as Page 1:\n\n${args.text || ""}` }];
  if (args.fileId) content.push({ type: "input_file", file_id: args.fileId });

  const effort = args.pass === "primary" ? "medium" : "low";
  const response = await openAIFetch(`${OPENAI_API}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: args.model,
      store: false,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      reasoning: { effort },
      instructions: doctrinePrompt(args.context, args.pass),
      input: [{ role: "user", content }],
      text: { verbosity: "low", format: { type: "json_schema", name: "cybrid_forensic_title_audit", strict: true, schema: auditSchema } },
    }),
  });

  const data = await response.json();
  const text = extractOutputText(data);
  console.info("CYBRID_TITLE_MODEL_PASS", JSON.stringify({ pass: args.pass, model: args.model, effort, ms: Date.now() - started }));
  try {
    return JSON.parse(text) as RawAudit;
  } catch {
    throw new Error("OpenAI returned structured output that could not be parsed as the forensic audit schema.");
  }
}

function normalizeText(value: string): string { return (value || "").replace(/\s+/g, " ").trim().toLowerCase(); }

function uniqueEvidence(items: RawEvidence[]): EvidenceRef[] {
  const seen = new Set<string>();
  const out: EvidenceRef[] = [];
  for (const item of items || []) {
    const key = `${item.page}|${normalizeText(item.documentType)}|${normalizeText(item.quote)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ quote: item.quote || "Not Stated", page: Math.max(1, item.page || 1), documentType: item.documentType || "Unclassified", source: "openai-file", instrumentNumber: item.instrumentNumber && item.instrumentNumber !== "Not Stated" ? item.instrumentNumber : undefined });
  }
  return out;
}

function reconcileFieldEvidence(primary: RawFieldEvidence[], verification: RawFieldEvidence[], disagreements: string[]): FieldEvidence[] {
  const byField = new Map((verification || []).map((item) => [normalizeText(item.field), item]));
  return (primary || []).map((item) => {
    const other = byField.get(normalizeText(item.field));
    if (!other) return { ...item, evidence: uniqueEvidence(item.evidence || []) };
    const valueDiffers = normalizeText(item.value) !== normalizeText(other.value) && Boolean(normalizeText(item.value)) && Boolean(normalizeText(other.value));
    const status = item.status === other.status && !valueDiffers ? item.status : "CANNOT_CONFIRM";
    if (item.status !== other.status || valueDiffers) disagreements.push(`Summary field ${item.field} differed between model passes.`);
    return { field: item.field, value: valueDiffers ? `${item.value} / Verification: ${other.value}` : item.value, status, evidence: uniqueEvidence([...(item.evidence || []), ...(other.evidence || [])]), proofReason: normalizeText(item.proofReason) === normalizeText(other.proofReason) ? item.proofReason : `${item.proofReason} Verification: ${other.proofReason}` };
  });
}

function reconcileFindings(primary: RawFinding[], verification: RawFinding[], disagreements: string[]): AuditFinding[] {
  const p = new Map((primary || []).map((item) => [item.number, item]));
  const v = new Map((verification || []).map((item) => [item.number, item]));
  return REQUIRED_QUESTIONS.map((question, index) => {
    const number = index + 1;
    const a = p.get(number);
    const b = v.get(number);
    if (!a || !b) {
      disagreements.push(`Q${number} missing from one model pass.`);
      return { number, question, critical: CRITICAL_QUESTION_NUMBERS.has(number), response: "Cannot Confirm", status: "CANNOT_CONFIRM", evidence: uniqueEvidence([...(a?.evidence || []), ...(b?.evidence || [])]), proofReason: "Independent audit passes did not both return this required question.", commentary: "" };
    }
    if (a.status !== b.status) {
      disagreements.push(`Q${number} status disagreement: ${a.status} vs ${b.status}.`);
      return { number, question, critical: CRITICAL_QUESTION_NUMBERS.has(number), response: `${a.response} / Verification: ${b.response}`, status: "CANNOT_CONFIRM", evidence: uniqueEvidence([...(a.evidence || []), ...(b.evidence || [])]), proofReason: `Independent OpenAI audit passes disagreed. Primary: ${a.proofReason} Verification: ${b.proofReason}`, commentary: [a.commentary, b.commentary].filter(Boolean).join(" | ") };
    }
    return { number, question, critical: CRITICAL_QUESTION_NUMBERS.has(number), response: a.response, status: a.status, evidence: uniqueEvidence([...(a.evidence || []), ...(b.evidence || [])]), proofReason: normalizeText(a.proofReason) === normalizeText(b.proofReason) ? a.proofReason : `${a.proofReason} Verification: ${b.proofReason}`, commentary: [a.commentary, b.commentary].filter(Boolean).join(" | ") };
  });
}

function mergePages(primary: RawAudit["pages"], verification: RawAudit["pages"]): PageEvidence[] {
  const map = new Map<number, PageEvidence>();
  for (const page of [...(primary || []), ...(verification || [])]) {
    const existing = map.get(page.page);
    const documentType = existing && existing.documentType !== "Unclassified" ? existing.documentType : page.documentType || "Unclassified";
    const text = existing?.text || page.excerpt || "";
    map.set(page.page, { page: page.page, text, source: "openai-file", documentType });
  }
  return [...map.values()].sort((a, b) => a.page - b.page);
}

function mergeDocuments(primary: RawAudit["documents"], verification: RawAudit["documents"]): PacketDocument[] {
  const map = new Map<string, PacketDocument>();
  for (const doc of [...(primary || []), ...(verification || [])]) {
    const key = `${doc.pageStart}|${normalizeText(doc.documentType)}|${normalizeText(doc.instrumentNumber)}`;
    if (!map.has(key)) map.set(key, { documentType: doc.documentType || "Unclassified", pageStart: doc.pageStart, pageEnd: Math.max(doc.pageStart, doc.pageEnd), instrumentNumber: doc.instrumentNumber && doc.instrumentNumber !== "Not Stated" ? doc.instrumentNumber : undefined, recordingDate: doc.recordingDate && doc.recordingDate !== "Not Stated" ? doc.recordingDate : undefined, excerpt: doc.excerpt || "" });
  }
  return [...map.values()].sort((a, b) => a.pageStart - b.pageStart);
}

function q(findings: AuditFinding[], number: number): string { return findings.find((item) => item.number === number)?.response || "Not Provided"; }
function normalizeLoanDocumentType(value: string): VeraExam["loanDocumentType"] { const lower = value.toLowerCase(); if (lower.includes("deed of trust") || lower === "dot") return "Deed of Trust"; if (lower.includes("mortgage")) return "Mortgage"; if (lower.includes("not provided") || lower.includes("not stated") || lower.includes("cannot confirm")) return "Not Provided"; return "Other"; }
function normalizeLoanStatus(value: string): VeraExam["loanStatus"] { const lower = value.toLowerCase(); if (lower.includes("default")) return "Default"; if (lower.includes("satisfied") || lower.includes("released") || lower.includes("paid")) return "Satisfied"; if (lower.includes("active") || lower.includes("open") || lower.includes("current")) return "Active"; return "Not Provided"; }
function materiallyDifferent(a: string, b: string): boolean { const x = normalizeText(a), y = normalizeText(b); if (!x || !y || x.includes("not provided") || y.includes("not provided") || x.includes("not stated") || y.includes("not stated")) return false; return x !== y; }

function reconcile(primary: RawAudit, verification: RawAudit, context: AuditContext, primaryModel: string, verificationModel: string): VeraExam {
  const disagreements: string[] = [];
  const corePairs: Array<[string, string, string]> = [["County", primary.header.county, verification.header.county], ["Client Order", primary.header.clientOrder, verification.header.clientOrder], ["Property Address", primary.header.propertyAddress, verification.header.propertyAddress], ["Effective Date", primary.header.searchEffectiveDate, verification.header.searchEffectiveDate], ["MIN", primary.header.minNumber, verification.header.minNumber], ["Parcel ID", primary.header.parcelId, verification.header.parcelId], ["Legal Description", primary.header.legalDescription, verification.header.legalDescription], ["Deed Grantor", primary.deed.grantor, verification.deed.grantor], ["Deed Grantee", primary.deed.grantee, verification.deed.grantee], ["Deed Instrument", primary.deed.instrument, verification.deed.instrument]];
  for (const [label, a, b] of corePairs) if (materiallyDifferent(a, b)) disagreements.push(`${label} differed between model passes.`);

  const findings = reconcileFindings(primary.findings, verification.findings, disagreements);
  const summaryEvidence = reconcileFieldEvidence(primary.summaryEvidence, verification.summaryEvidence, disagreements);
  const pages = mergePages(primary.pages, verification.pages);
  const documents = mergeDocuments(primary.documents, verification.documents);
  const manualReviewRequired = primary.manualReviewRequired || verification.manualReviewRequired || disagreements.length > 0;

  return emptyVera({ state: context.state || "TX", county: primary.header.county || "Not Stated", searchType: context.searchType || "General Search", clientOrder: primary.header.clientOrder || "Not Provided", propertyAddress: primary.header.propertyAddress || "Not Provided", searchEffectiveDate: primary.header.searchEffectiveDate || "Not Provided", minNumber: primary.header.minNumber || "Not Provided", parcelId: primary.header.parcelId || "Not Provided", landValue: primary.header.landValue || "Not Provided", improvements: primary.header.improvements || "Not Provided", taxStatus: primary.header.taxStatus || "Not Provided", fiscalYear: primary.header.fiscalYear || "Not Provided", mobileHome: primary.header.mobileHome, condoHoa: primary.header.condoHoa, hoaPresent: q(findings, 1), ccrs: q(findings, 2), hoaNameAmounts: q(findings, 3), deedMortgageAccurate: q(findings, 4), deed: primary.deed, mortgages: primary.mortgages, recordingsAvailable: q(findings, 5), recordingsChronological: q(findings, 6), assignmentVesting: q(findings, 7), legalDescriptionConfirmed: q(findings, 8), legalDescription: primary.header.legalDescription || "Not Provided", originalBeneficiaryMers: q(findings, 9), federalTaxLien: q(findings, 10), documentReleases: q(findings, 11), propertySecuredAddressMatch: q(findings, 12), loanDocumentType: normalizeLoanDocumentType(q(findings, 13)), recordingDate: q(findings, 14), loanStatus: normalizeLoanStatus(q(findings, 15)), recourse: q(findings, 16), typosOrErrors: q(findings, 17), platMapLabeled: q(findings, 18), minInRunSheet: q(findings, 19), runSheetAccurate: q(findings, 20), audit: primary.audit, summaryEvidence, findings, pages, documents, manualReviewRequired, extractionSummary: `OpenAI multimodal forensic engine completed two independent passes (${primaryModel} + ${verificationModel}) over the supplied packet. ${disagreements.length ? `${disagreements.length} disagreement(s) were forced to manual review / Cannot Confirm where applicable.` : "The two passes agreed on all finding statuses and core extracted fields."}`, rulePackStatus: "VERA v3, RCS order rules, Quick Reference Checklist, and Legal Description Protocol loaded.", notes: [primary.notes, verification.notes, disagreements.length ? `Independent-pass disagreements: ${disagreements.join(" | ")}` : ""].filter(Boolean).join(" "), sourceFile: context.sourceFile, extractedAt: new Date().toISOString(), rawExcerpt: pages.map((page) => `P${page.page}: ${page.text}`).join("\n").slice(0, 1800) });
}

export async function analyzePdfWithOpenAI(buffer: ArrayBuffer, context: AuditContext): Promise<VeraExam> {
  const started = Date.now();
  const fileId = await uploadPdf(buffer, context.sourceFile);
  const primaryModel = openAIDocumentModel();
  const verificationModel = verifierModel();
  try {
    const [primary, verification] = await Promise.all([
      responseAudit({ fileId, context, pass: "primary", model: primaryModel }),
      responseAudit({ fileId, context, pass: "verification", model: verificationModel }),
    ]);
    console.info("CYBRID_TITLE_FORENSIC_COMPLETE", JSON.stringify({ sourceFile: context.sourceFile, ms: Date.now() - started, verificationPasses: 2 }));
    return reconcile(primary, verification, context, primaryModel, verificationModel);
  } finally {
    await deleteFile(fileId);
  }
}

export async function analyzeTextWithOpenAI(text: string, context: AuditContext): Promise<VeraExam> {
  const primaryModel = openAIDocumentModel();
  const verificationModel = verifierModel();
  const [primary, verification] = await Promise.all([
    responseAudit({ text, context, pass: "primary", model: primaryModel }),
    responseAudit({ text, context, pass: "verification", model: verificationModel }),
  ]);
  return reconcile(primary, verification, context, primaryModel, verificationModel);
}
