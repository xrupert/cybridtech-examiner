import type { QcProfileResult, QcStatus, CanonicalTitleRecord } from "./title-domain";
import type { TitleEvidenceLedger } from "./title-extraction-model";
import type { CheckerResolution } from "./canonical-qc-engine";
import { validateEvidenceIds } from "./title-evidence-ledger";

const OPENAI_API = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-5.6-sol";
const MAX_OUTPUT_TOKENS = 7000;

const checkerSchema = {
  type: "object", additionalProperties: false, required: ["resolutions"],
  properties: { resolutions: { type: "array", items: { type: "object", additionalProperties: false, required: ["checkId", "status", "summary", "evidenceIds"], properties: { checkId: { type: "string" }, status: { type: "string", enum: ["PASS", "FAIL", "CANNOT_CONFIRM", "NOT_APPLICABLE"] }, summary: { type: "string" }, evidenceIds: { type: "array", items: { type: "string" } } } } } },
} as const;

function apiKey(): string { const key = process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY; if (!key) throw new Error("OpenAI is not configured for title checking."); return key; }
function checkerModel(): string { return process.env.OPENAI_CHECK_MODEL || process.env.OPENAI_REVIEW_MODEL || DEFAULT_MODEL; }
function retryDelayMs(response: Response): number { const retryAfter = response.headers.get("retry-after"); const seconds = retryAfter ? Number(retryAfter) : NaN; return Number.isFinite(seconds) ? Math.min(15000, Math.max(1000, seconds * 1000)) : 2500; }
async function openAIFetch(url: string, init: RequestInit): Promise<Response> {
  let response = await fetch(url, init); if (response.ok) return response;
  if (response.status === 429 || response.status >= 500) { await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response))); response = await fetch(url, init); if (response.ok) return response; }
  const body = await response.text().catch(() => ""); throw new Error(`OpenAI title checker failed (${response.status})${body ? `: ${body.slice(0, 1200)}` : ""}`);
}
function extractOutputText(data: unknown): string {
  const payload = data as { output_text?: string; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> };
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  for (const item of payload.output || []) { if (item.type !== "message") continue; for (const content of item.content || []) if (content.type === "output_text" && typeof content.text === "string") return content.text; }
  throw new Error("OpenAI title checker returned no structured output.");
}

function compactRecord(record: CanonicalTitleRecord) {
  const v = (field: { value: string; state: string; evidenceIds?: string[] }) => ({ value: field.value, state: field.state, evidenceIds: field.evidenceIds || [] });
  const summary = (value: CanonicalTitleRecord["titleSummary"]) => ({
    detected: value.detected, confidence: value.confidence, pageStart: value.pageStart, pageEnd: value.pageEnd, basis: value.basis,
    entries: value.entries.map((entry) => ({ id: entry.id, category: entry.category, instrumentType: entry.instrumentType, instrumentNumber: entry.instrumentNumber, bookPage: entry.bookPage, documentDate: entry.documentDate, recordingDate: entry.recordingDate, amount: entry.amount, parties: entry.parties, legalDescription: entry.legalDescription, evidenceIds: entry.evidenceIds || [] })),
    evidenceIds: value.evidenceIds || [],
  });
  return {
    orderNumber: v(record.orderNumber), orderType: v(record.orderType), effectiveDate: v(record.effectiveDate), state: v(record.state), county: v(record.county), propertyAddress: v(record.propertyAddress), parcelId: v(record.parcelId), borrower: v(record.borrower), currentOwner: v(record.currentOwner), legalDescription: v(record.legalDescription),
    titleSummary: summary(record.titleSummary),
    distinctRunSheet: summary(record.runSheet),
    instruments: record.instruments.map((instrument) => ({ id: instrument.id, type: instrument.type, instrumentNumber: instrument.instrumentNumber, bookPage: instrument.bookPage, documentDate: instrument.documentDate, recordingDate: instrument.recordingDate, amount: instrument.amount, status: instrument.status, parties: instrument.parties.map((party) => ({ name: party.name, role: party.role })), propertyAddress: instrument.propertyAddress, legalDescription: instrument.legalDescription, referencedInstrumentNumbers: instrument.referencedInstrumentNumbers, evidenceIds: instrument.evidenceIds || [] })),
    references: record.references.map((reference) => ({ description: reference.description, documentType: reference.documentType, instrumentNumber: reference.instrumentNumber, bookPage: reference.bookPage, evidenceIds: reference.evidenceIds || [] })),
    flags: Object.fromEntries(Object.entries(record.flags).map(([key, value]) => [key, v(value)])),
    targetLien: { instrumentId: record.targetLien.instrumentId, instrumentNumber: v(record.targetLien.instrumentNumber), amount: v(record.targetLien.amount), beneficiary: v(record.targetLien.beneficiary), position: v(record.targetLien.position), selectionRequired: record.targetLien.selectionRequired },
  };
}

function instructions(profile: QcProfileResult, unresolved: QcProfileResult["checks"]): string {
  return `You are the CHECK stage of Cybrid Title. You are NOT reading the original PDF. The packet has already been extracted into a canonical title record and immutable evidence ledger. Resolve only the listed unresolved checks from those facts and evidence nodes.

NON-NEGOTIABLE
- Do not invent facts, quotes, pages, instruments, dates, amounts, relationships, or evidence IDs.
- evidenceIds may contain ONLY IDs supplied in EVIDENCE LEDGER.
- PASS or FAIL requires one or more directly supporting evidence IDs. If evidence is insufficient, return CANNOT_CONFIRM.
- NOT_APPLICABLE is allowed only when the selected order profile makes the check genuinely inapplicable.
- Do not infer lien priority from document sequence.
- Do not treat global PDF page order as recording order.
- MERS: a mortgage/DOT naming MERS with a MIN does not create an assignment requirement solely because MERS is beneficiary.
- Legal-description formatting-only differences are not material. Changed/omitted legal calls or controlling references may be material when supported.
- Missing referenced source documents remain CANNOT_CONFIRM; absence is not negative proof.

TITLE REPORT VS RUN SHEET
- canonicalRecord.titleSummary is the opening TITLE REPORT / TITLE SEARCH SUMMARY used for report-to-source accuracy review.
- canonicalRecord.distinctRunSheet is ONLY a separately identifiable Run Sheet or Abstractor Sheet.
- Never call the title report a Run Sheet. If distinctRunSheet.detected=false, Run Sheet checks are N/A and should already have been closed deterministically.

RCS CURRENT OWNER SEARCH
When PROFILE is RCS Current Owner:
- PRIOR_OWNER_ESTABLISHED is a compatibility ID whose LABEL controls its meaning: confirm a qualifying non-family FULL VALUE DEED (FVD), with recording date, transfer/sale amount, and vesting. Do NOT demand a second deed merely because this historical ID says PRIOR_OWNER.
- The current-owner vesting deed itself can satisfy the look-back if packet evidence establishes it as the qualifying FVD.
- OWNERSHIP_CHAIN_COMPLETE is a compatibility ID whose LABEL controls its Current Owner meaning: the qualifying FVD must have a concurrently filed purchase-money mortgage with an institutional lender unless instructions state otherwise.
- A same-day recorded deed and institutional mortgage may satisfy the concurrent-PMM rule when evidence ties them to the same transfer/property. Do not infer facts not in evidence.
- Evidence explicitly saying the order was completed with the current-owner FVD is relevant and should be considered with the source deed and assessor/sales evidence.

PROFILE
${profile.profileName} v${profile.profileVersion}

UNRESOLVED CHECKS
${unresolved.map((check) => `- ${check.id}: ${check.label}\n  Current reason: ${check.summary}`).join("\n")}`;
}

function strongEvidence(ledger: TitleEvidenceLedger, ids: string[]): boolean {
  if (!ids.length || !validateEvidenceIds(ledger, ids)) return false;
  const nodes = ids.map((id) => ledger.evidence.find((node) => node.id === id)).filter(Boolean);
  return nodes.length > 0 && nodes.every((node) => node && (node.source !== "native" ? node.confidence >= 0.7 : node.nativeVerified));
}

export async function resolveSemanticChecks(record: CanonicalTitleRecord, initial: QcProfileResult, ledger: TitleEvidenceLedger): Promise<{ resolutions: CheckerResolution[]; model: string; modelMs: number }> {
  const unresolved = initial.checks.filter((check) => check.status === "CANNOT_CONFIRM" && !["TARGET_LIEN_FOUND", "TARGET_LIEN_POSITION_ESTABLISHED", "CURRENT_OWNER_ESTABLISHED"].includes(check.id));
  if (!unresolved.length) return { resolutions: [], model: checkerModel(), modelMs: 0 };

  const model = checkerModel(); const started = Date.now();
  const evidenceNodes = ledger.evidence.map((node) => ({ id: node.id, page: node.page, documentType: node.documentType, instrumentNumber: node.instrumentNumber || "", quote: node.quote, confidence: node.confidence, source: node.source, nativeVerified: node.nativeVerified }));
  const payload = { canonicalRecord: compactRecord(record), evidenceLedger: evidenceNodes, unresolvedChecks: unresolved.map((check) => ({ id: check.id, label: check.label, category: check.category })) };
  const response = await openAIFetch(`${OPENAI_API}/responses`, {
    method: "POST", headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, store: false, max_output_tokens: MAX_OUTPUT_TOKENS, reasoning: { effort: "low" }, instructions: instructions(initial, unresolved), input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(payload) }] }], text: { verbosity: "low", format: { type: "json_schema", name: "cybrid_title_qc_resolutions", strict: true, schema: checkerSchema } } }),
  });
  const data = await response.json() as { output_text?: string; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>; usage?: unknown };
  const raw = JSON.parse(extractOutputText(data)) as { resolutions?: CheckerResolution[] };
  const allowed = new Set(unresolved.map((check) => check.id));
  const resolutions = (raw.resolutions || []).filter((resolution) => allowed.has(resolution.checkId)).map((resolution) => {
    const ids = Array.isArray(resolution.evidenceIds) ? [...new Set(resolution.evidenceIds)] : [];
    const status: QcStatus = ["PASS", "FAIL", "CANNOT_CONFIRM", "NOT_APPLICABLE"].includes(resolution.status) ? resolution.status : "CANNOT_CONFIRM";
    if ((status === "PASS" || status === "FAIL") && !strongEvidence(ledger, ids)) return { ...resolution, status: "CANNOT_CONFIRM" as const, summary: `Cannot Confirm — checker could not ground the proposed ${status} to sufficiently strong ledger evidence. ${resolution.summary}`, evidenceIds: ids };
    if (!validateEvidenceIds(ledger, ids)) return { ...resolution, status: "CANNOT_CONFIRM" as const, summary: "Cannot Confirm — checker returned an invalid evidence reference.", evidenceIds: [] };
    return { ...resolution, status, evidenceIds: ids };
  });
  console.info("CYBRID_TITLE_CHECK_MODEL_COMPLETE", JSON.stringify({ model, unresolved: unresolved.length, resolutions: resolutions.length, modelMs: Date.now() - started, usage: data.usage }));
  return { resolutions, model, modelMs: Date.now() - started };
}
