import { RCS_ORDER_REQUIREMENTS, isSupportedSearchType } from "./audit-rules";
import type { EvidenceRef } from "./vera";
import { sortRunSheetRows, type RunSheetBuild, type RunSheetCategory, type RunSheetRow } from "./run-sheet";

const OPENAI_API = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-5.6-luna";
const MAX_OUTPUT_TOKENS = 24000;

type RunSheetContext = { state: string; searchType: string; sourceFiles: string[] };
type RawEvidence = { quote: string; page: number; sourceFile: string; documentType: string };
type RawRow = {
  category: RunSheetCategory;
  instrumentType: string;
  documentDate: string;
  recordingDate: string;
  instrumentNumber: string;
  book: string;
  page: string;
  grantorBorrower: string;
  granteeBeneficiary: string;
  amount: string;
  status: string;
  legalDescriptionSummary: string;
  notes: string;
  evidence: RawEvidence[];
};
type RawRunSheet = {
  county: string;
  propertyAddress: string;
  parcelId: string;
  legalDescription: string;
  rows: RawRow[];
  requirementsReview: string[];
  buildSummary: string;
  manualReviewRequired: boolean;
};

const categories: RunSheetCategory[] = [
  "Conveyance",
  "Mortgage/DOT",
  "Assignment",
  "Release/Satisfaction",
  "Judgment/Lien",
  "Tax",
  "HOA/CC&R",
  "Plat",
  "Probate/Estate",
  "Other",
];

const evidenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["quote", "page", "sourceFile", "documentType"],
  properties: {
    quote: { type: "string" },
    page: { type: "integer", minimum: 1 },
    sourceFile: { type: "string" },
    documentType: { type: "string" },
  },
} as const;

const rowSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "category", "instrumentType", "documentDate", "recordingDate", "instrumentNumber", "book", "page",
    "grantorBorrower", "granteeBeneficiary", "amount", "status", "legalDescriptionSummary", "notes", "evidence",
  ],
  properties: {
    category: { type: "string", enum: categories },
    instrumentType: { type: "string" },
    documentDate: { type: "string" },
    recordingDate: { type: "string" },
    instrumentNumber: { type: "string" },
    book: { type: "string" },
    page: { type: "string" },
    grantorBorrower: { type: "string" },
    granteeBeneficiary: { type: "string" },
    amount: { type: "string" },
    status: { type: "string" },
    legalDescriptionSummary: { type: "string" },
    notes: { type: "string" },
    evidence: { type: "array", minItems: 1, items: evidenceSchema },
  },
} as const;

const runSheetSchema = {
  type: "object",
  additionalProperties: false,
  required: ["county", "propertyAddress", "parcelId", "legalDescription", "rows", "requirementsReview", "buildSummary", "manualReviewRequired"],
  properties: {
    county: { type: "string" },
    propertyAddress: { type: "string" },
    parcelId: { type: "string" },
    legalDescription: { type: "string" },
    rows: { type: "array", items: rowSchema },
    requirementsReview: { type: "array", items: { type: "string" } },
    buildSummary: { type: "string" },
    manualReviewRequired: { type: "boolean" },
  },
} as const;

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OpenAI is not configured. Add OPENAI_API_KEY to the Vercel project.");
  return key;
}

function model(): string {
  return process.env.OPENAI_DOCUMENT_MODEL || DEFAULT_MODEL;
}

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

async function uploadFile(file: File): Promise<string> {
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("expires_after[anchor]", "created_at");
  form.append("expires_after[seconds]", "3600");
  form.append("file", file, file.name || "title-document.pdf");
  const response = await openAIFetch(`${OPENAI_API}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  const data = await response.json() as { id?: string };
  if (!data.id) throw new Error(`OpenAI accepted ${file.name} but did not return a file id.`);
  return data.id;
}

async function deleteFile(fileId: string): Promise<void> {
  try {
    await fetch(`${OPENAI_API}/files/${fileId}`, { method: "DELETE", headers: { Authorization: `Bearer ${apiKey()}` } });
  } catch {
    // Expiration is also configured; cleanup failure must not erase a completed build.
  }
}

function prompt(context: RunSheetContext, pass: "primary" | "verification"): string {
  if (!isSupportedSearchType(context.searchType)) throw new Error(`Unsupported MVP search type: ${context.searchType}.`);
  const rules = RCS_ORDER_REQUIREMENTS[context.searchType].map((rule, index) => `${index + 1}. ${rule}`).join("\n");
  return `You are building an evidence-first title Run Sheet from supplied recorded title documents.\n\nMODE\n${pass === "primary" ? "PRIMARY BUILD" : "INDEPENDENT VERIFICATION BUILD"}\n\nCONTEXT\nState: ${context.state}\nOrder Type: ${context.searchType}\nFiles: ${context.sourceFiles.join(", ")}\n\nRCS ORDER REQUIREMENTS\n${rules}\n\nNON-NEGOTIABLE RULES\n- Reset context for this packet. Use only the supplied documents.\n- Read every supplied page, including scans, recording stamps, exhibits, tables, and legal descriptions.\n- Create one row for every distinct recorded instrument or title document that belongs on a Run Sheet. Do not invent rows for documents that are not supplied.\n- Every row MUST include at least one short verbatim evidence quote, the physical page within that source file, the source filename, and document type.\n- If a field is absent or unreadable, use \"Not Stated\" or \"Cannot Confirm\" in that field; never infer a value.\n- Preserve instrument/document numbers, party names, dates, amounts, book/page references, and legal-description identifiers exactly as shown.\n- Classify rows into Conveyance, Mortgage/DOT, Assignment, Release/Satisfaction, Judgment/Lien, Tax, HOA/CC&R, Plat, Probate/Estate, or Other.\n- Status means documentary state only when shown (for example Open, Released, Satisfied). Otherwise use Not Stated.\n- requirementsReview must identify selected RCS requirements that cannot be confirmed from the supplied packet. Do not call an absent non-required item a defect.\n- For 2nd Lien, do not demand HOA/CC&R, judgments/liens, or transfer-document copies solely because they are absent; honor the supplied RCS order rules.\n- For Current Owner Search, identify whether the supplied chain reaches the non-family FVD with concurrently filed PMM when evidence permits; otherwise say Cannot Confirm.\n- For Foreclosure, assess the supplied documents against the full-copy, plat, judgment, HOA/condo, tax, probate, lien, and packet-order requirements only where applicable or referenced.\n- Do not make a legal conclusion or title-insurance opinion. Build the documentary Run Sheet and flag evidence gaps for human review.\n- This ${pass === "primary" ? "is the first extraction" : "is an independent second extraction. Re-read the documents from scratch and try to catch omissions, transcription errors, duplicate instruments, and wrong party/date/amount readings"}.`;
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
  throw new Error("OpenAI completed the Run Sheet build but returned no structured output text.");
}

async function call(files: Array<{ id: string; name: string }>, context: RunSheetContext, pass: "primary" | "verification"): Promise<RawRunSheet> {
  const content: Array<Record<string, unknown>> = [{ type: "input_text", text: "Build the Run Sheet from all attached title documents." }];
  for (const file of files) content.push({ type: "input_file", file_id: file.id });
  const response = await openAIFetch(`${OPENAI_API}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model(),
      store: false,
      reasoning: { effort: "high" },
      max_output_tokens: MAX_OUTPUT_TOKENS,
      instructions: prompt(context, pass),
      input: [{ role: "user", content }],
      text: { verbosity: "low", format: { type: "json_schema", name: "cybrid_run_sheet_build", strict: true, schema: runSheetSchema } },
    }),
  });
  const text = extractOutputText(await response.json());
  try {
    return JSON.parse(text) as RawRunSheet;
  } catch {
    throw new Error("OpenAI returned Run Sheet output that could not be parsed as the required schema.");
  }
}

function clean(value: string): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function norm(value: string): string {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function key(row: RawRow): string {
  const instrument = norm(row.instrumentNumber);
  if (instrument && instrument !== "notstated" && instrument !== "cannotconfirm") return `i:${instrument}`;
  return `c:${norm(row.category)}|${norm(row.instrumentType)}|${norm(row.recordingDate || row.documentDate)}|${norm(row.grantorBorrower)}|${norm(row.granteeBeneficiary)}`;
}

function evidence(items: RawEvidence[]): EvidenceRef[] {
  const seen = new Set<string>();
  const out: EvidenceRef[] = [];
  for (const item of items || []) {
    const id = `${norm(item.sourceFile)}|${item.page}|${norm(item.quote)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      quote: clean(item.quote) || "Not Stated",
      page: Math.max(1, item.page || 1),
      documentType: clean(item.documentType) || "Unclassified",
      sourceFile: clean(item.sourceFile) || undefined,
      source: "openai-file",
    });
  }
  return out;
}

const comparedFields: Array<keyof RawRow> = [
  "category", "instrumentType", "documentDate", "recordingDate", "instrumentNumber", "book", "page",
  "grantorBorrower", "granteeBeneficiary", "amount", "status", "legalDescriptionSummary",
];

function rowFrom(raw: RawRow, verificationStatus: "VERIFIED" | "REVIEW", verificationNote: string): RunSheetRow {
  return {
    sequence: 0,
    category: raw.category,
    instrumentType: clean(raw.instrumentType) || "Not Stated",
    documentDate: clean(raw.documentDate) || "Not Stated",
    recordingDate: clean(raw.recordingDate) || "Not Stated",
    instrumentNumber: clean(raw.instrumentNumber) || "Not Stated",
    book: clean(raw.book) || "Not Stated",
    page: clean(raw.page) || "Not Stated",
    grantorBorrower: clean(raw.grantorBorrower) || "Not Stated",
    granteeBeneficiary: clean(raw.granteeBeneficiary) || "Not Stated",
    amount: clean(raw.amount) || "Not Stated",
    status: clean(raw.status) || "Not Stated",
    legalDescriptionSummary: clean(raw.legalDescriptionSummary) || "Not Stated",
    notes: clean(raw.notes),
    evidence: evidence(raw.evidence),
    verificationStatus,
    verificationNote,
  };
}

function reconcile(primary: RawRunSheet, verification: RawRunSheet, context: RunSheetContext): RunSheetBuild {
  const primaryMap = new Map(primary.rows.map((row) => [key(row), row]));
  const verificationMap = new Map(verification.rows.map((row) => [key(row), row]));
  const keys = new Set([...primaryMap.keys(), ...verificationMap.keys()]);
  const rows: RunSheetRow[] = [];
  let disagreementCount = 0;

  for (const id of keys) {
    const first = primaryMap.get(id);
    const second = verificationMap.get(id);
    if (!first || !second) {
      disagreementCount += 1;
      const row = first || second!;
      rows.push(rowFrom(row, "REVIEW", first ? "Independent verification did not reproduce this row." : "Independent verification found a row omitted by the primary build."));
      continue;
    }
    const mismatches = comparedFields.filter((field) => norm(String(first[field] || "")) !== norm(String(second[field] || "")));
    const usableEvidence = evidence([...first.evidence, ...second.evidence]);
    if (mismatches.length || !usableEvidence.length) {
      disagreementCount += 1;
      const built = rowFrom(first, "REVIEW", mismatches.length ? `Passes disagree on: ${mismatches.join(", ")}.` : "No usable source evidence survived verification.");
      built.evidence = usableEvidence;
      rows.push(built);
    } else {
      const built = rowFrom(first, "VERIFIED", "Both independent passes reproduced the same core recording facts.");
      built.evidence = usableEvidence;
      rows.push(built);
    }
  }

  const requirementsReview = Array.from(new Set([...(primary.requirementsReview || []), ...(verification.requirementsReview || [])].map(clean).filter(Boolean)));
  const sortedRows = sortRunSheetRows(rows, context.searchType);
  const manualReviewRequired = primary.manualReviewRequired || verification.manualReviewRequired || disagreementCount > 0 || requirementsReview.length > 0;

  return {
    state: context.state,
    county: clean(primary.county) || clean(verification.county) || "Not Stated",
    searchType: context.searchType,
    propertyAddress: clean(primary.propertyAddress) || clean(verification.propertyAddress) || "Not Stated",
    parcelId: clean(primary.parcelId) || clean(verification.parcelId) || "Not Stated",
    legalDescription: clean(primary.legalDescription) || clean(verification.legalDescription) || "Not Stated",
    sourceFiles: context.sourceFiles,
    rows: sortedRows,
    requirementsReview,
    buildSummary: `${sortedRows.length} Run Sheet row${sortedRows.length === 1 ? "" : "s"} built from ${context.sourceFiles.length} source file${context.sourceFiles.length === 1 ? "" : "s"}; ${sortedRows.filter((row) => row.verificationStatus === "VERIFIED").length} independently verified, ${disagreementCount} require review. ${clean(primary.buildSummary)}`.trim(),
    manualReviewRequired,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildRunSheetWithOpenAI(files: File[], context: { state: string; searchType: string }): Promise<RunSheetBuild> {
  if (!files.length) throw new Error("Upload at least one title document.");
  if (!isSupportedSearchType(context.searchType)) throw new Error(`Unsupported MVP search type: ${context.searchType}.`);
  const uploaded: Array<{ id: string; name: string }> = [];
  try {
    for (const file of files) uploaded.push({ id: await uploadFile(file), name: file.name || "title-document.pdf" });
    const runContext: RunSheetContext = { state: context.state.trim().toUpperCase() || "TX", searchType: context.searchType, sourceFiles: uploaded.map((file) => file.name) };
    const primary = await call(uploaded, runContext, "primary");
    const verification = await call(uploaded, runContext, "verification");
    return reconcile(primary, verification, runContext);
  } finally {
    await Promise.all(uploaded.map((file) => deleteFile(file.id)));
  }
}
