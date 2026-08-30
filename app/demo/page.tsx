"use client";

import { upload } from "@vercel/blob/client";
import { useEffect, useMemo, useState } from "react";
import { SEARCH_TYPES } from "@/lib/audit-rules";
import {
  AVAILABLE_EXPORT_COLUMNS,
  NCALA_DEMO_EXPORT_PROFILE,
  createExportProfile,
  renderCsv,
  renderJson,
  validateExportProfile,
  type ExportColumn,
} from "@/lib/export-profiles";
import { reduceQcChecks } from "@/lib/title-qc-engine";
import type { QcCheckResult, QcStatus, TitleReviewResult } from "@/lib/title-domain";
import type { VeraExam } from "@/lib/vera";
import { Logo } from "../components/Logo";
import styles from "./demo.module.css";

type ReviewSearchType = "Auto Detect" | (typeof SEARCH_TYPES)[number];
type ItemStatus = "queued" | "processing" | "complete" | "error";
type ExaminerDecision = "CONFIRM" | "CORRECT" | "NEEDS_EVIDENCE";

type Readiness = {
  openAIConfigured: boolean;
  largeFileStorageConfigured: boolean;
  authenticationMode?: string;
  documentModel?: string;
  engine?: string;
  pipeline?: string[];
};

type BatchItem = {
  id: string;
  manifestItemId?: string;
  fileName: string;
  status: ItemStatus;
  review?: TitleReviewResult;
  exam?: VeraExam;
  error?: string;
};

type BatchManifest = {
  batchId: string;
  items: Array<{ itemId: string; sourceFile: string }>;
};

function safeName(value: string) {
  return (value || "cybrid-title").replace(/\.[^/.]+$/, "").replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "cybrid-title";
}

function extensionFor(filename: string) {
  const match = filename.toLowerCase().match(/\.(pdf|txt|md)$/);
  return match ? `.${match[1]}` : "";
}

function contentTypeFor(file: File) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  return file.type || "application/octet-stream";
}

function fileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function parseResponse(response: Response) {
  const text = await response.text();
  let payload: any = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) throw new Error(payload?.error || text || `Request failed (${response.status})`);
  return payload;
}

function downloadText(filename: string, body: string, type: string) {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function statusClass(value: string) {
  if (value === "CLEAR" || value === "PASS" || value === "NOT_APPLICABLE") return `${styles.status} ${styles.clear}`;
  if (value === "CURATIVE_REQUIRED" || value === "FAIL") return `${styles.status} ${styles.curative}`;
  if (value === "QC_DEFICIENCY") return `${styles.status} ${styles.qc}`;
  return `${styles.status} ${styles.review}`;
}

function exceptionChecks(review?: TitleReviewResult): QcCheckResult[] {
  return review?.qc.checks.filter((check) => !["PASS", "NOT_APPLICABLE"].includes(check.status)) || [];
}

export default function DemoPage() {
  const [clientName, setClientName] = useState("Ncala");
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
  const [decisions, setDecisions] = useState<Record<string, Record<string, ExaminerDecision>>>({});
  const defaultColumnKeys = useMemo(() => new Set(NCALA_DEMO_EXPORT_PROFILE.columns.map((column) => column.key)), []);
  const [selectedColumns, setSelectedColumns] = useState<string[]>(Array.from(defaultColumnKeys));

  useEffect(() => {
    fetch("/api/examine").then((response) => response.json()).then(setReadiness).catch(() => setReadiness(null));
  }, []);

  const availableColumns = useMemo(() => {
    const byKey = new Map<string, ExportColumn>();
    AVAILABLE_EXPORT_COLUMNS.forEach((column) => byKey.set(column.key, column));
    return Array.from(byKey.values());
  }, []);
  const completeItems = useMemo(() => items.filter((item) => item.review), [items]);
  const selected = useMemo(() => items.find((item) => item.id === selectedId) || completeItems[0], [items, selectedId, completeItems]);
  const rows = useMemo(() => completeItems.map((item) => ({ record: item.review!.record, qc: item.review!.qc })), [completeItems]);
  const metrics = useMemo(() => ({
    total: items.length,
    clear: completeItems.filter((item) => item.review?.qc.foreclosureReadiness === "CLEAR").length,
    curative: completeItems.filter((item) => item.review?.qc.foreclosureReadiness === "CURATIVE_REQUIRED").length,
    review: completeItems.filter((item) => item.review?.qc.foreclosureReadiness === "CANNOT_CONFIRM").length,
    qc: completeItems.filter((item) => item.review?.qc.foreclosureReadiness === "QC_DEFICIENCY").length,
  }), [items, completeItems]);

  function chooseFiles(list: FileList | null) {
    if (!list?.length || busy) return;
    setFiles(Array.from(list));
    setItems([]);
    setSelectedId("");
    setBatchId("");
    setProgress(0);
    setNotice("");
    setError("");
    setDecisions({});
  }

  async function createBatch(): Promise<BatchManifest | null> {
    try {
      const response = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName, sourceFiles: files.map((file) => file.name), exportProfileId: "ncala-demo-v1" }),
      });
      const manifest = await parseResponse(response) as BatchManifest;
      setBatchId(manifest.batchId);
      return manifest;
    } catch {
      return null;
    }
  }

  async function updateBatch(item: BatchItem, status: "PROCESSING" | "COMPLETE" | "ERROR", review?: TitleReviewResult, message?: string) {
    if (!batchId || !item.manifestItemId) return;
    await fetch("/api/batches", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batchId,
        itemId: item.manifestItemId,
        status,
        reviewId: review?.record.reviewId,
        packetHash: review?.record.packetHash,
        error: message,
      }),
    }).catch(() => undefined);
  }

  async function uploadOne(file: File, index: number, total: number) {
    const pathname = `cybrid-title/rebuild/${Date.now()}-${index}-${safeName(file.name)}${extensionFor(file.name)}`;
    const result = await upload(pathname, file, {
      access: "private",
      handleUploadUrl: "/api/uploads",
      clientPayload: JSON.stringify({ mode: "canonical-title-platform" }),
      contentType: contentTypeFor(file),
      multipart: file.size > 4_000_000,
      onUploadProgress: ({ percentage }) => setProgress(Math.round(((index + percentage / 100) / total) * 100)),
    });
    return result.pathname;
  }

  async function reviewOne(file: File, index: number, total: number): Promise<{ review: TitleReviewResult; exam?: VeraExam }> {
    let response: Response;
    if (readiness?.largeFileStorageConfigured) {
      const pathname = await uploadOne(file, index, total);
      response = await fetch("/api/examine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blobPathnames: [pathname], state: "AUTO", searchType, clientName }),
      });
    } else {
      if (file.size > 4_000_000) throw new Error("Private large-file storage is required for this packet.");
      const form = new FormData();
      form.append("files", file);
      form.set("state", "AUTO");
      form.set("searchType", searchType);
      form.set("clientName", clientName);
      response = await fetch("/api/examine", { method: "POST", body: form });
    }
    const data = await parseResponse(response);
    if (!data?.review) throw new Error("Cybrid Title returned no canonical title review.");
    return { review: data.review as TitleReviewResult, exam: data.exam as VeraExam | undefined };
  }

  async function runBatch() {
    if (!files.length || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    setProgress(0);
    const manifest = await createBatch();
    const seed: BatchItem[] = files.map((file, index) => ({
      id: `${Date.now()}-${index}`,
      manifestItemId: manifest?.items[index]?.itemId,
      fileName: file.name,
      status: "queued",
    }));
    setItems(seed);
    setSelectedId(seed[0]?.id || "");

    let succeeded = 0;
    for (let index = 0; index < files.length; index += 1) {
      const item = seed[index];
      setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "processing" } : candidate));
      await updateBatch(item, "PROCESSING");
      try {
        const result = await reviewOne(files[index], index, files.length);
        setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "complete", ...result } : candidate));
        await updateBatch(item, "COMPLETE", result.review);
        succeeded += 1;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Review failed";
        setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "error", error: message } : candidate));
        await updateBatch(item, "ERROR", undefined, message);
      }
      setProgress(Math.round(((index + 1) / files.length) * 100));
    }

    setBusy(false);
    setNotice(`${succeeded} of ${files.length} title packet${files.length === 1 ? "" : "s"} completed. Resolve exceptions, confirm the foreclosure target/lien position when required, then export the client data file.`);
  }

  function patchReview(id: string, updater: (review: TitleReviewResult) => TitleReviewResult) {
    setItems((current) => current.map((item) => item.id === id && item.review ? { ...item, review: updater(item.review) } : item));
  }

  function selectTargetLien(item: BatchItem, instrumentId: string) {
    if (!item.review) return;
    patchReview(item.id, (review) => {
      const mortgage = review.record.mortgages.find((candidate) => candidate.id === instrumentId);
      if (!mortgage) return review;
      const beneficiary = mortgage.parties.find((party) => /holder|beneficiary/i.test(party.role))?.name || "Needs review";
      const record = {
        ...review.record,
        targetLien: {
          ...review.record.targetLien,
          instrumentId: mortgage.id,
          instrumentNumber: { value: mortgage.instrumentNumber, state: mortgage.evidence.length ? "CONFIRMED" as const : "UNCONFIRMED" as const, evidence: mortgage.evidence, basis: "Examiner selected foreclosure target lien" },
          amount: { value: mortgage.amount, state: mortgage.evidence.length ? "CONFIRMED" as const : "UNCONFIRMED" as const, evidence: mortgage.evidence, basis: "Examiner selected foreclosure target lien" },
          beneficiary: { value: beneficiary, state: mortgage.evidence.length ? "CONFIRMED" as const : "UNCONFIRMED" as const, evidence: mortgage.evidence, basis: "Examiner selected foreclosure target lien" },
          selectionRequired: false,
        },
      };
      const checks = review.qc.checks.map((check) => check.id === "TARGET_LIEN_FOUND" ? { ...check, status: "PASS" as const, summary: `Target lien selected by examiner: ${mortgage.instrumentNumber}.`, evidence: mortgage.evidence } : check);
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
          position: { value: normalized, state: normalized === "Needs review" ? "NOT_STATED" as const : "CONFIRMED" as const, evidence: review.record.targetLien.position.evidence, basis: normalized === "Needs review" ? "Lien position unresolved" : "Examiner-confirmed lien position" },
        },
      };
      const checks = review.qc.checks.map((check) => check.id === "TARGET_LIEN_POSITION_ESTABLISHED" ? {
        ...check,
        status: normalized === "Needs review" ? "CANNOT_CONFIRM" as const : "PASS" as const,
        summary: normalized === "Needs review" ? "Lien position remains unresolved." : `Target lien position confirmed as ${normalized}.`,
      } : check);
      return { ...review, record, qc: reduceQcChecks(review.qc, checks) };
    });
  }

  async function decide(item: BatchItem, check: QcCheckResult, decision: ExaminerDecision) {
    if (!item.review) return;
    let reason = decision === "CONFIRM" ? "Examiner confirmed this finding against the displayed packet evidence." : window.prompt("Decision reason:", decision === "NEEDS_EVIDENCE" ? "Additional source evidence is required." : "Examiner correction") || "";
    if (!reason.trim()) return;
    let correctedStatus: QcStatus | undefined;
    let correctedValue: string | undefined;
    if (decision === "CORRECT") {
      const entered = (window.prompt("Correct status: PASS, FAIL, CANNOT_CONFIRM, or NOT_APPLICABLE", "PASS") || "").trim().toUpperCase();
      if (!["PASS", "FAIL", "CANNOT_CONFIRM", "NOT_APPLICABLE"].includes(entered)) return;
      correctedStatus = entered as QcStatus;
      correctedValue = window.prompt("Corrected finding/summary:", check.summary) || check.summary;
    }

    const response = await fetch("/api/review-decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewId: item.review.record.reviewId, checkId: check.id, decision, correctedStatus, correctedValue, reason }),
    });
    if (!response.ok) {
      setError((await response.json().catch(() => null))?.error || "Could not save examiner decision.");
      return;
    }

    setDecisions((current) => ({ ...current, [item.review!.record.reviewId]: { ...(current[item.review!.record.reviewId] || {}), [check.id]: decision } }));
    if (decision !== "CONFIRM") {
      patchReview(item.id, (review) => {
        const checks = review.qc.checks.map((candidate) => candidate.id === check.id ? {
          ...candidate,
          status: decision === "NEEDS_EVIDENCE" ? "CANNOT_CONFIRM" as const : correctedStatus || candidate.status,
          summary: decision === "CORRECT" ? correctedValue || candidate.summary : `${candidate.summary} Examiner requires additional evidence.`,
        } : candidate);
        return { ...review, qc: reduceQcChecks(review.qc, checks) };
      });
    }
  }

  function decisionFor(item: BatchItem, checkId: string) {
    return item.review ? decisions[item.review.record.reviewId]?.[checkId] : undefined;
  }

  function unresolvedDecisions(item: BatchItem) {
    return exceptionChecks(item.review).filter((check) => !decisionFor(item, check.id)).length;
  }

  function toggleColumn(key: string) {
    setSelectedColumns((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  function exportProfile(format: "csv" | "json") {
    const columns = availableColumns.filter((column) => selectedColumns.includes(column.key));
    return createExportProfile(clientName, columns, format);
  }

  const exportWarnings = useMemo(() => {
    if (!rows.length) return [];
    const profile = exportProfile("csv");
    const fieldWarnings = validateExportProfile(profile, rows);
    const decisionWarnings = completeItems.flatMap((item) => {
      const count = unresolvedDecisions(item);
      return count ? [`${item.fileName}: ${count} exception${count === 1 ? "" : "s"} still require examiner disposition.`] : [];
    });
    return [...fieldWarnings, ...decisionWarnings];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selectedColumns, completeItems, decisions, clientName, availableColumns]);

  function exportCsv() {
    if (!rows.length || exportWarnings.length) return;
    downloadText(`${safeName(clientName)}-title-qc.csv`, renderCsv(exportProfile("csv"), rows), "text/csv;charset=utf-8");
  }

  function exportJson() {
    if (!rows.length || exportWarnings.length) return;
    downloadText(`${safeName(clientName)}-title-qc.json`, renderJson(exportProfile("json"), rows), "application/json;charset=utf-8");
  }

  async function exportVera(item: BatchItem) {
    if (!item.exam) return;
    const response = await fetch("/api/export/vera-docx", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item.exam) });
    if (!response.ok) return setError("VERA DOCX export failed.");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeName(item.exam.clientOrder || item.fileName)}-VERA-v3.docx`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <div className={styles.shell}>
    <header className={styles.nav}>
      <div className={styles.brand}><Logo height={32} /><span className={styles.brandName}>CYBRID TITLE</span></div>
      <span className={styles.navTag}>Title QC · Curative · Client Data</span>
    </header>

    <main className={styles.main}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Canonical title intelligence workbench</p>
          <h1>Upload the title reports. Find what is wrong. Know what blocks foreclosure. Export the data.</h1>
        </div>
        <p>Every packet is isolated and processed through the same evidence path: extract → classify → normalize → check → ground → human exceptions → client export. The client CSV is an adapter over the title record, never the database.</p>
      </section>

      <section className={`${styles.panel} ${styles.setupPanel}`}>
        <div className={styles.setup}>
          <label className={styles.field}>Client / export profile<input value={clientName} onChange={(event) => setClientName(event.target.value)} disabled={busy} /></label>
          <label className={styles.field}>QC / order profile<select value={searchType} onChange={(event) => setSearchType(event.target.value as ReviewSearchType)} disabled={busy}><option>Auto Detect</option>{SEARCH_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
          <div className={styles.profileNote}>State is detected from each packet. Mixed-state and mixed-order batches are allowed.</div>
          <div className={styles.profileNote}>{readiness?.openAIConfigured ? `AI ready · ${readiness.documentModel || "configured model"}` : readiness ? "AI not configured" : "Checking system…"}<br />{readiness?.engine || "canonical engine"}</div>
        </div>
      </section>

      {error ? <div className={styles.errorBox}>{error}</div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}

      <section className={`${styles.panel} ${styles.uploadPanel}`}>
        <div className={styles.drop}>
          <div><h2>Upload title-report packets</h2><p>One packet is one review job. Upload one or a batch.</p></div>
          <div className={styles.actions}>
            <label className={styles.secondary}>Choose files<input hidden type="file" multiple accept=".pdf,.txt,.md" onChange={(event) => chooseFiles(event.target.files)} /></label>
            <button className={styles.primary} disabled={!files.length || busy} onClick={runBatch}>{busy ? "Running QC…" : "Run Title QC"}</button>
          </div>
        </div>
        {files.length ? <div className={styles.fileList}>{files.map((file) => <span className={styles.fileChip} key={`${file.name}-${file.size}`}>{file.name} · {fileSize(file.size)}</span>)}</div> : null}
        {busy || progress ? <div className={styles.progressWrap}><div className={styles.progressBar}><div className={styles.progressFill} style={{ width: `${progress}%` }} /></div><div className={styles.progressText}>{progress}% · {batchId ? `Batch ${batchId}` : "reviewing"}</div></div> : null}
      </section>

      {items.length ? <>
        <section className={styles.metrics}>
          <div className={styles.metric}><span>Batch</span><strong>{metrics.total}</strong></div>
          <div className={`${styles.metric} ${styles.metricClear}`}><span>Clear</span><strong>{metrics.clear}</strong></div>
          <div className={`${styles.metric} ${styles.metricCurative}`}><span>Curative</span><strong>{metrics.curative}</strong></div>
          <div className={`${styles.metric} ${styles.metricReview}`}><span>Cannot confirm</span><strong>{metrics.review}</strong></div>
          <div className={styles.metric}><span>QC deficiency</span><strong>{metrics.qc}</strong></div>
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionTitle}><div><h2>Batch results</h2><p>Click a TS/order number to inspect the grounded QC and resolve exceptions.</p></div></div>
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>TS / Order #</th><th>Order Profile</th><th>Borrower</th><th>Property</th><th>Target Lien</th><th>Lien Position</th><th>QC</th><th>Foreclosure Readiness</th><th>Curative / QC Issues</th><th>Source</th></tr></thead><tbody>
            {items.map((item) => item.review ? <tr key={item.id}>
              <td><button className={styles.rowButton} onClick={() => setSelectedId(item.id)}>{item.review.record.tsNumber.value}</button></td>
              <td>{item.review.qc.profileName}</td>
              <td>{item.review.record.borrower.value}</td>
              <td>{item.review.record.propertyAddress.value}</td>
              <td>{item.review.record.targetLien.selectionRequired ? <select className={styles.editInput} value="" onChange={(event) => selectTargetLien(item, event.target.value)}><option value="">Select target lien</option>{item.review.record.mortgages.map((mortgage) => <option value={mortgage.id} key={mortgage.id}>{mortgage.instrumentNumber} · {mortgage.amount}</option>)}</select> : item.review.record.targetLien.instrumentNumber.value}</td>
              <td><input className={styles.editInput} value={item.review.record.targetLien.position.value === "Needs review" ? "" : item.review.record.targetLien.position.value} placeholder="Needs review" onChange={(event) => setLienPosition(item, event.target.value)} /></td>
              <td><span className={statusClass(item.review.qc.qcStatus)}>{item.review.qc.qcStatus}</span></td>
              <td><span className={statusClass(item.review.qc.foreclosureReadiness)}>{item.review.qc.foreclosureReadiness.replaceAll("_", " ")}</span></td>
              <td><div className={styles.curativeList}>{item.review.qc.curativeIssues.slice(0, 3).map((issue) => <span className={styles.curativeItem} key={`${item.id}-${issue.code}`}>{issue.code}</span>)}{unresolvedDecisions(item) ? <b>{unresolvedDecisions(item)} decision(s) needed</b> : null}</div></td>
              <td>{item.fileName}</td>
            </tr> : <tr key={item.id}><td colSpan={10}>{item.fileName} — <span className={item.status === "error" ? `${styles.status} ${styles.error}` : `${styles.status} ${styles.review}`}>{item.status.toUpperCase()}</span>{item.error ? ` · ${item.error}` : ""}</td></tr>)}
          </tbody></table></div>
        </section>
      </> : null}

      {selected?.review ? <section className={styles.panel}>
        <div className={styles.sectionTitle}><div><h2>{selected.review.record.tsNumber.value} · Review & curative</h2><p>{selected.review.record.runSheet.detected ? `Functional Run Sheet detected · pages ${selected.review.record.runSheet.pageStart ?? "?"}-${selected.review.record.runSheet.pageEnd ?? "?"}` : "Run Sheet segmentation unresolved — this remains an exception, not N/A."}</p></div><div className={styles.actions}>{selected.exam ? <button className={styles.secondary} onClick={() => exportVera(selected)}>VERA DOCX</button> : null}</div></div>
        <div className={styles.detailGrid}>
          <div className={styles.summaryCard}><dl>
            <dt>Borrower</dt><dd>{selected.review.record.borrower.value}</dd>
            <dt>Current owner</dt><dd>{selected.review.record.currentOwner.value}</dd>
            <dt>Property</dt><dd>{selected.review.record.propertyAddress.value}</dd>
            <dt>State / County</dt><dd>{selected.review.record.state.value} / {selected.review.record.county.value}</dd>
            <dt>Target lien</dt><dd>{selected.review.record.targetLien.instrumentNumber.value}</dd>
            <dt>Lien position</dt><dd>{selected.review.record.targetLien.position.value}</dd>
            <dt>QC profile</dt><dd>{selected.review.qc.profileName} v{selected.review.qc.profileVersion}</dd>
            <dt>Foreclosure readiness</dt><dd><span className={statusClass(selected.review.qc.foreclosureReadiness)}>{selected.review.qc.foreclosureReadiness.replaceAll("_", " ")}</span></dd>
          </dl></div>
          <div className={styles.issues}>{selected.review.qc.checks.map((check) => <div className={styles.issue} key={check.id}>
            <div className={styles.issueTop}><div><h3>{check.label}</h3><p>{check.summary}</p></div><span className={statusClass(check.status)}>{check.status.replaceAll("_", " ")}</span></div>
            {check.evidence.slice(0, 2).map((evidence, index) => <div className={styles.evidence} key={`${check.id}-${evidence.page}-${index}`}><b>Page {evidence.page} · {evidence.documentType}</b><br />“{evidence.quote}”</div>)}
            {!["PASS", "NOT_APPLICABLE"].includes(check.status) ? <div className={styles.actions} style={{ marginTop: 10 }}>
              <button className={styles.secondary} onClick={() => decide(selected, check, "CONFIRM")}>Confirm finding</button>
              <button className={styles.secondary} onClick={() => decide(selected, check, "CORRECT")}>Correct finding</button>
              <button className={styles.danger} onClick={() => decide(selected, check, "NEEDS_EVIDENCE")}>Need more evidence</button>
              {decisionFor(selected, check.id) ? <span className={styles.profileNote}>Saved: {decisionFor(selected, check.id)}</span> : null}
            </div> : null}
          </div>)}</div>
        </div>
      </section> : null}

      {completeItems.length ? <section className={`${styles.panel} ${styles.exportPanel}`}>
        <div className={styles.sectionTitle}><div><h2>Client data export</h2><p>Choose the fields the client needs. CSV and JSON are views over the same canonical title record.</p></div></div>
        <div className={styles.exportGrid}>
          <div className={styles.exportFields}>{availableColumns.map((column) => <label className={styles.check} key={column.key}><input type="checkbox" checked={selectedColumns.includes(column.key)} onChange={() => toggleColumn(column.key)} />{column.label}{column.required ? " *" : ""}</label>)}</div>
          <div>
            {exportWarnings.length ? <div className={styles.errorBox}><b>Export blocked until these items are resolved:</b>{exportWarnings.slice(0, 12).map((warning) => <div key={warning}>• {warning}</div>)}</div> : <div className={styles.notice}>Export is ready. Required data fields and examiner exception dispositions are complete.</div>}
            <div className={styles.actions}><button className={styles.primary} disabled={!rows.length || Boolean(exportWarnings.length)} onClick={exportCsv}>Export CSV</button><button className={styles.secondary} disabled={!rows.length || Boolean(exportWarnings.length)} onClick={exportJson}>Export JSON</button></div>
          </div>
        </div>
      </section> : null}
    </main>
  </div>;
}
