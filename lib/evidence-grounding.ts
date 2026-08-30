import type { PacketExtractionLedger } from "./document-engine";
import type { AuditFinding, EvidenceRef, VeraExam } from "./vera";

export interface GroundingSummary {
  checkedEvidence: number;
  verifiedEvidence: number;
  visualEvidence: number;
  rejectedEvidence: number;
  downgradedFindings: number[];
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”‘’]/g, "'")
    .replace(/[^a-z0-9$#./' -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return normalize(value).split(" ").filter((token) => token.length > 1);
}

function fuzzyContained(quote: string, pageText: string): boolean {
  const q = normalize(quote);
  const p = normalize(pageText);
  if (!q || !p) return false;
  if (p.includes(q)) return true;

  const qTokens = tokens(q);
  if (qTokens.length < 4) return false;
  const pTokens = new Set(tokens(p));
  const matched = qTokens.filter((token) => pTokens.has(token)).length;
  return matched / qTokens.length >= 0.82;
}

function groundEvidence(item: EvidenceRef, ledger: PacketExtractionLedger): "verified" | "visual" | "rejected" {
  const page = ledger.pages.find((candidate) => candidate.page === item.page);
  if (!page || page.needsVisualReview || page.charCount < 80) return "visual";
  return fuzzyContained(item.quote, page.text) ? "verified" : "rejected";
}

function isConclusive(status: AuditFinding["status"]): boolean {
  return status === "PASS" || status === "FAIL";
}

export function verifyExamGrounding(exam: VeraExam, ledger: PacketExtractionLedger): { exam: VeraExam; summary: GroundingSummary } {
  const summary: GroundingSummary = {
    checkedEvidence: 0,
    verifiedEvidence: 0,
    visualEvidence: 0,
    rejectedEvidence: 0,
    downgradedFindings: [],
  };

  const findings = exam.findings.map((finding) => {
    if (!finding.evidence.length) return finding;
    const states = finding.evidence.map((item) => {
      summary.checkedEvidence += 1;
      const state = groundEvidence(item, ledger);
      if (state === "verified") summary.verifiedEvidence += 1;
      if (state === "visual") summary.visualEvidence += 1;
      if (state === "rejected") summary.rejectedEvidence += 1;
      return state;
    });

    const reliableNativeEvidenceWasClaimed = states.some((state) => state !== "visual");
    const hasVerifiedNativeEvidence = states.some((state) => state === "verified");
    if (isConclusive(finding.status) && reliableNativeEvidenceWasClaimed && !hasVerifiedNativeEvidence) {
      summary.downgradedFindings.push(finding.number);
      return {
        ...finding,
        status: "CANNOT_CONFIRM" as const,
        response: `Cannot Confirm — the cited quote could not be independently matched to the claimed native-text PDF page. Proposed result: ${finding.response}`,
        proofReason: `${finding.proofReason} Server grounding verification rejected the native quote/page match.`,
      };
    }
    return finding;
  });

  return {
    exam: {
      ...exam,
      findings,
      manualReviewRequired: exam.manualReviewRequired || summary.visualEvidence > 0 || summary.downgradedFindings.length > 0,
    },
    summary,
  };
}
