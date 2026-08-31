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
import { reduceQcChecks } from "@/lib/title-qc-engine";
import type { QcCheckResult, QcStatus, TitleReviewResult } from "@/lib/title-domain";
import { Logo } from "../components/Logo";
import styles from "./demo.module.css";

type ReviewSearchType = "Auto Detect" | (typeof SEARCH_TYPES)[number];
type ItemStatus = "queued" | "processing" | "complete" | "error";
type ExaminerDecision = "CONFIRM" | "CORRECT" | "NEEDS_EVIDENCE";
type Readiness = { openAIConfigured: boolean; largeFileStorageConfigured: boolean; authenticationMode?: string; engine?: string; extractionModel?: string; checkModel?: string; pipeline?: string[]; };
type BatchItem = { id: string; manifestItemId: string; fileName: string; status: ItemStatus; review?: TitleReviewResult; error?: string; };
type BatchManifest = { batchId: string; items: Array<{ itemId: string; sourceFile: string }>; };
type DecisionMap = Record<string, Record<string, ExaminerDecision>>;

function safeName(value: string) { return (value || "cybrid-title").replace(/\.[^/.]+$/, "").replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "cybrid-title"; }
function fileSize(size: number) { if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`; return `${(size / 1024 / 1024).toFixed(1)} MB`; }
async function parseResponse(response: Response) { const text = await response.text(); let payload: any = null; try { payload = text ? JSON.parse(text) : null; } catch { payload = null; } if (!response.ok) throw new Error(payload?.error || text || `Request failed (${response.status})`); return payload; }
function downloadText(filename: string, body: string, type: string) { const blob = new Blob([body], { type }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url); }
function statusClass(value: string) { if (value === "CLEAR" || value === "PASS" || value === "NOT_APPLICABLE" || value === "READY") return `${styles.status} ${styles.clear}`; if (value === "CURATIVE_REQUIRED" || value === "FAIL") return `${styles.status} ${styles.curative}`; if (value === "QC_DEFICIENCY") return `${styles.status} ${styles.qc}`; return `${styles.status} ${styles.review}`; }
function exceptionChecks(review?: TitleReviewResult): QcCheckResult[] { return review?.qc.checks.filter((check) => !["PASS", "NOT_APPLICABLE"].includes(check.status)) || []; }

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
  async function createBatch(): Promise<BatchManifest> { const response = await fetch("/api/batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientName, sourceFiles: files.map((file) => file.name), exportProfileId: "mccalla-v2" }) }); return parseResponse(response) as Promise<BatchManifest>; }
  async function updateBatch(manifestBatchId: string, item: BatchItem, status: "PROCESSING" | "COMPLETE" | "ERROR", review?: TitleReviewResult, message?: string) { if (!manifestBatchId || !item.manifestItemId) return; await fetch("/api/batches", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: manifestBatchId, itemId: item.manifestItemId, status, reviewId: review?.record.reviewId, packetHash: review?.record.packetHash, error: message }) }).then(parseResponse); }
  async function uploadOne(file: File, index: number, total: number) { const pathname = `cybrid-title/canonical/${Date.now()}-${index}-${safeName(file.name)}.pdf`; const result = await upload(pathname, file, { access: "private", handleUploadUrl: "/api/uploads", clientPayload: JSON.stringify({ mode: "canonical-title-platform" }), contentType: "application/pdf", multipart: file.size > 4_000_000, onUploadProgress: ({ percentage }) => setProgress(Math.round(((index + percentage / 100) / total) * 100)) }); return result.pathname; }
  async function reviewOne(file: File, index: number, total: number): Promise<TitleReviewResult> {
    let response: Response;
    if (readiness?.largeFileStorageConfigured) { const pathname = await uploadOne(file, index, total); response = await fetch("/api/examine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blobPathnames: [pathname], state: "AUTO", searchType, clientName }) }); }
    else { if (file.size > 4_000_000) throw new Error("Private large-file storage is required for this packet."); const form = new FormData(); form.append("files", file); form.set("state", "AUTO"); form.set("searchType", searchType); form.set("clientName", clientName); response = await fetch("/api/examine", { method: "POST", body: form }); }
    const data = await parseResponse(response); if (!data?.review) throw new Error("Cybrid Title returned no canonical title review."); return data.review as TitleReviewResult;
  }
  async function loadSavedDecisions(reviewId: string) { try { const response = await fetch(`/api/review-decisions?reviewId=${encodeURIComponent(reviewId)}`); if (!response.ok) return; const manifest = await response.json() as { decisions?: Array<{ checkId: string; decision: ExaminerDecision }> }; const mapped = Object.fromEntries((manifest.decisions || []).map((decision) => [decision.checkId, decision.decision])); setDecisions((current) => ({ ...current, [reviewId]: mapped })); } catch { /* review remains usable */ } }
  async function runBatch() {
    if (!files.length || busy) return; setBusy(true); setError(""); setNotice(""); setProgress(0);
    try {
      const manifest = await createBatch(); setBatchId(manifest.batchId);
      const seed: BatchItem[] = files.map((file, index) => ({ id: `${Date.now()}-${index}`, manifestItemId: manifest.items[index]?.itemId || "", fileName: file.name, status: "queued" })); setItems(seed); setSelectedId(seed[0]?.id || "");
      let succeeded = 0;
      for (let index = 0; index < files.length; index += 1) {
        const item = seed[index]; setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "processing" } : candidate));
        try { await updateBatch(manifest.batchId, item, "PROCESSING"); const review = await reviewOne(files[index], index, files.length); setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "complete", review } : candidate)); await updateBatch(manifest.batchId, item, "COMPLETE", review); await loadSavedDecisions(review.record.reviewId); succeeded += 1; }
        catch (caught) { const message = caught instanceof Error ? caught.message : "Review failed"; setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "error", error: message } : candidate)); await updateBatch(manifest.batchId, item, "ERROR", undefined, message).catch(() => undefined); }
        setProgress(Math.round(((index + 1) / files.length) * 100));
      }
      setNotice(`${succeeded} of ${files.length} title packet${files.length === 1 ? "" : "s"} completed. Review the lien stack, foreclosure cure/action items, and true QC exceptions before export.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The batch could not be created."); } finally { setBusy(false); }
  }

  function patchReview(id: string, updater: (review: TitleReviewResult) => TitleReviewResult) { setItems((current) => current.map((item) => item.id === id && item.review ? { ...item, review: updater(item.review) } : item)); }
  function selectTargetLien(item: BatchItem, instrumentId: string) {
    if (!item.review) return;
    patchReview(item.id, (review) => {
      const mortgage = review.record.mortgages.find((candidate) => candidate.id === instrumentId); if (!mortgage) return review;
      const stackEntry = review.record.foreclosureAnalysis.lienStack.find((entry) => entry.instrumentId === instrumentId);
      const beneficiary = mortgage.parties.find((party) => /holder|beneficiary|mortgagee|lender/i.test(party.role))?.name || "Needs review";
      const confirmed = mortgage.evidence.length ? "CONFIRMED" as const : "UNCONFIRMED" as const;
      const positionValue = stackEntry?.positionLabel || "Needs review";
      const positionState = positionValue === "Needs review" ? "NOT_STATED" as const : stackEntry?.priorityConfidence === "high" ? "CONFIRMED" as const : "UNCONFIRMED" as const;
      const seniorLienIds = stackEntry?.chronologicalPosition ? review.record.foreclosureAnalysis.lienStack.filter((entry) => entry.status !== "RELEASED" && entry.chronologicalPosition != null && entry.chronologicalPosition < stackEntry.chronologicalPosition!).map((entry) => entry.instrumentId) : [];
      const juniorLienIds = stackEntry?.chronologicalPosition ? review.record.foreclosureAnalysis.lienStack.filter((entry) => entry.status !== "RELEASED" && entry.chronologicalPosition != null && entry.chronologicalPosition > stackEntry.chronologicalPosition!).map((entry) => entry.instrumentId) : [];
      const remainingRequirements = review.record.foreclosureAnalysis.requirements.filter((requirement) => !["TARGET_LIEN_SELECTION", "TARGET_LIEN_AMOUNT", "TARGET_LIEN_POSITION"].includes(requirement.code));
      const analysisStatus = mortgage.amount === "Needs review" || positionValue === "Needs review" ? "CURATIVE_REQUIRED" as const : remainingRequirements.length ? "REVIEW" as const : "READY" as const;
      const record = {
        ...review.record,
        targetLien: {
          ...review.record.targetLien,
          instrumentId: mortgage.id,
          instrumentNumber: { value: mortgage.instrumentNumber, state: confirmed, evidence: mortgage.evidence, evidenceIds: mortgage.evidenceIds, basis: "Examiner selected target lien" },
          amount: { value: mortgage.amount, state: mortgage.amount === "Needs review" ? "NOT_STATED" as const : confirmed, evidence: mortgage.evidence, evidenceIds: mortgage.evidenceIds, basis: "Amount from examiner-selected target lien" },
          beneficiary: { value: beneficiary, state: beneficiary === "Needs review" ? "NOT_STATED" as const : confirmed, evidence: mortgage.evidence, evidenceIds: mortgage.evidenceIds, basis: "Beneficiary/holder on examiner-selected target lien" },
          position: { value: positionValue, state: positionState, evidence: stackEntry?.evidence || mortgage.evidence, evidenceIds: stackEntry?.evidenceIds || mortgage.evidenceIds, basis: positionValue === "Needs review" ? "Position unresolved" : `Developed from lien stack using ${stackEntry?.priorityBasis || "UNRESOLVED"}` },
          positionBasis: stackEntry?.priorityBasis || "UNRESOLVED",
          positionConfidence: stackEntry?.priorityConfidence || "low",
          selectionRequired: false,
        },
        foreclosureAnalysis: {
          ...review.record.foreclosureAnalysis,
          targetInstrumentId: mortgage.id,
          targetAmount: mortgage.amount,
          targetPosition: positionValue,
          targetPositionBasis: stackEntry?.priorityBasis || "UNRESOLVED",
          targetPositionConfidence: stackEntry?.priorityConfidence || "low",
          seniorLienIds,
          juniorLienIds,
          requirements: remainingRequirements,
          status: analysisStatus,
        },
      };
      const checks = review.qc.checks.map((check) => check.id === "TARGET_LIEN_FOUND" ? { ...check, status: "PASS" as const, summary: `Target lien selected by examiner: ${mortgage.instrumentNumber}.`, evidence: mortgage.evidence, evidenceIds: mortgage.evidenceIds } : check.id === "TARGET_LIEN_POSITION_ESTABLISHED" && positionState === "CONFIRMED" ? { ...check, status: "PASS" as const, summary: `Target lien position developed as ${positionValue}.`, evidence: stackEntry?.evidence || mortgage.evidence, evidenceIds: stackEntry?.evidenceIds || mortgage.evidenceIds } : check);
      return { ...review, record, qc: reduceQcChecks(review.qc, checks) };
    });
  }
  function setLienPosition(item: BatchItem, value: string) {
    if (!item.review) return;
    patchReview(item.id, (review) => {
      const normalized = value.trim() || "Needs review";
      const record = {
        ...review.record,
        targetLien: {
          ...review.record.targetLien,
          position: { value: normalized, state: normalized === "Needs review" ? "NOT_STATED" as const : "CONFIRMED" as const, evidence: review.record.targetLien.position.evidence, evidenceIds: review.record.targetLien.position.evidenceIds, basis: normalized === "Needs review" ? "Lien position unresolved" : "Examiner-confirmed lien position override" },
          positionBasis: normalized === "Needs review" ? "UNRESOLVED" as const : "EXPLICIT" as const,
          positionConfidence: normalized === "Needs review" ? "low" as const : "high" as const,
        },
        foreclosureAnalysis: { ...review.record.foreclosureAnalysis, targetPosition: normalized, targetPositionBasis: normalized === "Needs review" ? "UNRESOLVED" as const : "EXPLICIT" as const, targetPositionConfidence: normalized === "Needs review" ? "low" as const : "high" as const },
      };
      const checks = review.qc.checks.map((check) => check.id === "TARGET_LIEN_POSITION_ESTABLISHED" ? { ...check, status: normalized === "Needs review" ? "CANNOT_CONFIRM" as const : "PASS" as const, summary: normalized === "Needs review" ? "Lien position remains unresolved." : `Target lien position confirmed by examiner as ${normalized}.` } : check);
      return { ...review, record, qc: reduceQcChecks(review.qc, checks) };
    });
  }
  async function decide(item: BatchItem, check: QcCheckResult, decision: ExaminerDecision) {
    if (!item.review) return;
    const reason = decision === "CONFIRM" ? "Examiner confirmed this finding against the displayed packet evidence." : window.prompt("Decision reason:", decision === "NEEDS_EVIDENCE" ? "Additional source evidence is required." : "Examiner correction") || ""; if (!reason.trim()) return;
    let correctedStatus: QcStatus | undefined; let correctedValue: string | undefined;
    if (decision === "CORRECT") { const entered = (window.prompt("Correct status: PASS, FAIL, CANNOT_CONFIRM, or NOT_APPLICABLE", "PASS") || "").trim().toUpperCase(); if (!["PASS", "FAIL", "CANNOT_CONFIRM", "NOT_APPLICABLE"].includes(entered)) return; correctedStatus = entered as QcStatus; correctedValue = window.prompt("Corrected finding/summary:", check.summary) || check.summary; }
    const response = await fetch("/api/review-decisions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewId: item.review.record.reviewId, checkId: check.id, decision, correctedStatus, correctedValue, reason }) });
    if (!response.ok) { setError((await response.json().catch(() => null))?.error || "Could not save examiner decision."); return; }
    setDecisions((current) => ({ ...current, [item.review!.record.reviewId]: { ...(current[item.review!.record.reviewId] || {}), [check.id]: decision } }));
    if (decision !== "CONFIRM") patchReview(item.id, (review) => { const checks = review.qc.checks.map((candidate) => candidate.id === check.id ? { ...candidate, status: decision === "NEEDS_EVIDENCE" ? "CANNOT_CONFIRM" as const : correctedStatus || candidate.status, summary: decision === "CORRECT" ? correctedValue || candidate.summary : `${candidate.summary} Examiner requires additional evidence.` } : candidate); return { ...review, qc: reduceQcChecks(review.qc, checks) }; });
  }

  function decisionFor(item: BatchItem, checkId: string) { return item.review ? decisions[item.review.record.reviewId]?.[checkId] : undefined; }
  function unresolvedDecisions(item: BatchItem) { return exceptionChecks(item.review).filter((check) => !decisionFor(item, check.id)).length; }
  function toggleColumn(key: string) { setSelectedColumns((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]); }
  function exportProfile(format: "csv" | "json") { return createExportProfile(clientName, availableColumns.filter((column) => selectedColumns.includes(column.key)), format); }
  const exportWarnings = useMemo(() => { if (!rows.length) return []; const fieldWarnings = validateExportProfile(exportProfile("csv"), rows); const decisionWarnings = completeItems.flatMap((item) => { const count = unresolvedDecisions(item); return count ? [`${item.fileName}: ${count} true QC exception${count === 1 ? "" : "s"} still require examiner disposition.`] : []; }); return [...fieldWarnings, ...decisionWarnings]; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [rows, selectedColumns, completeItems, decisions, clientName, availableColumns]);
  function exportCsv() { if (!rows.length || exportWarnings.length) return; downloadText(`${safeName(clientName)}-title-qc.csv`, renderCsv(exportProfile("csv"), rows), "text/csv;charset=utf-8"); }
  function exportJson() { if (!rows.length || exportWarnings.length) return; downloadText(`${safeName(clientName)}-title-qc.json`, renderJson(exportProfile("json"), rows), "application/json;charset=utf-8"); }
  const modelStatus = readiness?.openAIConfigured ? `${readiness.extractionModel || "extraction model"} → ${readiness.checkModel || "check model"}` : readiness ? "AI not configured" : "Checking system…";

  return <div className={styles.shell}>
    <header className={styles.nav}><div className={styles.brand}><Logo height={32} /><span className={styles.brandName}>CYBRID TITLE</span></div><span className={styles.navTag}>Title QC · Lien Priority · Foreclosure Curative · Client Data</span></header>
    <main className={styles.main}>
      <section className={styles.hero}><div><p className={styles.eyebrow}>Canonical title intelligence workbench</p><h1>Review the title. Develop the lien stack. See what foreclosure needs next.</h1></div><p>Order-type QC and foreclosure analysis are separate. A Current Owner Search does not inherit false foreclosure defects, but Cybrid Title still develops lien amount, first-in-time position, senior/junior interests, and McCalla cure/action output.</p></section>
      <section className={`${styles.panel} ${styles.setupPanel}`}><div className={styles.setup}>
        <label className={styles.field}>Client / export profile<input value={clientName} onChange={(event) => setClientName(event.target.value)} disabled={busy} /></label>
        <label className={styles.field}>QC / order profile<select value={searchType} onChange={(event) => setSearchType(event.target.value as ReviewSearchType)} disabled={busy}><option>Auto Detect</option>{SEARCH_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
        <div className={styles.profileNote}>State is detected from each packet. Lien priority starts with first-in-time recording chronology and is downgraded for tax, mechanics, HOA, UCC, same-day sequencing, or other priority exceptions.</div><div className={styles.profileNote}>{modelStatus}<br />{readiness?.engine || "canonical engine"}</div>
      </div></section>
      {error ? <div className={styles.errorBox}>{error}</div> : null}{notice ? <div className={styles.notice}>{notice}</div> : null}
      <section className={`${styles.panel} ${styles.uploadPanel}`}><div className={styles.drop}><div><h2>Upload title-report packets</h2><p>One PDF packet is one isolated QC + lien-stack job. Upload one or a batch.</p></div><div className={styles.actions}><label className={styles.secondary}>Choose PDFs<input hidden type="file" multiple accept="application/pdf,.pdf" onChange={(event) => chooseFiles(event.target.files)} /></label><button className={styles.primary} disabled={!files.length || busy || readiness?.openAIConfigured === false} onClick={runBatch}>{busy ? "Running QC…" : "Run Title QC"}</button></div></div>
        {files.length ? <div className={styles.fileList}>{files.map((file) => <span className={styles.fileChip} key={`${file.name}-${file.size}`}>{file.name} · {fileSize(file.size)}</span>)}</div> : null}
        {busy || progress ? <div className={styles.progressWrap}><div className={styles.progressBar}><div className={styles.progressFill} style={{ width: `${progress}%` }} /></div><div className={styles.progressText}>{progress}% · {batchId ? `Batch ${batchId}` : "preparing batch"}</div></div> : null}
      </section>
      {items.length ? <><section className={styles.metrics}><div className={styles.metric}><span>Batch</span><strong>{metrics.total}</strong></div><div className={`${styles.metric} ${styles.metricClear}`}><span>Clear</span><strong>{metrics.clear}</strong></div><div className={`${styles.metric} ${styles.metricCurative}`}><span>Curative</span><strong>{metrics.curative}</strong></div><div className={`${styles.metric} ${styles.metricReview}`}><span>Cannot confirm</span><strong>{metrics.review}</strong></div><div className={styles.metric}><span>QC deficiency</span><strong>{metrics.qc}</strong></div></section>
        <section className={styles.panel}><div className={styles.sectionTitle}><div><h2>Batch results</h2><p>McCalla foreclosure fields are developed on every order; QC defects remain scoped to the actual order type.</p></div></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>TS / Order #</th><th>Order Profile</th><th>Borrower</th><th>Property</th><th>Target Lien</th><th>Lien Amount</th><th>Lien Position</th><th>Priority Basis</th><th>Foreclosure Analysis</th><th>QC</th><th>Source</th></tr></thead><tbody>
          {items.map((item) => item.review ? <tr key={item.id}><td><button className={styles.rowButton} onClick={() => setSelectedId(item.id)}>{item.review.record.tsNumber.value}</button></td><td>{item.review.qc.profileName}</td><td>{item.review.record.borrower.value}</td><td>{item.review.record.propertyAddress.value}</td>
            <td>{item.review.record.targetLien.selectionRequired ? <select className={styles.editInput} value="" onChange={(event) => selectTargetLien(item, event.target.value)}><option value="">Select target lien</option>{item.review.record.mortgages.map((mortgage) => <option value={mortgage.id} key={mortgage.id}>{mortgage.instrumentNumber} · {mortgage.amount}</option>)}</select> : item.review.record.targetLien.instrumentNumber.value}</td>
            <td>{item.review.record.targetLien.amount.value}</td>
            <td><input className={styles.editInput} value={item.review.record.targetLien.position.value === "Needs review" ? "" : item.review.record.targetLien.position.value} placeholder="Needs review" onChange={(event) => setLienPosition(item, event.target.value)} /></td>
            <td>{item.review.record.targetLien.positionBasis.replaceAll("_", " ")} · {item.review.record.targetLien.positionConfidence}</td>
            <td><span className={statusClass(item.review.record.foreclosureAnalysis.status)}>{item.review.record.foreclosureAnalysis.status.replaceAll("_", " ")}</span></td>
            <td><span className={statusClass(item.review.qc.qcStatus)}>{item.review.qc.qcStatus}</span></td><td>{item.fileName}</td></tr> : <tr key={item.id}><td colSpan={11}>{item.fileName} — <span className={item.status === "error" ? `${styles.status} ${styles.error}` : `${styles.status} ${styles.review}`}>{item.status.toUpperCase()}</span>{item.error ? ` · ${item.error}` : ""}</td></tr>)}
        </tbody></table></div></section></> : null}

      {selected?.review ? <section className={styles.panel}>
        <div className={styles.sectionTitle}><div><h2>{selected.review.record.tsNumber.value} · Review & foreclosure analysis</h2><p>{selected.review.record.runSheet.detected ? `Separate Run Sheet / Abstractor Sheet detected · pages ${selected.review.record.runSheet.pageStart ?? "?"}-${selected.review.record.runSheet.pageEnd ?? "?"}` : "No separate Run Sheet / Abstractor Sheet supplied · Run Sheet check is N/A. The title report is reviewed separately against its source documents."}</p></div></div>
        <div className={styles.detailGrid}><div className={styles.summaryCard}><dl>
          <dt>Order type</dt><dd>{selected.review.record.orderType.value}</dd><dt>Borrower</dt><dd>{selected.review.record.borrower.value}</dd><dt>Current owner</dt><dd>{selected.review.record.currentOwner.value}</dd><dt>Property</dt><dd>{selected.review.record.propertyAddress.value}</dd><dt>State / County</dt><dd>{selected.review.record.state.value} / {selected.review.record.county.value}</dd><dt>Title summary</dt><dd>{selected.review.record.titleSummary.detected ? `Detected · ${selected.review.record.titleSummary.entries.length} material entries` : "Could not segment"}</dd><dt>Run Sheet</dt><dd>{selected.review.record.runSheet.detected ? "Separate document detected" : "Not supplied · N/A"}</dd>
          <dt>Target lien</dt><dd>{selected.review.record.targetLien.instrumentNumber.value}</dd><dt>Lien amount</dt><dd>{selected.review.record.targetLien.amount.value}</dd><dt>Lien position</dt><dd>{selected.review.record.targetLien.position.value}</dd><dt>Position basis</dt><dd>{selected.review.record.targetLien.positionBasis.replaceAll("_", " ")} · {selected.review.record.targetLien.positionConfidence}</dd><dt>Open lien stack</dt><dd>{selected.review.record.foreclosureAnalysis.openLienCount}</dd><dt>Foreclosure analysis</dt><dd><span className={statusClass(selected.review.record.foreclosureAnalysis.status)}>{selected.review.record.foreclosureAnalysis.status.replaceAll("_", " ")}</span></dd>
          <dt>QC profile</dt><dd>{selected.review.qc.profileName} v{selected.review.qc.profileVersion}</dd><dt>Review readiness</dt><dd><span className={statusClass(selected.review.qc.foreclosureReadiness)}>{selected.review.qc.foreclosureReadiness.replaceAll("_", " ")}</span></dd>
        </dl>
        {selected.review.record.foreclosureAnalysis.lienStack.length ? <div className={styles.curativeList}><b>Developed lien stack</b>{selected.review.record.foreclosureAnalysis.lienStack.map((entry) => <span className={styles.curativeItem} key={entry.instrumentId}>{entry.positionLabel} · {entry.instrumentType} · {entry.instrumentNumber} · {entry.amount} · {entry.recordingDate}{entry.priorityWarning ? ` · REVIEW: ${entry.priorityWarning}` : ""}</span>)}</div> : null}
        {selected.review.record.foreclosureAnalysis.requirements.length ? <div className={styles.curativeList} style={{ marginTop: 14 }}><b>Foreclosure cure / action</b>{selected.review.record.foreclosureAnalysis.requirements.map((requirement) => <span className={styles.curativeItem} key={requirement.code}>{requirement.type}: {requirement.title} — {requirement.action}</span>)}</div> : <div className={styles.notice} style={{ marginTop: 14 }}>No additional lien-stack action identified by the first-in-time screening engine.</div>}
        </div><div className={styles.issues}>{selected.review.qc.checks.map((check) => <div className={styles.issue} key={check.id}><div className={styles.issueTop}><div><h3>{check.label}</h3><p>{check.summary}</p></div><span className={statusClass(check.status)}>{check.status.replaceAll("_", " ")}</span></div>{check.evidence.slice(0, 2).map((evidence, index) => <div className={styles.evidence} key={`${check.id}-${evidence.page}-${index}`}><b>Page {evidence.page} · {evidence.documentType}</b><br />“{evidence.quote}”</div>)}{!["PASS", "NOT_APPLICABLE"].includes(check.status) ? <div className={styles.actions} style={{ marginTop: 10 }}><button className={styles.secondary} onClick={() => decide(selected, check, "CONFIRM")}>Confirm finding</button><button className={styles.secondary} onClick={() => decide(selected, check, "CORRECT")}>Correct finding</button><button className={styles.danger} onClick={() => decide(selected, check, "NEEDS_EVIDENCE")}>Need more evidence</button>{decisionFor(selected, check.id) ? <span className={styles.profileNote}>Saved: {decisionFor(selected, check.id)}</span> : null}</div> : null}</div>)}</div></div>
      </section> : null}

      {completeItems.length ? <section className={`${styles.panel} ${styles.exportPanel}`}><div className={styles.sectionTitle}><div><h2>McCalla client export</h2><p>Lien amount, developed lien position, priority basis, senior interests, and foreclosure cure/action are exported even when the underlying order is Current Owner Search.</p></div></div><div className={styles.exportGrid}><div className={styles.exportFields}>{availableColumns.map((column) => <label className={styles.check} key={column.key}><input type="checkbox" checked={selectedColumns.includes(column.key)} onChange={() => toggleColumn(column.key)} />{column.label}{column.required ? " *" : ""}</label>)}</div><div>{exportWarnings.length ? <div className={styles.errorBox}><b>Export blocked until these items are resolved:</b>{exportWarnings.slice(0, 12).map((warning) => <div key={warning}>• {warning}</div>)}</div> : <div className={styles.notice}>McCalla export is ready. Required client fields and true QC exception dispositions are complete.</div>}<div className={styles.actions}><button className={styles.primary} disabled={!rows.length || Boolean(exportWarnings.length)} onClick={exportCsv}>Export CSV</button><button className={styles.secondary} disabled={!rows.length || Boolean(exportWarnings.length)} onClick={exportJson}>Export JSON</button></div></div></div></section> : null}
    </main>
  </div>;
}
