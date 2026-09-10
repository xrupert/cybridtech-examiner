import { loadReviewDossier, type ReviewDossier } from "./review-dossier";

const OPENAI_API = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-5.6-sol";
const MAX_CONTEXT_PAGES = 12;
const MAX_PAGE_CHARS = 18_000;

export interface AskVeraCitation {
  page: number;
  quote: string;
  documentType: string;
  instrumentNumber?: string;
  source: string;
  confidence: number;
}

export interface AskVeraAnswer {
  answer: string;
  confidence: number;
  cannotConfirm: boolean;
  citations: AskVeraCitation[];
  retrievedPages: number[];
}

const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "what", "where", "when", "does", "did", "was", "were", "are", "is", "has", "have", "had", "who", "why", "how", "can", "could", "would", "should", "into", "about", "title", "report", "packet", "document", "documents", "page"]);

function compact(value: string): string {
  return String(value || "").replace(/\u0000/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function normalize(value: string): string {
  return String(value || "").toLowerCase().replace(/[“”‘’]/g, "'").replace(/[^a-z0-9$#./' -]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(value: string): string[] {
  return [...new Set(normalize(value).split(" ").filter((token) => token.length > 2 && !STOP.has(token)))];
}

function fuzzyContained(quote: string, pageText: string): boolean {
  const q = normalize(quote);
  const p = normalize(pageText);
  if (!q || !p) return false;
  if (p.includes(q)) return true;
  const qTokens = q.split(" ").filter((token) => token.length > 1);
  if (qTokens.length < 4) return false;
  const pTokens = new Set(p.split(" ").filter((token) => token.length > 1));
  const matched = qTokens.filter((token) => pTokens.has(token)).length;
  return matched / qTokens.length >= 0.84;
}

function requestedPages(question: string): number[] {
  const pages = new Set<number>();
  for (const match of question.matchAll(/\bpage\s*#?\s*(\d{1,4})\b/gi)) {
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > 0) pages.add(value);
  }
  return [...pages];
}

function pageScore(question: string, page: ReviewDossier["pageLedger"]["pages"][number], dossier: ReviewDossier): number {
  if (page.textSource === "blank") return -100;
  const qs = tokens(question);
  const haystack = normalize(`${page.documentHint} ${page.text}`);
  let score = page.needsVisualReview ? -4 : 0;
  for (const token of qs) {
    const matches = haystack.split(token).length - 1;
    score += Math.min(5, matches) * (token.length > 7 ? 2 : 1);
  }
  for (const evidence of dossier.evidenceLedger.evidence) {
    if (evidence.page !== page.page) continue;
    const evidenceText = normalize(`${evidence.documentType} ${evidence.instrumentNumber || ""} ${evidence.quote}`);
    for (const token of qs) if (evidenceText.includes(token)) score += 4;
  }
  const explicit = requestedPages(question);
  if (explicit.includes(page.page)) score += 1000;
  return score;
}

function relevantChecks(question: string, dossier: ReviewDossier) {
  const qs = tokens(question);
  return dossier.review.qc.checks
    .map((check) => ({ check, score: qs.reduce((sum, token) => sum + (normalize(`${check.label} ${check.summary} ${check.recommendedAction}`).includes(token) ? 1 : 0), 0) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((item) => item.check);
}

function relevantInstruments(question: string, dossier: ReviewDossier) {
  const qs = tokens(question);
  const scored = dossier.review.record.instruments.map((instrument) => {
    const value = normalize(`${instrument.type} ${instrument.instrumentNumber} ${instrument.bookPage} ${instrument.amount} ${instrument.status} ${instrument.parties.map((p) => `${p.role} ${p.name}`).join(" ")} ${instrument.referencedInstrumentNumbers.join(" ")}`);
    return { instrument, score: qs.reduce((sum, token) => sum + (value.includes(token) ? 1 : 0), 0) };
  });
  const matches = scored.filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 25).map((item) => item.instrument);
  return matches.length ? matches : dossier.review.record.instruments.slice(0, 12);
}

function relevantGraph(question: string, dossier: ReviewDossier) {
  if (!dossier.graph) return { nodes: [], edges: [] };
  const qs = tokens(question);
  const scored = dossier.graph.nodes.map((node) => {
    const value = normalize(`${node.type} ${node.label} ${JSON.stringify(node.attributes)}`);
    const score = qs.reduce((sum, token) => sum + (value.includes(token) ? (token.length > 7 ? 2 : 1) : 0), 0);
    return { node, score };
  }).sort((a, b) => b.score - a.score);
  const seeds = scored.filter((item) => item.score > 0).slice(0, 16).map((item) => item.node);
  const selected = new Map(seeds.map((node) => [node.id, node]));
  const neighborEdges = dossier.graph.edges.filter((edge) => selected.has(edge.from) || selected.has(edge.to)).slice(0, 48);
  for (const edge of neighborEdges) {
    const from = dossier.graph.nodes.find((node) => node.id === edge.from);
    const to = dossier.graph.nodes.find((node) => node.id === edge.to);
    if (from && selected.size < 28) selected.set(from.id, from);
    if (to && selected.size < 28) selected.set(to.id, to);
  }
  return {
    nodes: [...selected.values()].map((node) => ({ id: node.id, type: node.type, label: node.label, attributes: node.attributes, evidenceIds: node.evidenceIds })),
    edges: neighborEdges.map((edge) => ({ from: edge.from, to: edge.to, type: edge.type, label: edge.label, evidenceIds: edge.evidenceIds })),
  };
}

function retrieve(question: string, dossier: ReviewDossier) {
  const pages = dossier.pageLedger.pages
    .map((page) => ({ page, score: pageScore(question, page, dossier) }))
    .filter((item) => item.score > -100)
    .sort((a, b) => b.score - a.score || a.page.page - b.page.page)
    .slice(0, MAX_CONTEXT_PAGES)
    .map((item) => item.page);

  return {
    pages,
    checks: relevantChecks(question, dossier),
    instruments: relevantInstruments(question, dossier),
    graph: relevantGraph(question, dossier),
  };
}

function openAiKey(): string {
  return process.env.OPENAI_API_KEY || process.env.OPEN_AI_KEY || "";
}

function model(): string {
  return process.env.OPENAI_ASK_VERA_MODEL || process.env.OPENAI_CHECK_MODEL || DEFAULT_MODEL;
}

function extractOutputText(data: any): string {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text;
  for (const item of data?.output || []) {
    if (item?.type !== "message") continue;
    for (const content of item.content || []) if (content?.type === "output_text" && typeof content.text === "string") return content.text;
  }
  throw new Error("Ask Vera returned no output text.");
}

function pageContext(pages: ReviewDossier["pageLedger"]["pages"]): string {
  return pages.map((page) => {
    const body = page.text?.trim()
      ? page.text.slice(0, MAX_PAGE_CHARS)
      : `[UNREADABLE PAGE ${page.page} — MANUAL REVIEW REQUIRED]`;
    return `=== PHYSICAL PDF PAGE ${page.page} | ${page.documentHint} | SOURCE ${page.textSource} | OCR CONFIDENCE ${page.confidence.toFixed(3)} ===\n${body}`;
  }).join("\n\n");
}

const answerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "confidence", "cannotConfirm", "citations"],
  properties: {
    answer: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    cannotConfirm: { type: "boolean" },
    citations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["page", "quote", "documentType", "instrumentNumber"],
        properties: {
          page: { type: "integer", minimum: 1 },
          quote: { type: "string" },
          documentType: { type: "string" },
          instrumentNumber: { type: "string" },
        },
      },
    },
  },
} as const;

export async function askVera(reviewId: string, question: string): Promise<AskVeraAnswer> {
  const dossier = await loadReviewDossier(reviewId);
  if (!dossier) throw new Error("REVIEW_DOSSIER_NOT_FOUND: this review does not have a persisted evidence dossier.");
  const cleanQuestion = compact(question).slice(0, 3000);
  if (!cleanQuestion) throw new Error("QUESTION_REQUIRED: ask a specific question about the reviewed packet.");

  const retrieved = retrieve(cleanQuestion, dossier);
  const unresolved = new Set([...dossier.pageLedger.lowTextPages, ...dossier.pageLedger.ocrSkippedPages]);
  const context = {
    reviewId,
    packetHash: dossier.packetHash,
    sourceFile: dossier.sourceFile,
    qcStatus: dossier.review.qc.qcStatus,
    foreclosureReadiness: dossier.review.qc.foreclosureReadiness,
    relevantChecks: retrieved.checks,
    relevantInstruments: retrieved.instruments,
    relevantGraph: retrieved.graph,
    coreRecord: {
      orderNumber: dossier.review.record.orderNumber,
      propertyAddress: dossier.review.record.propertyAddress,
      parcelId: dossier.review.record.parcelId,
      borrower: dossier.review.record.borrower,
      currentOwner: dossier.review.record.currentOwner,
      legalDescription: dossier.review.record.legalDescription,
      targetLien: dossier.review.record.targetLien,
      flags: dossier.review.record.flags,
      taxes: dossier.review.record.taxes,
    },
  };

  const key = openAiKey();
  if (!key) throw new Error("OPENAI_NOT_CONFIGURED: Ask Vera requires the configured review model.");
  const response = await fetch(`${OPENAI_API}/responses`, {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model(),
      store: false,
      max_output_tokens: 4500,
      reasoning: { effort: "medium" },
      instructions: `You are Ask Vera, an evidence-only title packet examiner. Answer the user's question only from the supplied canonical review facts, deterministic title graph, and physical-page excerpts. Graph edges help navigate relationships but they do not substitute for physical-page proof. Never use outside knowledge to fill a documentary gap. Never infer a negative from absence. Every affirmative documentary answer must cite one or more short exact quotes from the supplied physical pages. If the answer depends on an unreadable page, conflicting evidence, or evidence not present in the supplied pages, set cannotConfirm=true and explain exactly what must be manually checked. Do not treat OCR confidence as legal certainty. A substantive title FAIL requires readable documentary evidence; unreadability alone is manual review, not a defect.`,
      input: [{
        role: "user",
        content: [{ type: "input_text", text: `QUESTION\n${cleanQuestion}\n\nCANONICAL REVIEW + GRAPH SNAPSHOT\n${JSON.stringify(context)}\n\nRETRIEVED PHYSICAL PAGES\n${pageContext(retrieved.pages)}` }],
      }],
      text: { verbosity: "low", format: { type: "json_schema", name: "ask_vera_answer", strict: true, schema: answerSchema } },
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Ask Vera model failed (${response.status})${body ? `: ${body.slice(0, 900)}` : ""}`);
  }
  const parsed = JSON.parse(extractOutputText(await response.json())) as {
    answer: string;
    confidence: number;
    cannotConfirm: boolean;
    citations: Array<{ page: number; quote: string; documentType: string; instrumentNumber: string }>;
  };

  const verified: AskVeraCitation[] = [];
  for (const citation of parsed.citations || []) {
    const page = dossier.pageLedger.pages.find((candidate) => candidate.page === citation.page);
    if (!page || page.needsVisualReview || unresolved.has(page.page) || !fuzzyContained(citation.quote, page.text)) continue;
    const node = dossier.evidenceLedger.evidence.find((candidate) => candidate.page === page.page && fuzzyContained(citation.quote, candidate.quote));
    verified.push({
      page: page.page,
      quote: compact(citation.quote),
      documentType: compact(citation.documentType || node?.documentType || page.documentHint) || page.documentHint,
      instrumentNumber: compact(citation.instrumentNumber || node?.instrumentNumber || "") || undefined,
      source: page.textSource,
      confidence: node?.confidence ?? page.confidence,
    });
  }

  const cannotConfirm = Boolean(parsed.cannotConfirm || !verified.length);
  const answer = cannotConfirm && !verified.length
    ? `Cannot Confirm from the reliably readable evidence retrieved for this question. ${compact(parsed.answer)}`
    : compact(parsed.answer);

  return {
    answer,
    confidence: cannotConfirm ? Math.min(0.6, Number(parsed.confidence) || 0) : Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    cannotConfirm,
    citations: verified,
    retrievedPages: retrieved.pages.map((page) => page.page),
  };
}
