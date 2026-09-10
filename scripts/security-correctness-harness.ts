import { projectReviewedResult, releaseWarnings } from "../lib/review-release";
import { POST as exportRoute } from "../app/api/review-exports/route";
import assert from "node:assert/strict";
import { checkExaminerAccess, testingAccessBypassEnabled } from "../lib/examiner-auth";
import { assertUploadPaths, issueUploadPath } from "../lib/upload-paths";
import { applyDocumentIntegrityGuard } from "../lib/document-integrity";
import { applyReviewDecisions } from "../lib/review-decision-reducer";
import { veraPassFailReason } from "../lib/vera-accuracy-audit";
import { GET as acceptance } from "../app/api/acceptance/scanned-regression/route";
import { GET as accessRoute } from "../app/api/access/route";

const saved = { ...process.env };
let count = 0;
function test(name: string, fn: () => void) { fn(); count++; console.log(`PASS ${name}`); }

async function main() {
  try {
    delete process.env.EXAMINER_REQUIRE_ACCESS_CODE;
    delete process.env.EXAMINER_ACCESS_CODE;
    test("missing auth configuration denies access", () => assert.equal(checkExaminerAccess(new Request("http://localhost")).ok, false));
    process.env.EXAMINER_ACCESS_CODE = "test-secret-not-a-real-key";
    test("wrong code denied", () => assert.equal(checkExaminerAccess(new Request("http://localhost", { headers: { "x-examiner-access-code": "wrong" } })).ok, false));
    test("correct code accepted", () => assert.equal(checkExaminerAccess(new Request("http://localhost", { headers: { "x-examiner-access-code": process.env.EXAMINER_ACCESS_CODE } })).ok, true));
    process.env.EXAMINER_REQUIRE_ACCESS_CODE = "false";
    Object.assign(process.env, { NODE_ENV: "production" });
    test("production cannot enable testing bypass", () => assert.equal(testingAccessBypassEnabled(), false));
    Object.assign(process.env, { NODE_ENV: "development" });
    delete process.env.VERCEL;
    delete process.env.VERA_COMPLIANCE_MODE;
    test("explicit local development bypass works", () => assert.equal(testingAccessBypassEnabled(), true));
    process.env.VERA_COMPLIANCE_MODE = "1";
    test("compliance disables local bypass", () => assert.equal(testingAccessBypassEnabled(), false));
    delete process.env.VERA_ENABLE_ACCEPTANCE_ROUTE;
    assert.equal((await acceptance(new Request("http://localhost"))).status, 404); count++;
    assert.equal((await accessRoute(new Request("http://localhost"))).status, 401); count++;
    assert.equal((await exportRoute(new Request("http://localhost", { method: "POST" }))).status, 401); count++;
    assert.equal((await exportRoute(new Request("http://localhost", { method: "POST", headers: { "x-examiner-access-code": process.env.EXAMINER_ACCESS_CODE! }, body: JSON.stringify({ reviewIds: [], format: "csv", columns: [], report: { qcStatus: "PASS" } }) }))).status, 400); count++;
    process.env.BLOB_READ_WRITE_TOKEN = "test-only-signing-key";
    process.env.VERA_CLIENT_ID = "client-a";
    const path = issueUploadPath("a sample.pdf");
    test("server-issued upload accepted", () => assert.doesNotThrow(() => assertUploadPaths([path])));
    test("tampered upload rejected", () => assert.throws(() => assertUploadPaths([path.replace("a-sample", "another")])));
    test("internal dossier path rejected", () => assert.throws(() => assertUploadPaths(["cybrid-title/clients/client-a/review-dossiers-v1/private.json"])));
    test("external URL rejected", () => assert.throws(() => assertUploadPaths([`https://example.com/${path}`])));
    test("multiple paths rejected before access", () => assert.throws(() => assertUploadPaths([path, path])));
    process.env.VERA_CLIENT_ID = "client-b";
    test("cross-client upload rejected", () => assert.throws(() => assertUploadPaths([path])));
    const ledger: any = { pageCount: 3, lowTextPages: [2], ocrSkippedPages: [], ocrRecoveredPages: [], blankPages: [], nativeUsableTextPages: 2 };
    const check: any = { id: "CURRENT_OWNER_ESTABLISHED", status: "FAIL", critical: true, summary: "Unreliable conclusion", recommendedAction: "Review", evidence: [{ page: 2 }], category: "TITLE" };
    const review: any = { record: { dataQualityWarnings: [], targetLien: {}, foreclosureAnalysis: { requirements: [], seniorLienIds: [], juniorLienIds: [] } }, qc: { checks: [check], curativeIssues: [], unresolvedCount: 0, qcStatus: "FAIL", foreclosureReadiness: "CURATIVE_REQUIRED" } };
    const guarded = applyDocumentIntegrityGuard(review, ledger);
    test("unreadable-only FAIL downgraded", () => assert.equal(guarded.qc.checks[0].status, "CANNOT_CONFIRM"));
    test("packet with unsupported failure requires review", () => assert.equal(guarded.qc.qcStatus, "REVIEW"));
    const mixed = applyDocumentIntegrityGuard({ ...review, qc: { ...review.qc, checks: [{ ...check, evidence: [{ page: 1 }, { page: 2 }] }] } }, ledger);
    test("mixed citations do not prove independence from unreadable page", () => assert.equal(mixed.qc.checks[0].status, "CANNOT_CONFIRM"));
    const readable = applyDocumentIntegrityGuard({ ...review, qc: { ...review.qc, checks: [{ ...check, evidence: [{ page: 1 }] }] } }, ledger);
    test("independent readable defect remains FAIL", () => assert.equal(readable.qc.qcStatus, "FAIL"));
    const corrected = applyReviewDecisions(guarded, [{ reviewId: "test", checkId: check.id, decision: "CORRECT", correctedStatus: "PASS", reason: "Reviewed owner", actor: "test", decidedAt: "2026-09-10" }]);
    test("individual correction cannot erase integrity hold", () => assert.equal(corrected.qc.qcStatus, "REVIEW"));
    test("integrity hold survives report projection", () => assert.equal(veraPassFailReason(corrected.qc).status, "Needs review"));
    guarded.record.reviewId = "review-a";
    guarded.qc.checks[0].label = "Owner";
    const ownDecision: any = { reviewId: "review-a", checkId: check.id, decision: "CORRECT", correctedStatus: "PASS", reason: "Examined", actor: "test", decidedAt: "2026-09-10" };
    test("foreign review decision cannot alter result", () => assert.equal(projectReviewedResult(guarded, [{ ...ownDecision, reviewId: "review-b" }]).qc.checks[0].status, "CANNOT_CONFIRM"));
    test("unreviewed exception blocks release", () => assert.ok(releaseWarnings(guarded, []).some((warning) => warning.includes("disposition"))));
    test("corrections cannot authorize unreadable packet export", () => assert.ok(releaseWarnings(projectReviewedResult(guarded, [ownDecision]), [ownDecision]).some((warning) => warning.includes("physical pages"))));
    const clean: any = { ...guarded, qc: { ...guarded.qc, curativeIssues: [], checks: [{ ...guarded.qc.checks[0], status: "PASS", legacyQuestionNumber: 1 }] } };
    test("passing Vera question still requires review", () => assert.equal(releaseWarnings(clean, []).length, 1));
    test("foreign decision cannot satisfy release gate", () => assert.equal(releaseWarnings(clean, [{ ...ownDecision, reviewId: "review-b" }]).length, 1));
    test("reviewed readable packet eligible for export", () => assert.deepEqual(releaseWarnings(clean, [ownDecision]), []));
    console.log(`security-correctness-harness: ${count} passed`);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
