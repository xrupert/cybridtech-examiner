import assert from "node:assert/strict";
import { preservePartialPacketEvidence } from "../lib/partial-packet";
import { applyDocumentIntegrityGuard, summarizeDocumentIntegrity } from "../lib/document-integrity";
import { assertClientScope, clientInstanceConfig } from "../lib/client-instance";

function page(page: number, text: string, unresolved = false) {
  return {
    page,
    text,
    charCount: text.length,
    nativeCharCount: text.length,
    documentHint: page === 1 ? "Title Report" : "Assignment",
    textSource: unresolved ? "unresolved" : "native",
    confidence: unresolved ? 0 : 1,
    ocrAttempts: [],
    needsVisualReview: unresolved,
  };
}

const ledger: any = {
  version: 4,
  packetHash: "packet-1",
  sourceFile: "mixed-packet.pdf",
  pageCount: 3,
  totalCharacters: 360,
  nativeTotalCharacters: 360,
  textCoverage: 2 / 3,
  nativeTextCoverage: 2 / 3,
  usableTextPages: 2,
  nativeUsableTextPages: 2,
  effectiveTextPages: 3,
  initialLowTextPages: [2],
  lowTextPages: [2],
  ocrRecoveredPages: [],
  ocrSkippedPages: [],
  blankPages: [],
  ocrProvidersUsed: [],
  nativeTextReady: false,
  pageTextReady: false,
  pages: [
    page(1, "Title report showing Instrument 2026-100 and Property 1 Main Street."),
    page(2, "", true),
    page(3, "Readable supporting deed of trust Instrument 2026-100 recorded January 2 2026."),
  ],
  extractedAt: new Date(0).toISOString(),
};

const prepared = preservePartialPacketEvidence({
  packetHash: "packet-1",
  ledger,
  cacheHit: false,
  extractionMode: "openai-pdf-fallback",
  extractionMs: 1,
} as any);

assert.equal(prepared.extractionMode, "hybrid-page-ocr", "one unreadable page must not force whole-PDF fallback");
assert.ok(prepared.pageDelimitedText?.includes("UNREADABLE PAGE 2"), "the physical unreadable page must remain explicit in downstream context");
assert.ok(prepared.pageDelimitedText?.includes("PDF PAGE 3"), "readable pages after the bad page must survive downstream processing");

const integrity = summarizeDocumentIntegrity(ledger);
assert.equal(integrity.state, "MANUAL_REVIEW_REQUIRED");
assert.deepEqual(integrity.unresolvedPages, [2]);

const baseReview: any = {
  engineVersion: "test",
  record: {
    dataQualityWarnings: [],
  },
  qc: {
    checks: [
      {
        id: "Q5",
        label: "recordings",
        category: "VERA",
        status: "PASS",
        severity: "CRITICAL",
        critical: true,
        summary: "The recording appears supported.",
        recommendedAction: "No curative action required for this check.",
        evidence: [{ page: 2, quote: "unreliable", documentType: "Assignment", source: "native", sourceFile: "mixed-packet.pdf", confidence: 0.4 }],
      },
    ],
    qcStatus: "PASS",
    foreclosureReadiness: "CLEAR",
    curativeIssues: [],
    unresolvedCount: 0,
  },
  pipeline: { stages: [], completedThrough: "RECORD" },
};

const guarded = applyDocumentIntegrityGuard(baseReview, ledger);
assert.equal(guarded.qc.checks[0].status, "CANNOT_CONFIRM", "a conclusion depending only on an unreadable page must be downgraded, never left conclusive");
assert.equal(guarded.qc.qcStatus, "REVIEW", "unreadable evidence without an independent defect must route to examiner review");
assert.equal(guarded.qc.foreclosureReadiness, "CANNOT_CONFIRM");
assert.ok(guarded.record.dataQualityWarnings.some((warning: string) => warning.includes("page(s): 2")));

const readableDefect: any = {
  ...baseReview,
  record: { dataQualityWarnings: [] },
  qc: {
    ...baseReview.qc,
    checks: [{
      ...baseReview.qc.checks[0],
      id: "Q17",
      status: "FAIL",
      summary: "Readable report/source contradiction.",
      evidence: [{ page: 1, quote: "Instrument 2026-100", documentType: "Title Report", source: "native", sourceFile: "mixed-packet.pdf", confidence: 1 }],
    }],
    qcStatus: "FAIL",
    foreclosureReadiness: "QC_DEFICIENCY",
    curativeIssues: [],
  },
};
const defectGuarded = applyDocumentIntegrityGuard(readableDefect, ledger);
assert.equal(defectGuarded.qc.qcStatus, "FAIL", "a separately readable, grounded critical defect must remain FAIL even when another page is unreadable");
assert.equal(defectGuarded.qc.checks[0].status, "FAIL");

const savedEnv = { ...process.env };
try {
  process.env.VERA_COMPLIANCE_MODE = "1";
  process.env.VERA_CLIENT_ID = "client-a";
  process.env.VERA_CLIENT_NAME = "Client A";
  assert.equal(clientInstanceConfig().complianceMode, true);
  assert.equal(assertClientScope("Client A").clientId, "client-a");
  assert.throws(() => assertClientScope("Client B"), /CLIENT_SCOPE_MISMATCH/, "a compliance deployment must not accept a different client's scope");
} finally {
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
}

console.log("vera-unified-harness: PASS");
