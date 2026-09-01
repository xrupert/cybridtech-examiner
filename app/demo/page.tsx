"use client";

import { upload } from "@vercel/blob/client";
import { useEffect, useMemo, useState } from "react";
import { SEARCH_TYPES } from "@/lib/audit-rules";
import {
  AVAILABLE_EXPORT_COLUMNS,
  MCCALLA_EXPORT_PROFILE,
  createExportProfile,
  renderCsv,
  renderJson,
  validateExportProfile,
  type ExportColumn,
} from "@/lib/export-profiles";
import { applyReviewDecisions } from "@/lib/review-decision-reducer";
import type { ReviewDecisionRecord } from "@/lib/review-decisions";
import { buildVeraAccuracyAudit, veraPassFailReason } from "@/lib/vera-accuracy-audit";
import type { QcCheckResult, QcStatus, TitleReviewResult } from "@/lib/title-domain";
import { Logo } from "../components/Logo";
import { ReviewDecisionControls, type ExaminerDecision, type SavedDecision } from "./ReviewDecisionControls";
import styles from "./demo.module.css";

type ReviewSearchType = "Auto Detect" | (typeof SEARCH_TYPES)[number];
type ItemStatus = "queued" | "processing" | "complete" | "error";
type Readiness = { openAIConfigured: boolean; largeFileStorageConfigured: boolean; authenticationMode?: string; engine?: string; extractionModel?: string; checkModel?: string; pipeline?: string[]; };
type BatchItem = { id: string; manifestItemId: string; fileName: string; status: ItemStatus; review?: TitleReviewResult; error?: string; };
type BatchManifest = { batchId: string; items: Array<{ itemId: string; sourceFile: string }>; };
type DecisionRecord = SavedDecision & { reviewId?: string; actor?: string; decidedAt?: string };
type DecisionMap = Record<string, Record<string, DecisionRecord>>;

function safeName(value: string) { return (value || "cybrid-title").replace(/\.[^/.]+$/, "").replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "cybrid-title"; }
function fileSize(size: number) { if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`; return `${(size / 1024 / 1024).toFixed(1)} MB`; }
async function parseResponse(response: Response) { const text = await response.text(); let payload: any = null; try { payload = text ? JSON.parse(text) : null; } catch { payload = null; } if (!response.ok) throw new Error(payload?.error || text || `Request failed (${response.status})`); return payload; }
function downloadText(filename: string, body: string, type: string) { const blob = new Blob([body], { type }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); }
function statusClass(value: string) { if (value === "CLEAR" || value === "PASS" || value === "NOT_APPLICABLE" || value === "READY") return `${styles.status} ${styles.clear}`; if (value === "CURATIVE_REQUIRED" || value === "FAIL") return `${styles.status} ${styles.curative}`; if (value === "QC_DEFICIENCY") return `${styles.status} ${styles.qc}`; return `${styles.status} ${styles.review}`; }
function auditStatusClass(value: string) { if (["ACCURATE", "COMPLETE", "PRESENT", "NONE"].includes(value)) return statusClass("PASS"); if (value === "DISCREPANCIES") return statusClass("FAIL"); return statusClass("CANNOT_CONFIRM"); }
function veraChecks(review?: TitleReviewResult): QcCheckResult[] { return [...(review?.qc.checks.filter((check) => check.legacyQuestionNumber) || [])].sort((a, b) => (a.legacyQuestionNumber || 0) - (b.legacyQuestionNumber || 0)); }
function supplementalChecks(review?: TitleReviewResult): QcCheckResult[] { return review?.qc.checks.filter((check) => !check.legacyQuestionNumber) || []; }
function isForeclosureReview(review?: TitleReviewResult): boolean { return Boolean(review && review.record.orderType.state === "CONFIRMED" && /^foreclosure$/i.test(review.record.orderType.value)); }

export default function DemoPage() {
  const [clientName, setClientName] = useState("McCalla");
  const [searchType, setSearchType] = useState<ReviewSearchType>("Auto Detect");
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [decisions, setDecisions] = useState<DecisionMap>({});
  const [selectedColumns, setSelectedColumns] = useState<string[]>(MCCALLA_EXPORT_PROFILE.columns.map((column) => column.key));

  useEffect(() => { fetch("/api/examine").then((response) => response.json()).then(setReadiness).catch(() => setReadiness(null)); }, []);
  const availableColumns = useMemo(() => { const byKey = new Map<string, ExportColumn>(); AVAILABLE_EXPORT_COLUMNS.forEach((column) => byKey.set(column.key, column)); return [...byKey.values()]; }, []);
  const completeItems = useMemo(() => items.filter((item) => item.review), [items]);
  const selected = useMemo(() => items.find((item) => item.id === selectedId) || completeItems[0], [items, selectedId, completeItems]);
  const rows = useMemo(() => completeItems.map((item) => ({ record: item.review!.record, qc: item.review!.qc })), [completeItems]);
  const metrics = useMemo(() => ({ total: items.length, clear: completeItems.filter((item) => item.review?.qc.foreclosureReadiness === "CLEAR").length, curative: completeItems.filter((item) => item.review?.qc.foreclosureReadiness === "CURATIVE_REQUIRED").length, review: completeItems.filter((item) => item.review?.qc.foreclosureReadiness === "CANNOT_CONFIRM").length, qc: completeItems.filter((item) => item.review?.qc.foreclosureReadiness === "QC_DEFICIENCY").length }), [items, completeItems]);

  function chooseFiles(list: FileList | null) {
    if (!list?.length || busy) return;
    const chosen = Array.from(list); const invalid = chosen.filter((file) => !file.name.toLowerCase().endsWith(".pdf"));
    if (invalid.length) { setError(`Complete PDF title-report packets are required. Remove: ${invalid.map((file) => file.name).join(", ")}.`); return; }
    setFiles(chosen); setItems([]); setSelectedId(""); setBatchId(""); setProgress(0); setNotice(""); setError(""); setDecisions({});
  }

  async function createBatch(): Promise<BatchManifest> {
    const response = await fetch("/api/batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientName, sourceFiles: files.map((file) => file.name), exportProfileId: "mccalla-v3" }) });
    return parseResponse(response) as Promise<BatchManifest>;
  }

  async function updateBatch(manifestBatchId: string, item: BatchItem, status: "PROCESSING" | "COMPLETE" | "ERROR", review?: TitleReviewResult, message?: string) {
    if (!manifestBatchId || !item.manifestItemId) return;
    await fetch("/api/batches", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: manifestBatchId, itemId: item.manifestItemId, status, reviewId: review?.record.reviewId, packetHash: review?.record.packetHash, error: message }) }).then(parseResponse);
  }

  async function uploadOne(file: File, index: number, total: number) {
    const pathname = `cybrid-title/canonical/${Date.now()}-${index}-${safeName(file.name)}.pdf`;
    const result = await upload(pathname, file, { access: "private", handleUploadUrl: "/api/uploads", clientPayload: JSON.stringify({ mode: "canonical-title-platform" }), contentType: "application/pdf", multipart: file.size > 4_000_000, onUploadProgress: ({ percentage }) => setProgress(Math.round(((index + percentage / 100) / total) * 100)) });
    return result.pathname;
  }

  async function reviewOne(file: File, index: number, total: number): Promise<TitleReviewResult> {
    let response: Response;
    if (readiness?.largeFileStorageConfigured) {
      const pathname = await uploadOne(file, index, total);
      response = await fetch("/api/examine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blobPathnames: [pathname], state: "AUTO", searchType, clientName }) });
    } else {
      if (file.size > 4_000_000) throw new Error("Private large-file storage is required for this packet.");
      const form = new FormData(); form.append("files", file); form.set("state", "AUTO"); form.set("searchType", searchType); form.set("clientName", clientName);
      response = await fetch("/api/examine", { method: "POST", body: form });
    }
    const data = await parseResponse(response);
    if (!data?.review) throw new Error("Cybrid Title returned no canonical title review.");
    return data.review as TitleReviewResult;
  }

  async function loadSavedDecisions(reviewId: string) {
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
  }

  async function runBatch() {
    if (!files.length || busy) return;
    setBusy(true); setError(""); setNotice(""); setProgress(0);
    try {
      const manifest = await createBatch(); setBatchId(manifest.batchId);
      const seed: BatchItem[] = files.map((file, index) => ({ id: `${Date.now()}-${index}`, manifestItemId: manifest.items[index]?.itemId || "", fileName: file.name, status: "queued" }));
      setItems(seed); setSelectedId(seed[0]?.id || "");
      let succeeded = 0;
      for (let index = 0; index < files.length; index += 1) {
        const item = seed[index]; setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "processing" } : candidate));
        try {
          await updateBatch(manifest.batchId, item, "PROCESSING");
          const review = await reviewOne(files[index], index, files.length);
          setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "complete", review } : candidate));
          await updateBatch(manifest.batchId, item, "COMPLETE", review); await loadSavedDecisions(review.record.reviewId); succeeded += 1;
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : "Review failed";
          setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "error", error: message } : candidate));
          await updateBatch(manifest.batchId, item, "ERROR", undefined, message).catch(() => undefined);
        }
        setProgress(Math.round(((index + 1) / files.length) * 100));
      }
      setNotice(`${succeeded} of ${files.length} title packet${files.length === 1 ? "" : "s"} completed. Complete the Vera 20 examiner review, resolve true exceptions, then export the reviewed result.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The batch could not be created."); }
    finally { setBusy(false); }
  }

  function patchReview(id: string, updater: (review: TitleReviewResult) => TitleReviewResult) {
    setItems((current) => current.map((item) => item.id === id && item.review ? { ...item, review: updater(item.review) } : item));
  }

  async function selectTargetLien(item: BatchItem, instrumentId: string) {
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
  }

  function decisionFor(item: BatchItem, checkId: string): DecisionRecord | undefined {
    return item.review ? decisions[item.review.record.reviewId]?.[checkId] : undefined;
  }

  function applySavedDecision(item: BatchItem, saved: SavedDecision) {
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
  }

  async function confirmAllClean(item: BatchItem) {
    if (!item.review) return;
    const clean = veraChecks(item.review).filter((check) => ["PASS", "NOT_APPLICABLE"].includes(check.status) && !decisionFor(item, check.id));
    for (const check of clean) {
      const reason = "Examiner confirmed this clean Vera finding against the displayed packet evidence.";
      const response = await fetch("/api/review-decisions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewId: item.review.record.reviewId, checkId: check.id, decision: "CONFIRM", reason }) });
      if (!response.ok) { setError((await response.json().catch(() => null))?.error || `Could not confirm Vera Question ${check.legacyQuestionNumber}.`); return; }
      applySavedDecision(item, { checkId: check.id, decision: "CONFIRM", reason });
    }
  }

  function openSourcePage(fileName: string, page: number) {
    const file = files.find((candidate) => candidate.name === fileName);
    if (!file) { setError("The original PDF is no longer available in this browser session. Re-select the source PDF to open the cited page."); return; }
    const url = URL.createObjectURL(file);
    window.open(`${url}#page=${page}`, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function pendingVera(item: BatchItem) { return veraChecks(item.review).filter((check) => !decisionFor(item, check.id)); }
  function pendingSupplemental(item: BatchItem) { return supplementalChecks(item.review).filter((check) => !["PASS", "NOT_APPLICABLE"].includes(check.status) && !decisionFor(item, check.id)); }
  function toggleColumn(key: string) { setSelectedColumns((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]); }
  function exportProfile(format: "csv" | "json") { return createExportProfile(clientName, availableColumns.filter((column) => selectedColumns.includes(column.key)), format); }

  const exportWarnings = useMemo(() => {
    if (!rows.length) return [];
    const warnings = [...validateExportProfile(exportProfile("csv"), rows)];
    for (const item of completeItems) {
      const veraPending = pendingVera(item); const supplementalPending = pendingSupplemental(item);
      if (veraPending.length) warnings.push(`${item.fileName}: ${veraPending.length} of the Vera 20 questions still require examiner disposition.`);
      if (supplementalPending.length) warnings.push(`${item.fileName}: ${supplementalPending.length} supplemental order/foreclosure exception${supplementalPending.length === 1 ? "" : "s"} still require examiner disposition.`);
    }
    return warnings;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selectedColumns, completeItems, decisions, clientName, availableColumns]);

  function exportCsv() { if (!rows.length || exportWarnings.length) return; downloadText(`${safeName(clientName)}-title-qc.csv`, renderCsv(exportProfile("csv"), rows), "text/csv;charset=utf-8"); }
  function exportJson() { if (!rows.length || exportWarnings.length) return; downloadText(`${safeName(clientName)}-title-qc.json`, renderJson(exportProfile("json"), rows), "application/json;charset=utf-8"); }
  const modelStatus = readiness?.openAIConfigured ? `${readiness.extractionModel || "extraction model"} → ${readiness.checkModel || "check model"}` : readiness ? "AI not configured" : "Checking system…";

  const selectedVera = veraChecks(selected?.review);
  const selectedSupplemental = supplementalChecks(selected?.review);
  const selectedVeraReviewed = selected ? selectedVera.filter((check) => decisionFor(selected, check.id)).length : 0;
  const selectedReviewComplete = selected ? pendingVera(selected).length === 0 && pendingSupplemental(selected).length === 0 : false;
  const selectedAudit = selected?.review ? buildVeraAccuracyAudit(selected.review.record, selected.review.qc) : [];
  const selectedPassFail = selected?.review ? veraPassFailReason(selected.review.qc) : null;
  const selectedIsForeclosure = isForeclosureReview(selected?.review);

  return <div className={styles.shell}>
    <header className={styles.nav}><div className={styles.brand}><Logo height={40} /><span className={styles.brandName}>Cybrid Title</span></div><span className={styles.navTag}>Title Examination · Vera 20 · Evidence Reconciliation · Curative</span></header>
    <main className={styles.main}>
      <div className={styles.printBrand}><div className={styles.printBrandIdentity}><Logo height={54} /><div><strong>Cybrid Title</strong><span>Evidence-backed Title Examination</span></div></div><div className={styles.printBrandMeta}>Examiner Review{selected?.review ? ` · ${selected.review.record.tsNumber.value}` : ""}</div></div>
      <section className={styles.hero}><div><p className={styles.eyebrow}>Title examiner intelligence workbench</p><h1>Find the title truth. Verify the source. Resolve what prevents the next action.</h1></div><p>Cybrid prepares the Vera 20 examination, reconciles the report to the recorded source documents, develops lien identity and priority only when the order requires it, and turns unresolved findings into a clear examiner or curative work queue before export.</p></section>

      <section className={`${styles.panel} ${styles.setupPanel}`}><div className={styles.setup}>
        <label className={styles.field}>Client / export profile<input value={clientName} onChange={(event) => setClientName(event.target.value)} disabled={busy} /></label>
        <label className={styles.field}>QC / order profile<select value={searchType} onChange={(event) => setSearchType(event.target.value as ReviewSearchType)} disabled={busy}><option>Auto Detect</option>{SEARCH_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
        <div className={styles.profileNote}>State and county are detected from the packet. State-specific foreclosure rules are applied only when a curated rule set exists; unsupported jurisdictions fail transparently rather than inventing law.</div><div className={styles.profileNote}>{modelStatus}<br />{readiness?.engine || "canonical engine"}</div>
      </div></section>

      {error ? <div className={styles.errorBox}>{error}</div> : null}{notice ? <div className={styles.notice}>{notice}</div> : null}
      <section className={`${styles.panel} ${styles.uploadPanel}`}><div className={styles.drop}><div><h2>Upload title-report packets</h2><p>One complete PDF packet becomes one evidence-backed QC, Vera 20, lien-stack, and jurisdiction review.</p></div><div className={styles.actions}><label className={styles.secondary}>Choose PDFs<input hidden type="file" multiple accept="application/pdf,.pdf" onChange={(event) => chooseFiles(event.target.files)} /></label><button className={styles.primary} disabled={!files.length || busy || readiness?.openAIConfigured === false} onClick={runBatch}>{busy ? "Running QC…" : "Run Title QC"}</button></div></div>
        {files.length ? <div className={styles.fileList}>{files.map((file) => <span className={styles.fileChip} key={`${file.name}-${file.size}`}>{file.name} · {fileSize(file.size)}</span>)}</div> : null}
        {busy || progress ? <div className={styles.progressWrap}><div className={styles.progressBar}><div className={styles.progressFill} style={{ width: `${progress}%` }} /></div><div className={styles.progressText}>{progress}% · {batchId ? `Batch ${batchId}` : "preparing batch"}</div></div> : null}
      </section>

      {items.length ? <><section className={styles.metrics}><div className={styles.metric}><span>Batch</span><strong>{metrics.total}</strong></div><div className={`${styles.metric} ${styles.metricClear}`}><span>Clear</span><strong>{metrics.clear}</strong></div><div className={`${styles.metric} ${styles.metricCurative}`}><span>Curative</span><strong>{metrics.curative}</strong></div><div className={`${styles.metric} ${styles.metricReview}`}><span>Cannot confirm</span><strong>{metrics.review}</strong></div><div className={styles.metric}><span>QC deficiency</span><strong>{metrics.qc}</strong></div></section>
        <section className={styles.panel}><div className={styles.sectionTitle}><div><h2>Batch results</h2><p>Click the order number to complete examiner review. “Reviewed” and “Clear/Pass” are intentionally separate states.</p></div></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>TS / Order #</th><th>Order Profile</th><th>Owner / Borrower</th><th>Property</th><th>Target Lien</th><th>Lien Amount</th><th>Lien Position</th><th>Priority Basis</th><th>Workflow</th><th>QC</th><th>Source</th></tr></thead><tbody>
          {items.map((item) => item.review ? <tr key={item.id}><td><button className={styles.rowButton} onClick={() => setSelectedId(item.id)}>{item.review.record.tsNumber.value}</button></td><td>{item.review.qc.profileName}</td><td>{isForeclosureReview(item.review) ? item.review.record.borrower.value : item.review.record.currentOwner.value}</td><td>{item.review.record.propertyAddress.value}</td>
            <td>{isForeclosureReview(item.review) ? (item.review.record.targetLien.selectionRequired ? <select className={styles.editInput} value="" onChange={(event) => void selectTargetLien(item, event.target.value)}><option value="">Resolve target ambiguity…</option>{item.review.record.mortgages.map((mortgage) => <option value={mortgage.id} key={mortgage.id}>{mortgage.instrumentNumber} · {mortgage.amount}</option>)}</select> : item.review.record.targetLien.instrumentNumber.value) : "—"}</td>
            <td>{isForeclosureReview(item.review) ? item.review.record.targetLien.amount.value : "—"}</td><td>{isForeclosureReview(item.review) ? item.review.record.targetLien.position.value : "—"}</td>
            <td>{isForeclosureReview(item.review) ? `${item.review.record.targetLien.positionBasis.replaceAll("_", " ")} · ${item.review.record.targetLien.positionConfidence}` : "—"}</td><td>{isForeclosureReview(item.review) ? <span className={statusClass(item.review.record.foreclosureAnalysis.status)}>{item.review.record.foreclosureAnalysis.status.replaceAll("_", " ")}</span> : <span className={statusClass("PASS")}>TITLE REVIEW</span>}</td><td><span className={statusClass(item.review.qc.qcStatus)}>{item.review.qc.qcStatus}</span></td><td>{item.fileName}</td></tr> : <tr key={item.id}><td colSpan={11}>{item.fileName} — <span className={item.status === "error" ? `${styles.status} ${styles.error}` : `${styles.status} ${styles.review}`}>{item.status.toUpperCase()}</span>{item.error ? ` · ${item.error}` : ""}</td></tr>)}
        </tbody></table></div></section></> : null}

      {selected?.review ? <>
        <section className={styles.panel}>
          <div className={styles.sectionTitle}><div><h2>{selected.review.record.tsNumber.value} · Examiner review</h2><p>RCS report run sheet / Exceptions: {selected.review.record.titleSummary.detected ? `pages ${selected.review.record.titleSummary.pageStart ?? "?"}–${selected.review.record.titleSummary.pageEnd ?? "?"}` : "not segmented"} · Separate Abstractor Sheet: {selected.review.record.runSheet.detected ? `pages ${selected.review.record.runSheet.pageStart ?? "?"}–${selected.review.record.runSheet.pageEnd ?? "?"}` : "not supplied"}</p></div><div className={styles.actions}><span className={statusClass(selectedReviewComplete ? "PASS" : "CANNOT_CONFIRM")}>{selectedReviewComplete ? "REVIEW COMPLETE" : "REVIEW PENDING"}</span><span className={statusClass(selected.review.qc.foreclosureReadiness)}>{selected.review.qc.foreclosureReadiness.replaceAll("_", " ")}</span></div></div>
          <div className={styles.detailGrid}><div className={styles.summaryCard}><dl>
            <dt>Order type</dt><dd>{selected.review.record.orderType.value}</dd><dt>Borrower</dt><dd>{selected.review.record.borrower.value}</dd><dt>Current owner</dt><dd>{selected.review.record.currentOwner.value}</dd><dt>Property</dt><dd>{selected.review.record.propertyAddress.value}</dd><dt>State / County</dt><dd>{selected.review.record.state.value} / {selected.review.record.county.value}</dd>
            <dt>RCS report run sheet</dt><dd>{selected.review.record.titleSummary.detected ? `${selected.review.record.titleSummary.entries.length} material entries · pp. ${selected.review.record.titleSummary.pageStart ?? "?"}–${selected.review.record.titleSummary.pageEnd ?? "?"}` : "Could not segment"}</dd><dt>Separate Abstractor Sheet</dt><dd>{selected.review.record.runSheet.detected ? "Detected" : "Not supplied"}</dd>
            <dt>Target lien</dt><dd>{selectedIsForeclosure ? selected.review.record.targetLien.instrumentNumber.value : "Not applicable to this order"}</dd><dt>Lien amount</dt><dd>{selectedIsForeclosure ? selected.review.record.targetLien.amount.value : "—"}</dd><dt>Lien position</dt><dd>{selectedIsForeclosure ? selected.review.record.targetLien.position.value : "—"}</dd><dt>Position basis</dt><dd>{selectedIsForeclosure ? `${selected.review.record.targetLien.positionBasis.replaceAll("_", " ")} · ${selected.review.record.targetLien.positionConfidence}` : "—"}</dd><dt>Open lien identities</dt><dd>{selected.review.record.foreclosureAnalysis.openLienCount}</dd><dt>QC profile</dt><dd>{selected.review.qc.profileName} v{selected.review.qc.profileVersion}</dd>
            <dt>Vera review</dt><dd>{selectedVeraReviewed}/{selectedVera.length || 20} dispositioned</dd>
          </dl>
          {selected.review.record.foreclosureAnalysis.jurisdictionCoverage ? <div className={styles.notice} style={{ marginTop: 14, marginBottom: 0 }}><b>Jurisdiction coverage: {selected.review.record.foreclosureAnalysis.jurisdictionCoverage.status}</b><br />{selected.review.record.foreclosureAnalysis.jurisdictionCoverage.state} · {selected.review.record.foreclosureAnalysis.jurisdictionCoverage.county}<br />{selected.review.record.foreclosureAnalysis.jurisdictionCoverage.note}</div> : null}
          <div className={styles.curativeList} style={{ marginTop: 14 }}><b>Developed lien stack</b>{selected.review.record.foreclosureAnalysis.lienStack.map((entry) => <span className={styles.curativeItem} key={entry.instrumentId}><b>{entry.positionLabel}</b> · {entry.status} · {entry.instrumentType} · {entry.instrumentNumber} · {entry.amount} · {entry.recordingDate}{entry.priorityWarning ? ` · REVIEW: ${entry.priorityWarning}` : ""}</span>)}</div>
          </div>
          <div>
            <div className={styles.sectionTitle}><div><h2>{selectedIsForeclosure ? "Foreclosure cure / action" : "Title exceptions / examiner action"}</h2><p>{selectedIsForeclosure ? "Title-package cure and future foreclosure-process requirements are separated so counsel knows what blocks the file now versus what comes later." : "This order is being treated as a title examination. Foreclosure target and sale-process requirements are not invented unless the order is actually Foreclosure."}</p></div></div>
            {selected.review.record.foreclosureAnalysis.requirements.length ? <div className={styles.issues}>{selected.review.record.foreclosureAnalysis.requirements.map((requirement) => <div className={styles.issue} key={requirement.code}><div className={styles.issueTop}><div><h3>{requirement.title}</h3><p>{requirement.action}</p></div><span className={statusClass(requirement.severity === "BLOCKING" ? "FAIL" : requirement.severity === "INFO" ? "PASS" : "CANNOT_CONFIRM")}>{requirement.scope?.replaceAll("_", " ") || requirement.type}</span></div>{requirement.jurisdiction || requirement.authority ? <div className={styles.profileNote} style={{ marginTop: 8 }}>{requirement.jurisdiction || ""}{requirement.authority ? <> · <a href={requirement.authorityUrl} target="_blank" rel="noreferrer">{requirement.authority}</a></> : null}{requirement.ruleVersion ? ` · ${requirement.ruleVersion}` : ""}</div> : null}</div>)}</div> : <div className={styles.notice}>{selectedIsForeclosure ? "No title-package cure or jurisdictional foreclosure action was identified from the current evidence and loaded rule set." : "No unresolved title-package action was identified from the current evidence and applicable order profile."}</div>}
          </div></div>
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionTitle}><div><h2>Title Report / Run Sheet Accuracy Audit</h2><p>This is the six-part Vera audit derived from the current reviewed findings, not a second independent AI opinion.</p></div><span className={statusClass(selectedPassFail?.status === "Pass" ? "PASS" : "FAIL")}>{selectedPassFail?.status.toUpperCase()}</span></div>
          <div className={styles.issues}>{selectedAudit.map((area) => <div className={styles.issue} key={area.key}><div className={styles.issueTop}><div><h3>{area.label}</h3><p>{area.summary}</p></div><span className={auditStatusClass(area.status)}>{area.status}</span></div></div>)}</div>
          {selectedPassFail ? <div className={selectedPassFail.status === "Pass" ? styles.notice : styles.errorBox} style={{ marginTop: 14, marginBottom: 0 }}><b>Pass/Fail Determination — {selectedPassFail.status}</b><br /><b>Reason:</b> {selectedPassFail.reason}<br /><b>Confirmation:</b> {selectedPassFail.confirmation}{!selectedReviewComplete ? <><br /><b>Review status:</b> Examiner dispositions are still incomplete; this determination remains provisional until review completion.</> : null}</div> : null}
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionTitle}><div><h2>Vera 20 · required examiner review</h2><p>Every question shows the machine finding, grounded page evidence, and a human disposition. You can confirm a PASS, reject/correct it, or require more evidence.</p></div><div className={styles.actions}><span className={statusClass(selectedVeraReviewed === 20 ? "PASS" : "CANNOT_CONFIRM")}>{selectedVeraReviewed}/20 REVIEWED</span><button className={styles.secondary} disabled={!selectedVera.some((check) => ["PASS", "NOT_APPLICABLE"].includes(check.status) && !decisionFor(selected, check.id))} onClick={() => confirmAllClean(selected)}>Confirm all clean</button></div></div>
          <div className={styles.issues}>{selectedVera.map((check) => <div className={styles.issue} key={check.id}><div className={styles.issueTop}><div><h3>Q{check.legacyQuestionNumber}. {check.label}</h3><p>{check.summary}</p></div><span className={statusClass(check.status)}>{check.status.replaceAll("_", " ")}</span></div>
            {check.status !== "PASS" && check.status !== "NOT_APPLICABLE" ? <div className={styles.profileNote} style={{ marginTop: 8 }}><b>What to do:</b> {check.recommendedAction}</div> : null}
            {check.evidence.length ? check.evidence.slice(0, 3).map((evidence, index) => <div className={styles.evidence} key={`${check.id}-${evidence.page}-${index}`}><div><b>Page {evidence.page} · {evidence.documentType}</b><br />“{evidence.quote}”</div><button className={styles.secondary} style={{ marginTop: 7, height: 32 }} onClick={() => openSourcePage(selected.fileName, evidence.page)}>Open source page {evidence.page}</button></div>) : <div className={styles.evidence}>No grounded source quote is attached to this conclusion. Confirm only if you independently verified it; otherwise use <b>Need evidence</b> or <b>Reject / correct</b>.</div>}
            <ReviewDecisionControls reviewId={selected.review!.record.reviewId} check={check} currentDecision={decisionFor(selected, check.id)?.decision} onSaved={(saved) => applySavedDecision(selected, saved)} />
          </div>)}</div>
        </section>

        {selectedSupplemental.length ? <section className={styles.panel}><div className={styles.sectionTitle}><div><h2>Order-specific checks</h2><p>These are supplemental to the Vera 20. Only unresolved/failed supplemental checks require a disposition before export.</p></div></div><div className={styles.issues}>{selectedSupplemental.map((check) => <div className={styles.issue} key={check.id}><div className={styles.issueTop}><div><h3>{check.label}</h3><p>{check.summary}</p></div><span className={statusClass(check.status)}>{check.status.replaceAll("_", " ")}</span></div>{check.evidence.slice(0, 2).map((evidence, index) => <div className={styles.evidence} key={`${check.id}-${evidence.page}-${index}`}><b>Page {evidence.page} · {evidence.documentType}</b><br />“{evidence.quote}”<br /><button className={styles.secondary} style={{ marginTop: 7, height: 32 }} onClick={() => openSourcePage(selected.fileName, evidence.page)}>Open source page {evidence.page}</button></div>)}{!["PASS", "NOT_APPLICABLE"].includes(check.status) ? <ReviewDecisionControls reviewId={selected.review!.record.reviewId} check={check} currentDecision={decisionFor(selected, check.id)?.decision} onSaved={(saved) => applySavedDecision(selected, saved)} /> : null}</div>)}</div></section> : null}
      </> : null}

      {completeItems.length ? <section className={`${styles.panel} ${styles.exportPanel}`}><div className={styles.sectionTitle}><div><h2>Reviewed client export</h2><p><b>Review complete</b> means every required finding has an examiner disposition. It does not mean the title is clear. A confirmed FAIL/CANNOT CONFIRM remains visible in the exported review and in QC/curative status.</p></div></div><div className={styles.exportGrid}><div className={styles.exportFields}>{availableColumns.map((column) => <label className={styles.check} key={column.key}><input type="checkbox" checked={selectedColumns.includes(column.key)} onChange={() => toggleColumn(column.key)} />{column.label}{column.required ? " *" : ""}</label>)}</div><div>{exportWarnings.length ? <div className={styles.errorBox}><b>Review export blocked until:</b>{exportWarnings.slice(0, 16).map((warning) => <div key={warning}>• {warning}</div>)}</div> : <div className={styles.notice}><b>Review export ready.</b> All required client fields and examiner dispositions are complete. The exported QC status remains {completeItems.some((item) => item.review?.qc.qcStatus === "FAIL") ? "FAIL where confirmed defects remain" : completeItems.some((item) => item.review?.qc.qcStatus === "REVIEW") ? "REVIEW where evidence remains unresolved" : "PASS"}.</div>}<div className={styles.actions}><button className={styles.primary} disabled={!rows.length || Boolean(exportWarnings.length)} onClick={exportCsv}>Export CSV</button><button className={styles.secondary} disabled={!rows.length || Boolean(exportWarnings.length)} onClick={exportJson}>Export JSON</button><button className={styles.secondary} disabled={!selected?.review || !selectedReviewComplete} onClick={() => window.print()}>Print / Save review</button></div></div></div></section> : null}
    </main>
  </div>;
}
