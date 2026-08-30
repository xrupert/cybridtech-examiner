import type { AuditFinding, PacketDocument, VeraExam } from "./vera";

export type RunSheetDetection = {
  detected: boolean;
  confidence: "high" | "medium" | "low";
  pageStart?: number;
  pageEnd?: number;
  reason: string;
};

const explicitRunSheet = /\b(run\s*sheet|abstractor\s*sheet|search\s*sheet|title\s*worksheet)\b/i;
const summarySignals = [
  /\bclient\s*order\b/i,
  /\bsearch\s*effective\b/i,
  /\bproperty\s*address\b/i,
  /\bvesting\b/i,
  /\bdeed\b/i,
  /\bmortgage\b|\bdeed\s+of\s+trust\b/i,
  /\bassignment\b/i,
  /\brelease\b|\bsatisfaction\b/i,
  /\bjudgment\b|\blien\b/i,
  /\binstrument\s*(?:#|number|no\.?)/i,
  /\bbook\s*\/?\s*page\b|\bbook\b.*\bpage\b/i,
  /\brecord(?:ed|ing)?\s*date\b/i,
  /\bparcel\b/i,
];

function structuralScore(text: string): number {
  return summarySignals.reduce((score, signal) => score + Number(signal.test(text)), 0);
}

function documentLooksLikeFunctionalRunSheet(document: PacketDocument): boolean {
  const type = document.documentType || "";
  const excerpt = document.excerpt || "";
  const combined = `${type}\n${excerpt}`;

  if (explicitRunSheet.test(combined)) return true;

  // A Run Sheet is a function, not necessarily a heading. Many title packages begin with
  // one or more summary/index pages inside the title report itself, followed by the source
  // instruments those pages were built from. Those front summary pages still count.
  const earlyInPacket = document.pageStart <= 8;
  const titleSummaryLike = /title\s*(report|search|summary)|search\s*report|abstractor/i.test(type);
  return earlyInPacket && titleSummaryLike && structuralScore(combined) >= 4;
}

function findingEvidenceLooksLikeRunSheet(finding: AuditFinding): boolean {
  if (![19, 20].includes(finding.number)) return false;
  return finding.evidence.some((evidence) => {
    const combined = `${evidence.documentType || ""}\n${evidence.quote || ""}`;
    if (explicitRunSheet.test(combined)) return true;
    return evidence.page <= 8 && /title\s*(report|search|summary)|search\s*report|abstractor/i.test(evidence.documentType || "") && structuralScore(combined) >= 2;
  });
}

export function detectRunSheet(exam: Pick<VeraExam, "documents" | "findings">): RunSheetDetection {
  const explicit = exam.documents.find((document) => explicitRunSheet.test(`${document.documentType || ""}\n${document.excerpt || ""}`));
  if (explicit) {
    return {
      detected: true,
      confidence: "high",
      pageStart: explicit.pageStart,
      pageEnd: explicit.pageEnd,
      reason: `Run Sheet/Abstractor summary identified on PDF page${explicit.pageStart === explicit.pageEnd ? "" : "s"} ${explicit.pageStart}${explicit.pageStart === explicit.pageEnd ? "" : `-${explicit.pageEnd}`}.`,
    };
  }

  const functional = exam.documents.find(documentLooksLikeFunctionalRunSheet);
  if (functional) {
    return {
      detected: true,
      confidence: "medium",
      pageStart: functional.pageStart,
      pageEnd: functional.pageEnd,
      reason: `Front-of-packet title summary pages function as the Run Sheet even though they are not literally labeled \"Run Sheet\". They summarize recording/title facts that must be reconciled to the supporting instruments behind them.`,
    };
  }

  const evidenceFinding = exam.findings.find(findingEvidenceLooksLikeRunSheet);
  if (evidenceFinding) {
    const pages = evidenceFinding.evidence.map((item) => item.page).filter((page) => page > 0);
    return {
      detected: true,
      confidence: "medium",
      pageStart: pages.length ? Math.min(...pages) : undefined,
      pageEnd: pages.length ? Math.max(...pages) : undefined,
      reason: "Q19/Q20 evidence identifies a front-of-packet title-summary/recording-list section that functions as the Run Sheet.",
    };
  }

  return {
    detected: false,
    confidence: "low",
    reason: "No Run Sheet was identified by label or by front-of-packet summary/index structure. This does not prove one is absent; Q19/Q20 should not be silently waived when packet structure is ambiguous.",
  };
}
