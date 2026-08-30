"use client";

import Link from "next/link";
import { upload } from "@vercel/blob/client";
import { useEffect, useMemo, useState } from "react";
import { SEARCH_TYPES } from "@/lib/audit-rules";
import { runSheetToCsv, type RunSheetBuild } from "@/lib/run-sheet";
import {
  buildCanonicalTitleRecord,
  EXPORT_FIELDS,
  NCALA_DEMO_EXPORT_FIELDS,
  titleRecordsToCsv,
  titleRecordsToJson,
  type CanonicalTitleRecord,
  type ExportFieldKey,
} from "@/lib/title-record";
import type { AuditFinding, VeraExam } from "@/lib/vera";
import { Logo } from "../components/Logo";
import styles from "./demo.module.css";

type Mode = "batch" | "single" | "build";
type ItemStatus = "queued" | "uploading" | "reviewing" | "complete" | "error";

type Readiness = {
  openAIConfigured: boolean;
  largeFileStorageConfigured: boolean;
  authenticationMode?: string;
  documentModel?: string;
};

type BatchItem = {
  id: string;
  fileName: string;
  status: ItemStatus;
  exam?: VeraExam;
  record?: CanonicalTitleRecord;
  error?: string;
};

const CLEAN = new Set(["PASS", "NOT_APPLICABLE"]);

function safeName(value: string) {
  return (value || "cybrid-title").replace(/\.[^/.]+$/, "").replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "cybrid-title";
}

function contentTypeFor(file: File) {
  if (file.name.toLowerCase().endsWith(".pdf")) return "application/pdf";
  if (file.name.toLowerCase().endsWith(".md")) return "text/markdown";
  if (file.name.toLowerCase().endsWith(".txt")) return "text/plain";
  return file.type || "application/octet-stream";
}

function extensionFor(filename: string) {
  const match = filename.toLowerCase().match(/\.(pdf|txt|md)$/);
  return match ? `.${match[1]}` : "";
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

function readinessClass(record: CanonicalTitleRecord) {
  if (record.foreclosureReadiness === "CLEAR") return `${styles.status} ${styles.clear}`;
  if (record.foreclosureReadiness === "CURATIVE_REQUIRED") return `${styles.status} ${styles.curative}`;
  if (record.foreclosureReadiness === "QC_DEFICIENCY") return `${styles.status} ${styles.qc}`;
  return `${styles.status} ${styles.review}`;
}

function findingStatusClass(finding: AuditFinding) {
  if (finding.status === "FAIL") return `${styles.status} ${styles.curative}`;
  if (CLEAN.has(finding.status)) return `${styles.status} ${styles.clear}`;
  return `${styles.status} ${styles.review}`;
}

export default function DemoPage() {
  const [mode, setMode] = useState<Mode>("batch");
  const [clientName, setClientName] = useState("Ncala");
  const [stateCode, setStateCode] = useState("TX");
  const [searchType, setSearchType] = useState<(typeof SEARCH_TYPES)[number]>("Foreclosure");
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [runSheet, setRunSheet] = useState<RunSheetBuild | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [exportFields, setExportFields] = useState<ExportFieldKey[]>(NCALA_DEMO_EXPORT_FIELDS);

  useEffect(() => {
    fetch("/api/examine").then((response) => response.json()).then(setReadiness).catch(() => setReadiness(null));
  }, []);

  const completed = useMemo(() => items.filter((item) => item.record), [items]);
  const records = useMemo(() => completed.map((item) => item.record as CanonicalTitleRecord), [completed]);
  const selected = useMemo(() => items.find((item) => item.id === selectedId) || completed[0], [items, selectedId, completed]);
  const metrics = useMemo(() => ({
    total: items.length,
    complete: completed.length,
    clear: records.filter((record) => record.foreclosureReadiness === "CLEAR").length,
    curative: records.filter((record) => record.foreclosureReadiness === "CURATIVE_REQUIRED").length,
    review: records.filter((record) => record.foreclosureReadiness === "CANNOT_CONFIRM").length,
    qc: records.filter((record) => record.foreclosureReadiness === "QC_DEFICIENCY").length,
  }), [items, completed, records]);

  function resetOutput() {
    setItems([]);
    setSelectedId("");
    setRunSheet(null);
    setProgress(0);
    setNotice("");
    setError("");
  }

  function changeMode(next: Mode) {
    if (busy) return;
    setMode(next);
    setFiles([]);
    resetOutput();
  }

  function chooseFiles(list: FileList | null) {
    if (!list?.length) return;
    const chosen = Array.from(list);
    if (mode === "single" && chosen.length > 1) {
      setError("Single QC accepts one complete title-report packet. Use Batch QC for multiple reports.");
      return;
    }
    setFiles(chosen);
    resetOutput();
  }

  async function uploadOne(file: File, index: number, total: number) {
    const pathname = `cybrid-title/demo/${Date.now()}-${index}-${safeName(file.name)}${extensionFor(file.name)}`;
    const result = await upload(pathname, file, {
      access: "private",
      handleUploadUrl: "/api/uploads",
      clientPayload: JSON.stringify({ mode: "ncala-demo" }),
      contentType: contentTypeFor(file),
      multipart: file.size > 4_000_000,
      onUploadProgress: ({ percentage }) => {
        setProgress(Math.round(((index + percentage / 100) / total) * 100));
      },
    });
    return result.pathname;
  }

  async function reviewOne(file: File, index: number, total: number): Promise<VeraExam> {
    let response: Response;
    if (readiness?.largeFileStorageConfigured) {
      const pathname = await uploadOne(file, index, total);
      response = await fetch("/api/examine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blobPathnames: [pathname], state: stateCode, searchType }),
      });
    } else {
      if (file.size > 4_000_000) throw new Error("Large-file storage is not configured for this packet.");
      const form = new FormData();
      form.append("files", file);
      form.set("state", stateCode);
      form.set("searchType", searchType);
      response = await fetch("/api/examine", { method: "POST", body: form });
    }
    const data = await parseResponse(response);
    if (!data?.exam) throw new Error("Cybrid Title returned no completed review.");
    return data.exam as VeraExam;
  }

  async function runQc() {
    if (!files.length || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    setProgress(0);
    const seed = files.map((file, index) => ({ id: `${Date.now()}-${index}`, fileName: file.name, status: "queued" as ItemStatus }));
    setItems(seed);
    setSelectedId(seed[0]?.id || "");

    let succeeded = 0;
    for (let index = 0; index < files.length; index += 1) {
      const id = seed[index].id;
      setItems((current) => current.map((item) => item.id === id ? { ...item, status: "uploading" } : item));
      try {
        setItems((current) => current.map((item) => item.id === id ? { ...item, status: "reviewing" } : item));
        const exam = await reviewOne(files[index], index, files.length);
        const record = buildCanonicalTitleRecord(exam, clientName);
        setItems((current) => current.map((item) => item.id === id ? { ...item, status: "complete", exam, record } : item));
        succeeded += 1;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Review failed";
        setItems((current) => current.map((item) => item.id === id ? { ...item, status: "error", error: message } : item));
      }
      setProgress(Math.round(((index + 1) / files.length) * 100));
    }

    setBusy(false);
    setNotice(`${succeeded} of ${files.length} title report${files.length === 1 ? "" : "s"} completed. Review the exception queue and export the client data file below.`);
  }

  async function buildRunSheet() {
    if (!files.length || busy) return;
    setBusy(true);
    setError("");
    setRunSheet(null);
    setProgress(0);
    try {
      let response: Response;
      if (readiness?.largeFileStorageConfigured) {
        const pathnames: string[] = [];
        for (let index = 0; index < files.length; index += 1) pathnames.push(await uploadOne(files[index], index, files.length));
        response = await fetch("/api/run-sheet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blobPathnames: pathnames, state: stateCode, searchType }),
        });
      } else {
        const form = new FormData();
        files.forEach((file) => form.append("files", file));
        form.set("state", stateCode);
        form.set("searchType", searchType);
        response = await fetch("/api/run-sheet", { method: "POST", body: form });
      }
      const data = await parseResponse(response);
      if (!data?.build) throw new Error("Cybrid Title returned no Run Sheet build.");
      setRunSheet(data.build as RunSheetBuild);
      setNotice("Run Sheet built from the supplied source documents. Review any rows marked REVIEW before export.");
      setProgress(100);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Run Sheet build failed");
    } finally {
      setBusy(false);
    }
  }

  function patchRecord(id: string, patch: Partial<CanonicalTitleRecord>) {
    setItems((current) => current.map((item) => item.id === id && item.record ? { ...item, record: { ...item.record, ...patch } } : item));
  }

  function patchLienPosition(id: string, value: string) {
    setItems((current) => current.map((item) => item.id === id && item.record ? {
      ...item,
      record: { ...item.record, targetLien: { ...item.record.targetLien, reportedPosition: value, positionBasis: "Examiner/demo correction" } },
    } : item));
  }

  function toggleExportField(key: ExportFieldKey) {
    setExportFields((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  function exportCsv() {
    if (!records.length || !exportFields.length) return;
    downloadText(`${safeName(clientName)}-title-qc-export.csv`, titleRecordsToCsv(records, exportFields), "text/csv;charset=utf-8");
  }

  function exportJson() {
    if (!records.length || !exportFields.length) return;
    downloadText(`${safeName(clientName)}-title-qc-export.json`, titleRecordsToJson(records, exportFields), "application/json;charset=utf-8");
  }

  async function exportSelectedVera() {
    if (!selected?.exam) return;
    const response = await fetch("/api/export/vera-docx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selected.exam),
    });
    if (!response.ok) {
      setError((await response.text()) || "VERA export failed");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeName(selected.exam.clientOrder || selected.fileName)}-VERA-v3.docx`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportRunSheetCsv() {
    if (!runSheet) return;
    downloadText(`${safeName(runSheet.propertyAddress)}-run-sheet.csv`, runSheetToCsv(runSheet), "text/csv;charset=utf-8");
  }

  return <div className={styles.shell}>
    <header className={styles.nav}>
      <Link href="/" className={styles.brand}><Logo height={32} /><span className={styles.brandName}>CYBRID TITLE</span></Link>
      <span className={styles.navTag}>QC · Curative · Data Export</span>
    </header>

    <main className={styles.main}>
      <section className={styles.hero}>
        <div><p className={styles.eyebrow}>Foreclosure title intelligence</p><h1>Title QC that ends in usable data.</h1></div>
        <p>Upload one report or a batch. Cybrid Title checks the title package, separates curative issues from QC defects, and turns the grounded title facts into a client-ready CSV or JSON file.</p>
      </section>

      <div className={styles.tabs}>
        <button className={`${styles.tab} ${mode === "batch" ? styles.tabActive : ""}`} onClick={() => changeMode("batch")}>Batch QC</button>
        <button className={`${styles.tab} ${mode === "single" ? styles.tabActive : ""}`} onClick={() => changeMode("single")}>Single Review</button>
        <button className={`${styles.tab} ${mode === "build" ? styles.tabActive : ""}`} onClick={() => changeMode("build")}>Build Run Sheet</button>
      </div>

      <section className={`${styles.panel} ${styles.setupPanel}`}>
        <div className={styles.setup}>
          <label className={styles.field}>Client / export profile<input value={clientName} onChange={(event) => setClientName(event.target.value)} disabled={busy} /></label>
          <label className={styles.field}>State<input value={stateCode} maxLength={2} onChange={(event) => setStateCode(event.target.value.toUpperCase())} disabled={busy} /></label>
          <label className={styles.field}>QC / order profile<select value={searchType} onChange={(event) => setSearchType(event.target.value as (typeof SEARCH_TYPES)[number])} disabled={busy}>{SEARCH_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
          <div className={styles.profileNote}>{readiness?.openAIConfigured ? `AI ready · ${readiness.documentModel || "review model"}` : "AI not configured"}<br />{readiness?.largeFileStorageConfigured ? "Private large-file path ready" : "Direct upload only"}</div>
        </div>
      </section>

      {error ? <div className={styles.errorBox}>{error}</div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}

      <section className={`${styles.panel} ${styles.uploadPanel}`}>
        <div className={styles.drop}>
          <div>
            <h2>{mode === "batch" ? "Upload a batch of title reports" : mode === "single" ? "Upload one title-report packet" : "Upload the source title documents"}</h2>
            <p>{mode === "batch" ? "Each PDF becomes its own review job. One failure does not stop the rest of the batch." : mode === "single" ? "Review the Run Sheet/title summary against the documents behind it." : "Build a new evidence-backed Run Sheet from source documents."}</p>
          </div>
          <div className={styles.actions}>
            <label className={styles.secondary}>{files.length ? "Choose different files" : "Choose files"}<input type="file" hidden accept=".pdf,.txt,.md" multiple={mode !== "single"} disabled={busy} onChange={(event) => { chooseFiles(event.target.files); event.currentTarget.value = ""; }} /></label>
            {files.length ? <button className={styles.primary} onClick={() => void (mode === "build" ? buildRunSheet() : runQc())} disabled={busy || !readiness?.openAIConfigured}>{busy ? "Processing…" : mode === "build" ? "Build Run Sheet" : mode === "batch" ? `Run Batch QC (${files.length})` : "Run Title QC"}</button> : null}
          </div>
        </div>
        {files.length ? <div className={styles.fileList}>{files.map((file) => <span className={styles.fileChip} key={`${file.name}-${file.size}`}>{file.name} · {fileSize(file.size)}</span>)}</div> : null}
        {busy || progress ? <div className={styles.progressWrap}><div className={styles.progressBar}><div className={styles.progressFill} style={{ width: `${progress}%` }} /></div><div className={styles.progressText}>{busy ? `Processing · ${progress}%` : `${progress}% complete`}</div></div> : null}
      </section>

      {items.length ? <>
        <section className={styles.metrics}>
          <div className={styles.metric}><span>Batch</span><strong>{metrics.total}</strong></div>
          <div className={`${styles.metric} ${styles.metricClear}`}><span>Clear</span><strong>{metrics.clear}</strong></div>
          <div className={`${styles.metric} ${styles.metricCurative}`}><span>Curative</span><strong>{metrics.curative}</strong></div>
          <div className={`${styles.metric} ${styles.metricReview}`}><span>Cannot Confirm</span><strong>{metrics.review}</strong></div>
          <div className={styles.metric}><span>QC Deficiency</span><strong>{metrics.qc}</strong></div>
        </section>

        <section className={styles.panel}>
          <div className={styles.sectionTitle}><div><h2>Batch results</h2><p>Borrower and lien position remain editable before export when the packet did not establish them cleanly.</p></div></div>
          <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>TS / Order #</th><th>Borrower</th><th>Property</th><th>Lien position</th><th>QC</th><th>Foreclosure readiness</th><th>Curative / QC issues</th><th>Source</th></tr></thead><tbody>
            {items.map((item) => item.record ? <tr key={item.id}>
              <td><button className={styles.rowButton} onClick={() => setSelectedId(item.id)}>{item.record.tsNumber}</button></td>
              <td><input className={styles.editInput} value={item.record.borrowerName} onChange={(event) => patchRecord(item.id, { borrowerName: event.target.value, borrowerBasis: "Examiner/demo correction" })} /></td>
              <td>{item.record.propertyAddress}</td>
              <td><input className={styles.editInput} value={item.record.targetLien.reportedPosition} onChange={(event) => patchLienPosition(item.id, event.target.value)} /></td>
              <td><span className={`${styles.status} ${item.record.qcStatus === "PASS" ? styles.clear : item.record.qcStatus === "FAIL" ? styles.curative : styles.review}`}>{item.record.qcStatus}</span></td>
              <td><span className={readinessClass(item.record)}>{item.record.foreclosureReadiness.replaceAll("_", " ")}</span></td>
              <td><div className={styles.curativeList}>{item.record.curativeIssues.length ? item.record.curativeIssues.slice(0, 3).map((issue) => <span className={styles.curativeItem} key={`${issue.code}-${issue.findingNumber}`}>{issue.code}: {issue.title}</span>) : <span>None</span>}{item.record.curativeIssues.length > 3 ? <span>+{item.record.curativeIssues.length - 3} more</span> : null}</div></td>
              <td>{item.fileName}</td>
            </tr> : <tr key={item.id}><td colSpan={8}>{item.fileName} — <span className={`${styles.status} ${item.status === "error" ? styles.error : styles.review}`}>{item.status.toUpperCase()}</span>{item.error ? ` · ${item.error}` : ""}</td></tr>)}
          </tbody></table></div>
        </section>

        {records.length ? <section className={`${styles.panel} ${styles.exportPanel}`}>
          <div className={styles.sectionTitle}><div><h2>Client data export</h2><p>The title record stays canonical. The client chooses which fields become columns.</p></div><div className={styles.actions}><button className={styles.secondary} onClick={() => setExportFields(NCALA_DEMO_EXPORT_FIELDS)}>Ncala demo fields</button><button className={styles.secondary} onClick={() => setExportFields(EXPORT_FIELDS.map((field) => field.key))}>All available</button></div></div>
          <div className={styles.exportGrid}>
            <div className={styles.exportFields}>{EXPORT_FIELDS.map((field) => <label className={styles.check} key={field.key}><input type="checkbox" checked={exportFields.includes(field.key)} onChange={() => toggleExportField(field.key)} />{field.label}</label>)}</div>
            <div><p>Demo preset exports <b>TS Number, Borrower Name, Property Address, Lien Position, QC Status, Foreclosure Readiness, and Curative Issues</b>. Add or remove columns without changing the QC engine.</p><div className={styles.actions}><button className={styles.primary} onClick={exportCsv}>Export CSV</button><button className={styles.secondary} onClick={exportJson}>Export JSON</button></div></div>
          </div>
        </section> : null}

        {selected?.record && selected.exam ? <section className={styles.panel}>
          <div className={styles.sectionTitle}><div><h2>{selected.record.tsNumber} · review detail</h2><p>{selected.record.propertyAddress}</p></div><button className={styles.secondary} onClick={() => void exportSelectedVera()}>Export VERA DOCX</button></div>
          <div className={styles.detailGrid}>
            <aside className={styles.summaryCard}><dl><dt>Borrower</dt><dd>{selected.record.borrowerName}</dd><dt>Target lien</dt><dd>{selected.record.targetLien.instrumentNumber} · {selected.record.targetLien.amount}</dd><dt>Lien position</dt><dd>{selected.record.targetLien.reportedPosition}</dd><dt>QC status</dt><dd>{selected.record.qcStatus}</dd><dt>Foreclosure readiness</dt><dd>{selected.record.foreclosureReadiness}</dd><dt>Critical pass rate</dt><dd>{selected.record.criticalPassRate}%</dd><dt>Packet pages</dt><dd>{selected.exam.packetPageCount || "Not reported"}</dd></dl></aside>
            <div className={styles.issues}><h3>Curative / exception summary</h3>{selected.record.curativeIssues.length ? selected.record.curativeIssues.map((issue) => <article className={styles.issue} key={`${issue.code}-${issue.findingNumber}`}><div className={styles.issueTop}><h3>Q{issue.findingNumber} · {issue.code}</h3><span className={`${styles.status} ${issue.severity === "BLOCKING" ? styles.curative : issue.severity === "QC" ? styles.qc : styles.review}`}>{issue.severity}</span></div><p>{issue.title}</p><p><b>Next action:</b> {issue.recommendedAction}</p>{issue.evidence.slice(0, 2).map((evidence, index) => <div className={styles.evidence} key={`${evidence.page}-${index}`}><b>Page {evidence.page} · {evidence.documentType}</b><br />“{evidence.quote}”</div>)}</article>) : <div className={styles.notice}>No curative or QC exceptions were identified.</div>}</div>
          </div>
          <div className={styles.findings}><h3>VERA exception queue</h3>{selected.exam.findings.filter((item) => !CLEAN.has(item.status)).map((item) => <div className={styles.finding} key={item.number}><div className={styles.issueTop}><strong>Q{item.number} · {item.question}</strong><span className={findingStatusClass(item)}>{item.status.replaceAll("_", " ")}</span></div><p>{item.response}</p><p>{item.proofReason}</p></div>)}<details className={styles.cleanDetails}><summary>Verified PASS / N/A checks ({selected.exam.findings.filter((item) => CLEAN.has(item.status)).length})</summary>{selected.exam.findings.filter((item) => CLEAN.has(item.status)).map((item) => <div className={styles.finding} key={item.number}><strong>Q{item.number} · {item.question}</strong><p>{item.response}</p></div>)}</details></div>
        </section> : null}
      </> : null}

      {runSheet ? <section className={styles.panel}>
        <div className={styles.sectionTitle}><div><h2>Generated Run Sheet</h2><p>{runSheet.propertyAddress} · {runSheet.rows.length} rows</p></div><button className={styles.primary} onClick={exportRunSheetCsv}>Export Run Sheet CSV</button></div>
        <div className={`${styles.tableWrap} ${styles.buildTable}`}><table className={styles.table}><thead><tr><th>#</th><th>Category</th><th>Instrument</th><th>Recording date</th><th>Instrument #</th><th>Parties</th><th>Amount</th><th>Verification</th></tr></thead><tbody>{runSheet.rows.map((row) => <tr key={`${row.sequence}-${row.instrumentNumber}`}><td>{row.sequence}</td><td>{row.category}</td><td>{row.instrumentType}</td><td>{row.recordingDate}</td><td>{row.instrumentNumber}</td><td>{row.grantorBorrower} → {row.granteeBeneficiary}</td><td>{row.amount}</td><td><span className={`${styles.status} ${row.verificationStatus === "VERIFIED" ? styles.clear : styles.review}`}>{row.verificationStatus}</span></td></tr>)}</tbody></table></div>
      </section> : null}
    </main>
  </div>;
}
