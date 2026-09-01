from pathlib import Path
import json

p = Path("app/demo/page.tsx")
text = p.read_text()
text = text.replace('import { reduceQcChecks } from "@/lib/title-qc-engine";\n', 'import { applyReviewDecisions } from "@/lib/review-decision-reducer";\nimport type { ReviewDecisionRecord } from "@/lib/review-decisions";\n', 1)
text = text.replace('type DecisionRecord = SavedDecision & { decidedAt?: string };', 'type DecisionRecord = SavedDecision & { reviewId?: string; actor?: string; decidedAt?: string };', 1)
text = text.replace('function supplementalChecks(review?: TitleReviewResult): QcCheckResult[] { return review?.qc.checks.filter((check) => !check.legacyQuestionNumber) || []; }', 'function supplementalChecks(review?: TitleReviewResult): QcCheckResult[] { return review?.qc.checks.filter((check) => !check.legacyQuestionNumber) || []; }\nfunction isForeclosureReview(review?: TitleReviewResult): boolean { return Boolean(review && review.record.orderType.state === "CONFIRMED" && /^foreclosure$/i.test(review.record.orderType.value)); }', 1)

start = text.index('  async function loadSavedDecisions(reviewId: string) {')
end = text.index('\n\n  async function runBatch()', start)
text = text[:start] + '''  async function loadSavedDecisions(reviewId: string) {
    try {
      const response = await fetch(`/api/review-decisions?reviewId=${encodeURIComponent(reviewId)}`);
      if (!response.ok) return;
      const manifest = await response.json() as { decisions?: DecisionRecord[] };
      const records = manifest.decisions || [];
      const mapped = Object.fromEntries(records.map((decision) => [decision.checkId, decision]));
      setDecisions((current) => ({ ...current, [reviewId]: mapped }));
      const reducerDecisions: ReviewDecisionRecord[] = records.map((decision) => ({
        reviewId,
        checkId: decision.checkId,
        decision: decision.decision,
        correctedStatus: decision.correctedStatus,
        correctedValue: decision.correctedValue,
        reason: decision.reason,
        actor: decision.actor || "examiner",
        decidedAt: decision.decidedAt || new Date().toISOString(),
      }));
      setItems((current) => current.map((item) => item.review?.record.reviewId === reviewId
        ? { ...item, review: applyReviewDecisions(item.review, reducerDecisions) }
        : item));
    } catch { /* review remains usable */ }
  }''' + text[end:]

start = text.index('  function selectTargetLien(item: BatchItem, instrumentId: string) {')
end = text.index('\n\n  function decisionFor(', start)
text = text[:start] + '''  async function selectTargetLien(item: BatchItem, instrumentId: string) {
    if (!item.review) return;
    const mortgage = item.review.record.mortgages.find((candidate) => candidate.id === instrumentId);
    if (!mortgage) return;
    const reason = `Examiner selected ${mortgage.instrumentNumber} as the foreclosure target after reviewing the competing security interests.`;
    try {
      setError("");
      const response = await fetch("/api/review-decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId: item.review.record.reviewId, checkId: "TARGET_LIEN_FOUND", decision: "CORRECT", correctedStatus: "PASS", correctedValue: mortgage.instrumentNumber, reason }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Could not save target-lien decision.");
      applySavedDecision(item, { checkId: "TARGET_LIEN_FOUND", decision: "CORRECT", correctedStatus: "PASS", correctedValue: mortgage.instrumentNumber, reason });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save target-lien decision.");
    }
  }''' + text[end:]

start = text.index('  function applySavedDecision(item: BatchItem, saved: SavedDecision) {')
end = text.index('\n\n  async function confirmAllClean', start)
text = text[:start] + '''  function applySavedDecision(item: BatchItem, saved: SavedDecision) {
    if (!item.review) return;
    const decidedAt = new Date().toISOString();
    setDecisions((current) => ({ ...current, [item.review!.record.reviewId]: { ...(current[item.review!.record.reviewId] || {}), [saved.checkId]: { ...saved, reviewId: item.review!.record.reviewId, actor: "examiner", decidedAt } } }));
    const decision: ReviewDecisionRecord = {
      reviewId: item.review.record.reviewId,
      checkId: saved.checkId,
      decision: saved.decision,
      correctedStatus: saved.correctedStatus,
      correctedValue: saved.correctedValue,
      reason: saved.reason,
      actor: "examiner",
      decidedAt,
    };
    patchReview(item.id, (review) => applyReviewDecisions(review, [decision]));
  }''' + text[end:]

text = text.replace('<header className={styles.nav}><div className={styles.brand}><Logo height={32} /><span className={styles.brandName}>CYBRID TITLE</span></div><span className={styles.navTag}>Title QC · Vera 20 · Lien Priority · Jurisdiction Curative</span></header>', '<header className={styles.nav}><div className={styles.brand}><Logo height={40} /><span className={styles.brandName}>Cybrid Title</span></div><span className={styles.navTag}>Title Examination · Vera 20 · Evidence Reconciliation · Curative</span></header>', 1)
text = text.replace('<main className={styles.main}>\n      <section className={styles.hero}>', '<main className={styles.main}>\n      <div className={styles.printBrand}><div className={styles.printBrandIdentity}><Logo height={54} /><div><strong>Cybrid Title</strong><span>Evidence-backed Title Examination</span></div></div><div className={styles.printBrandMeta}>Examiner Review{selected?.review ? ` · ${selected.review.record.tsNumber.value}` : ""}</div></div>\n      <section className={styles.hero}>', 1)
text = text.replace('<section className={styles.hero}><div><p className={styles.eyebrow}>Canonical title intelligence workbench</p><h1>Review the title. Confirm the evidence. Know what must happen next.</h1></div><p>Cybrid performs the Vera 20 review, develops the lien stack, separates title defects from foreclosure-process actions, and requires an examiner disposition before a reviewed export is released.</p></section>', '<section className={styles.hero}><div><p className={styles.eyebrow}>Title examiner intelligence workbench</p><h1>Find the title truth. Verify the source. Resolve what prevents the next action.</h1></div><p>Cybrid prepares the Vera 20 examination, reconciles the report to the recorded source documents, develops lien identity and priority only when the order requires it, and turns unresolved findings into a clear examiner or curative work queue before export.</p></section>', 1)

text = text.replace('<th>Order Profile</th><th>Borrower</th><th>Property</th><th>Target Lien</th><th>Lien Amount</th><th>Lien Position</th><th>Priority Basis</th><th>Foreclosure</th>', '<th>Order Profile</th><th>Owner / Borrower</th><th>Property</th><th>Target Lien</th><th>Lien Amount</th><th>Lien Position</th><th>Priority Basis</th><th>Workflow</th>', 1)
old = '''<td>{item.review.qc.profileName}</td><td>{item.review.record.borrower.value}</td><td>{item.review.record.propertyAddress.value}</td>
            <td>{item.review.record.targetLien.selectionRequired ? <select className={styles.editInput} value="" onChange={(event) => selectTargetLien(item, event.target.value)}><option value="">Resolve ambiguity…</option>{item.review.record.mortgages.map((mortgage) => <option value={mortgage.id} key={mortgage.id}>{mortgage.instrumentNumber} · {mortgage.amount}</option>)}</select> : item.review.record.targetLien.instrumentNumber.value}</td>
            <td>{item.review.record.targetLien.amount.value}</td><td><input className={styles.editInput} value={item.review.record.targetLien.position.value === "Needs review" ? "" : item.review.record.targetLien.position.value} placeholder="Needs review" onChange={(event) => setLienPosition(item, event.target.value)} /></td>
            <td>{item.review.record.targetLien.positionBasis.replaceAll("_", " ")} · {item.review.record.targetLien.positionConfidence}</td><td><span className={statusClass(item.review.record.foreclosureAnalysis.status)}>{item.review.record.foreclosureAnalysis.status.replaceAll("_", " ")}</span></td>'''
new = '''<td>{item.review.qc.profileName}</td><td>{isForeclosureReview(item.review) ? item.review.record.borrower.value : item.review.record.currentOwner.value}</td><td>{item.review.record.propertyAddress.value}</td>
            <td>{isForeclosureReview(item.review) ? (item.review.record.targetLien.selectionRequired ? <select className={styles.editInput} value="" onChange={(event) => void selectTargetLien(item, event.target.value)}><option value="">Resolve target ambiguity…</option>{item.review.record.mortgages.map((mortgage) => <option value={mortgage.id} key={mortgage.id}>{mortgage.instrumentNumber} · {mortgage.amount}</option>)}</select> : item.review.record.targetLien.instrumentNumber.value) : "—"}</td>
            <td>{isForeclosureReview(item.review) ? item.review.record.targetLien.amount.value : "—"}</td><td>{isForeclosureReview(item.review) ? item.review.record.targetLien.position.value : "—"}</td>
            <td>{isForeclosureReview(item.review) ? `${item.review.record.targetLien.positionBasis.replaceAll("_", " ")} · ${item.review.record.targetLien.positionConfidence}` : "—"}</td><td>{isForeclosureReview(item.review) ? <span className={statusClass(item.review.record.foreclosureAnalysis.status)}>{item.review.record.foreclosureAnalysis.status.replaceAll("_", " ")}</span> : <span className={statusClass("PASS")}>TITLE REVIEW</span>}</td>'''
if old not in text:
    raise SystemExit("batch row fragment not found")
text = text.replace(old, new, 1)

text = text.replace('  const selectedPassFail = selected?.review ? veraPassFailReason(selected.review.qc) : null;', '  const selectedPassFail = selected?.review ? veraPassFailReason(selected.review.qc) : null;\n  const selectedIsForeclosure = isForeclosureReview(selected?.review);', 1)
old = '<dt>Target lien</dt><dd>{selected.review.record.targetLien.instrumentNumber.value}</dd><dt>Lien amount</dt><dd>{selected.review.record.targetLien.amount.value}</dd><dt>Lien position</dt><dd>{selected.review.record.targetLien.position.value}</dd><dt>Position basis</dt><dd>{selected.review.record.targetLien.positionBasis.replaceAll("_", " ")} · {selected.review.record.targetLien.positionConfidence}</dd><dt>Open liens</dt><dd>{selected.review.record.foreclosureAnalysis.openLienCount}</dd><dt>QC profile</dt>'
new = '<dt>Target lien</dt><dd>{selectedIsForeclosure ? selected.review.record.targetLien.instrumentNumber.value : "Not applicable to this order"}</dd><dt>Lien amount</dt><dd>{selectedIsForeclosure ? selected.review.record.targetLien.amount.value : "—"}</dd><dt>Lien position</dt><dd>{selectedIsForeclosure ? selected.review.record.targetLien.position.value : "—"}</dd><dt>Position basis</dt><dd>{selectedIsForeclosure ? `${selected.review.record.targetLien.positionBasis.replaceAll("_", " ")} · ${selected.review.record.targetLien.positionConfidence}` : "—"}</dd><dt>Open lien identities</dt><dd>{selected.review.record.foreclosureAnalysis.openLienCount}</dd><dt>QC profile</dt>'
if old not in text:
    raise SystemExit("summary target fragment not found")
text = text.replace(old, new, 1)
text = text.replace('<div className={styles.sectionTitle}><div><h2>Foreclosure cure / action</h2><p>Title defects and future foreclosure-process requirements are labeled separately.</p></div></div>', '<div className={styles.sectionTitle}><div><h2>{selectedIsForeclosure ? "Foreclosure cure / action" : "Title exceptions / examiner action"}</h2><p>{selectedIsForeclosure ? "Title-package cure and future foreclosure-process requirements are separated so counsel knows what blocks the file now versus what comes later." : "This order is being treated as a title examination. Foreclosure target and sale-process requirements are not invented unless the order is actually Foreclosure."}</p></div></div>', 1)
text = text.replace('<div className={styles.notice}>No title-package cure or jurisdictional foreclosure action was identified from the current evidence and loaded rule set.</div>', '<div className={styles.notice}>{selectedIsForeclosure ? "No title-package cure or jurisdictional foreclosure action was identified from the current evidence and loaded rule set." : "No unresolved title-package action was identified from the current evidence and applicable order profile."}</div>', 1)
p.write_text(text)

css = Path("app/demo/demo.module.css")
c = css.read_text()
c = c.replace('.nav{height:64px;', '.nav{height:70px;', 1)
c = c.replace('.brandName{font-size:15px;letter-spacing:.08em}', '.brandName{font-size:16px;font-weight:800;letter-spacing:.01em}', 1)
c = c.replace('.navTag{font-size:12px;', '.printBrand{display:none}.printBrandIdentity{display:flex;align-items:center;gap:14px}.printBrandIdentity strong{display:block;font-size:20px}.printBrandIdentity span{display:block;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.08em;margin-top:3px}.printBrandMeta{font-size:12px;color:#555}.navTag{font-size:12px;', 1)
c = c.replace('@media print{.nav,.hero,.tabs,.setupPanel,.uploadPanel,.exportPanel{display:none!important}.main{padding:0}.panel{border:0;box-shadow:none}.shell{background:#fff}}', '@media print{.nav,.hero,.tabs,.setupPanel,.uploadPanel,.exportPanel{display:none!important}.printBrand{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #d9dce2;padding:0 0 18px;margin:0 0 20px}.main{padding:0}.panel{border:0;box-shadow:none;break-inside:avoid}.shell{background:#fff}.secondary,.primary,.danger{display:none!important}}', 1)
css.write_text(c)

layout = Path("app/layout.tsx")
l = layout.read_text()
l = l.replace('title: "Cybrid Title | Title QC, Curative & Client Data",', 'title: "Cybrid Title | Evidence-Backed Title Examination",', 1)
l = l.replace('description: "Batch title-report QC with evidence-backed findings, foreclosure-readiness and curative review, plus configurable CSV and JSON client data exports.",', 'description: "Evidence-backed title examination with Vera 20 review, report-to-source reconciliation, lien intelligence, examiner decisions, curative workflow and reviewed client exports.",', 1)
layout.write_text(l)

harness = Path("scripts/examiner-workflow-harness.ts")
harness.write_text('''import assert from "node:assert/strict";
import { applyReviewDecisions } from "../lib/review-decision-reducer";

function baseReview() {
  const evidence = [{ page: 4, quote: "Deed of Trust Instrument 111 Amount $100,000", documentType: "Deed of Trust", instrumentNumber: "111" }];
  return {
    record: {
      reviewId: "review-test",
      mortgages: [{ id: "m1", type: "Deed of Trust", instrumentNumber: "111", amount: "$100,000", status: "Open", parties: [{ name: "Lender LLC", role: "Beneficiary" }], evidence, evidenceIds: ["e1"], evidenceState: "CONFIRMED" }],
      targetLien: {
        instrumentId: null,
        instrumentNumber: { value: "Needs review", state: "NOT_STATED", evidence: [], evidenceIds: [], basis: "Unresolved" },
        amount: { value: "Needs review", state: "NOT_STATED", evidence: [], evidenceIds: [], basis: "Unresolved" },
        beneficiary: { value: "Needs review", state: "NOT_STATED", evidence: [], evidenceIds: [], basis: "Unresolved" },
        position: { value: "Needs review", state: "NOT_STATED", evidence: [], evidenceIds: [], basis: "Unresolved" },
        positionBasis: "UNRESOLVED", positionConfidence: "low", selectionRequired: true,
      },
      foreclosureAnalysis: {
        lienStack: [{ instrumentId: "m1", instrumentType: "Deed of Trust", instrumentNumber: "111", amount: "$100,000", recordingDate: "01/02/2025", holder: "Lender LLC", status: "OPEN", chronologicalPosition: 1, positionLabel: "1st Lien", priorityBasis: "FIRST_IN_TIME", priorityConfidence: "high", priorityWarning: "", evidence, evidenceIds: ["e1"] }],
        requirements: [
          { code: "TARGET_LIEN_SELECTION", type: "EVIDENCE", severity: "BLOCKING", title: "Select target", action: "Select", evidence: [] },
          { code: "TARGET_LIEN_AMOUNT", type: "EVIDENCE", severity: "BLOCKING", title: "Amount", action: "Confirm", evidence: [] },
          { code: "TARGET_LIEN_POSITION", type: "PRIORITY_REVIEW", severity: "BLOCKING", title: "Position", action: "Confirm", evidence: [] },
        ],
        targetInstrumentId: null, targetAmount: "Needs review", targetPosition: "Needs review", targetPositionBasis: "UNRESOLVED", targetPositionConfidence: "low", seniorLienIds: [], juniorLienIds: [], openLienCount: 1, status: "CURATIVE_REQUIRED", method: "FIRST_IN_TIME_WITH_EXCEPTION_GATES",
      },
    },
    qc: {
      profileId: "foreclosure-v4", profileVersion: 4, profileName: "Foreclosure",
      checks: [
        { id: "TARGET_LIEN_FOUND", label: "Target lien", category: "Lien", status: "CANNOT_CONFIRM", severity: "CRITICAL", critical: true, summary: "Unresolved", recommendedAction: "Select", evidence: [], evidenceIds: [] },
        { id: "TARGET_LIEN_AMOUNT", label: "Target amount", category: "Lien", status: "CANNOT_CONFIRM", severity: "CRITICAL", critical: true, summary: "Unresolved", recommendedAction: "Confirm", evidence: [], evidenceIds: [] },
        { id: "TARGET_LIEN_POSITION_ESTABLISHED", label: "Target position", category: "Lien", status: "CANNOT_CONFIRM", severity: "CRITICAL", critical: true, summary: "Unresolved", recommendedAction: "Confirm", evidence: [], evidenceIds: [] },
      ],
      qcStatus: "REVIEW", foreclosureReadiness: "CANNOT_CONFIRM", openIssueCount: 3, criticalIssueCount: 3,
    },
  } as any;
}

const selected = applyReviewDecisions(baseReview(), [{ reviewId: "review-test", checkId: "TARGET_LIEN_FOUND", decision: "CORRECT", correctedStatus: "PASS", correctedValue: "111", reason: "Examiner selected controlling security instrument after review.", actor: "examiner", decidedAt: new Date().toISOString() }]);
assert.equal(selected.record.targetLien.instrumentId, "m1");
assert.equal(selected.record.targetLien.amount.value, "$100,000");
assert.equal(selected.record.targetLien.position.value, "1st Lien");
assert.equal(selected.record.targetLien.selectionRequired, false);
assert.equal(selected.record.foreclosureAnalysis.requirements.length, 0);
assert.equal(selected.record.foreclosureAnalysis.status, "READY");
assert.ok(selected.qc.checks.every((check: any) => check.status === "PASS"));
console.log("EXAMINER_WORKFLOW PASS: persisted target selection updates canonical truth and downstream cure state");

const unresolved = baseReview();
unresolved.record.targetLien.instrumentId = "m1";
unresolved.record.targetLien.selectionRequired = false;
unresolved.record.foreclosureAnalysis.targetInstrumentId = "m1";
unresolved.record.foreclosureAnalysis.requirements = [unresolved.record.foreclosureAnalysis.requirements[2]];
const corrected = applyReviewDecisions(unresolved, [{ reviewId: "review-test", checkId: "TARGET_LIEN_POSITION_ESTABLISHED", decision: "CORRECT", correctedStatus: "PASS", correctedValue: "2nd Lien", reason: "Examiner determined priority from the controlling jurisdictional record set.", actor: "examiner", decidedAt: new Date().toISOString() }]);
assert.equal(corrected.record.targetLien.position.value, "2nd Lien");
assert.equal(corrected.record.targetLien.position.state, "EXAMINER_CONFIRMED");
assert.equal(corrected.record.targetLien.positionBasis, "EXAMINER");
assert.equal(corrected.record.foreclosureAnalysis.targetPosition, "2nd Lien");
assert.equal(corrected.record.foreclosureAnalysis.targetPositionBasis, "EXAMINER");
assert.equal(corrected.record.foreclosureAnalysis.requirements.length, 0);
assert.equal(corrected.record.foreclosureAnalysis.status, "READY");
console.log("EXAMINER_WORKFLOW PASS: examiner priority determination is auditable and propagates downstream");
''')

package = Path("package.json")
data = json.loads(package.read_text())
if "examiner-workflow-harness.ts" not in data["scripts"]["verify"]:
    data["scripts"]["verify"] += " && tsx scripts/examiner-workflow-harness.ts"
package.write_text(json.dumps(data, indent=2) + "\n")
