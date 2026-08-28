"use client";

import Link from "next/link";
import { upload } from "@vercel/blob/client";
import { useEffect, useMemo, useState } from "react";
import { SEARCH_TYPES } from "@/lib/audit-rules";
import { runSheetToCsv, type RunSheetBuild, type RunSheetRow } from "@/lib/run-sheet";
import type { AuditFinding, EvidenceRef, FindingStatus, VeraExam } from "@/lib/vera";
import { Logo } from "../components/Logo";
import styles from "./examine.module.css";

type Mode = "review" | "build";
type Phase = "select" | "ready" | "uploading" | "reviewing" | "complete" | "error";
type Readiness = {
  openAIConfigured: boolean;
  largeFileStorageConfigured: boolean;
  authenticationMode?: "testing-bypass" | "access-code";
  documentModel?: string;
};

type ApiPayload = {
  error?: string;
  code?: string;
  retryable?: boolean;
  [key: string]: unknown;
};

class RequestError extends Error {
  code: string;
  retryable: boolean;

  constructor(message: string, code = "REQUEST_FAILED", retryable = true) {
    super(message);
    this.name = "RequestError";
    this.code = code;
    this.retryable = retryable;
  }
}

const workflowSteps = [
  ["Upload packet", "Choose the source PDF"],
  ["Run review", "Read, compare, verify"],
  ["Review findings", "Approve or override"],
  ["Export", "VERA DOCX or PDF"],
] as const;

function safeName(value: string) {
  return (value || "title-output").replace(/\.[^/.]+$/, "").replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "title-output";
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
  return file.type && file.type !== "application/octet-stream" ? file.type : "application/octet-stream";
}

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(status: FindingStatus) {
  if (status === "NOT_APPLICABLE") return "N/A";
  if (status === "CANNOT_CONFIRM") return "CANNOT CONFIRM";
  return status.replaceAll("_", " ");
}

async function parseApiResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  let payload: ApiPayload | null = null;
  let raw = "";

  if (contentType.includes("application/json")) {
    try { payload = await response.json() as ApiPayload; } catch { payload = null; }
  } else {
    raw = await response.text().catch(() => "");
  }

  if (!response.ok) {
    if (response.status === 413) {
      throw new RequestError("This packet exceeded the direct-request size limit. The private large-file upload path should handle production-sized title packets.", "UPLOAD_TOO_LARGE", true);
    }
    throw new RequestError(payload?.error || raw || `Request failed (${response.status}).`, payload?.code || "REQUEST_FAILED", payload?.retryable !== false);
  }

  return payload as any;
}

function EvidenceList({ evidence }: { evidence: EvidenceRef[] }) {
  if (!evidence.length) return <div className={styles.evidence}><b>Evidence:</b> Not Stated</div>;
  return <>{evidence.map((item, index) => <div className={styles.evidence} key={`${item.sourceFile || "packet"}-${item.page}-${index}`}>
    <b>{item.sourceFile ? `${item.sourceFile} · ` : ""}Page {item.page} · {item.documentType}</b>
    <div>“{item.quote}”</div>
    {item.instrumentNumber ? <small>Instrument {item.instrumentNumber}</small> : null}
  </div>)}</>;
}

function effectiveStatus(finding: AuditFinding): FindingStatus {
  return finding.reviewDecision === "OVERRIDDEN" && finding.reviewerStatus ? finding.reviewerStatus : finding.status;
}

function reviewVerdict(exam: VeraExam) {
  const critical = exam.findings.filter((item) => item.critical);
  const failed = critical.filter((item) => !["PASS", "NOT_APPLICABLE"].includes(effectiveStatus(item)));
  const pending = critical.filter((item) => !item.reviewDecision || item.reviewDecision === "PENDING" || item.reviewDecision === "NEEDS_REVIEW");
  return { status: failed.length ? "Fail" : "Pass", failed: failed.length, pending: pending.length };
}

export default function ExaminePage() {
  const [mode, setMode] = useState<Mode>("review");
  const [stateCode, setStateCode] = useState("TX");
  const [searchType, setSearchType] = useState<(typeof SEARCH_TYPES)[number]>("Foreclosure");
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<Phase>("select");
  const [uploadPercent, setUploadPercent] = useState(0);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [notice, setNotice] = useState("");
  const [exam, setExam] = useState<VeraExam | null>(null);
  const [runSheet, setRunSheet] = useState<RunSheetBuild | null>(null);
  const [exported, setExported] = useState(false);

  useEffect(() => {
    fetch("/api/examine").then((response) => response.json()).then((data) => setReadiness(data)).catch(() => setReadiness(null));
  }, []);

  const verdict = useMemo(() => exam ? reviewVerdict(exam) : null, [exam]);
  const issueFindings = useMemo(() => exam ? exam.findings
    .filter((item) => !["PASS", "NOT_APPLICABLE"].includes(item.status))
    .sort((a, b) => Number(b.critical) - Number(a.critical) || a.number - b.number) : [], [exam]);
  const cleanFindings = useMemo(() => exam ? exam.findings
    .filter((item) => ["PASS", "NOT_APPLICABLE"].includes(item.status))
    .sort((a, b) => a.number - b.number) : [], [exam]);
  const reviewCounts = useMemo(() => {
    if (!exam) return { pass: 0, fail: 0, cannot: 0, na: 0 };
    return exam.findings.reduce((acc, finding) => {
      if (finding.status === "PASS") acc.pass += 1;
      else if (finding.status === "FAIL") acc.fail += 1;
      else if (["CANNOT_CONFIRM", "UNDETERMINED", "NOT_STATED"].includes(finding.status)) acc.cannot += 1;
      else if (finding.status === "NOT_APPLICABLE") acc.na += 1;
      return acc;
    }, { pass: 0, fail: 0, cannot: 0, na: 0 });
  }, [exam]);

  const activeStep = exported ? 4 : (exam || runSheet) ? 3 : phase === "select" ? 1 : 2;
  const busy = phase === "uploading" || phase === "reviewing";
  const quotaError = errorCode === "OPENAI_CREDITS_EXHAUSTED";

  function clearOutput() {
    setExam(null);
    setRunSheet(null);
    setNotice("");
    setError("");
    setErrorCode("");
    setExported(false);
  }

  function changeMode(next: Mode) {
    if (busy) return;
    setMode(next);
    setSelectedFiles([]);
    clearOutput();
    setPhase("select");
  }

  function chooseFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    const files = Array.from(fileList);
    clearOutput();

    if (mode === "review" && files.length !== 1) {
      setError("Title review accepts one complete title-report packet at a time.");
      setErrorCode("TOO_MANY_FILES");
      setPhase("error");
      return;
    }

    setSelectedFiles(files);
    setPhase("ready");
  }

  async function uploadToPrivateStore(files: File[]) {
    const pathnames: string[] = [];
    setPhase("uploading");
    setUploadPercent(0);

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const extension = extensionFor(file.name);
      const pathname = `cybrid-title/${Date.now()}-${index}-${safeName(file.name)}${extension}`;
      const result = await upload(pathname, file, {
        access: "private",
        handleUploadUrl: "/api/uploads",
        clientPayload: JSON.stringify({ mode: "testing" }),
        contentType: contentTypeFor(file),
        multipart: file.size > 4_000_000,
        onUploadProgress: ({ percentage }) => {
          const overall = Math.round(((index + percentage / 100) / files.length) * 100);
          setUploadPercent(overall);
        },
      });
      pathnames.push(result.pathname);
    }

    return pathnames;
  }

  async function runReview() {
    if (!selectedFiles.length || busy) return;
    setError("");
    setErrorCode("");
    setNotice("");
    setExported(false);

    try {
      const endpoint = mode === "review" ? "/api/examine" : "/api/run-sheet";
      const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
      let response: Response;

      if (readiness?.largeFileStorageConfigured) {
        const blobPathnames = await uploadToPrivateStore(selectedFiles);
        setPhase("reviewing");
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blobPathnames, state: stateCode, searchType }),
        });
      } else {
        if (totalSize > 4_000_000) throw new RequestError("This packet is too large and private Blob storage is not available.", "UPLOAD_TOO_LARGE", true);
        const form = new FormData();
        selectedFiles.forEach((file) => form.append("files", file));
        form.set("state", stateCode);
        form.set("searchType", searchType);
        setPhase("reviewing");
        response = await fetch(endpoint, { method: "POST", body: form });
      }

      const data = await parseApiResponse(response);

      if (mode === "review") {
        const incoming = data?.exam as VeraExam | undefined;
        if (!incoming) throw new RequestError("Cybrid Title did not return a VERA review.", "EMPTY_REVIEW", true);
        incoming.findings = incoming.findings.map((finding) => ({ ...finding, reviewDecision: "PENDING" }));
        setExam(incoming);
        setRunSheet(null);
        setNotice(`Review complete · ${data.usage?.pages || incoming.pages.length || "packet"} pages · two-pass verification complete.`);
      } else {
        const incoming = data?.build as RunSheetBuild | undefined;
        if (!incoming) throw new RequestError("Cybrid Title did not return a Run Sheet.", "EMPTY_RUN_SHEET", true);
        setRunSheet(incoming);
        setExam(null);
        setNotice(`Run Sheet complete · ${incoming.sourceFiles.length} source document${incoming.sourceFiles.length === 1 ? "" : "s"} · two-pass verification complete.`);
      }

      setPhase("complete");
    } catch (caught) {
      const requestError = caught instanceof RequestError ? caught : new RequestError(caught instanceof Error ? caught.message : "Processing failed.");
      setError(requestError.message);
      setErrorCode(requestError.code);
      setPhase("error");
    } finally {
      setUploadPercent(0);
    }
  }

  function setReviewDecision(number: number, decision: "APPROVED" | "OVERRIDDEN" | "NEEDS_REVIEW") {
    setExam((current) => current ? {
      ...current,
      findings: current.findings.map((finding) => finding.number === number ? {
        ...finding,
        reviewDecision: decision,
        reviewerStatus: decision === "OVERRIDDEN" ? (finding.reviewerStatus || finding.status) : undefined,
        reviewerResponse: decision === "OVERRIDDEN" ? (finding.reviewerResponse || finding.response) : undefined,
        reviewerReason: decision === "OVERRIDDEN" ? (finding.reviewerReason || "") : undefined,
      } : finding),
    } : current);
  }

  function patchFinding(number: number, patch: Partial<AuditFinding>) {
    setExam((current) => current ? { ...current, findings: current.findings.map((item) => item.number === number ? { ...item, ...patch } : item) } : current);
  }

  function approveCleanFindings() {
    setExam((current) => current ? {
      ...current,
      findings: current.findings.map((finding) => ["PASS", "NOT_APPLICABLE"].includes(finding.status) && (!finding.reviewDecision || finding.reviewDecision === "PENDING") ? { ...finding, reviewDecision: "APPROVED" } : finding),
    } : current);
  }

  function patchRunRow(index: number, key: keyof RunSheetRow, value: string) {
    setRunSheet((current) => current ? { ...current, rows: current.rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row) } : current);
  }

  async function downloadVeraDocx() {
    if (!exam) return;
    try {
      const response = await fetch("/api/export/vera-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exam),
      });
      if (!response.ok) await parseApiResponse(response);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeName(exam.clientOrder !== "Not Provided" ? exam.clientOrder : exam.sourceFile)}-VERA-v3.docx`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExported(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not export DOCX.");
      setErrorCode("EXPORT_FAILED");
    }
  }

  function printVera() {
    setExported(true);
    window.print();
  }

  function downloadRunSheetCsv() {
    if (!runSheet) return;
    const blob = new Blob([runSheetToCsv(runSheet)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeName(runSheet.propertyAddress)}-run-sheet.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setExported(true);
  }

  function startNewPacket() {
    setSelectedFiles([]);
    clearOutput();
    setPhase("select");
  }

  function findingCard(finding: AuditFinding) {
    const needsAttention = !["PASS", "NOT_APPLICABLE"].includes(finding.status);
    return <article className={`${styles.findingCard} ${finding.critical && needsAttention ? styles.criticalFinding : ""}`} key={finding.number}>
      <div className={styles.findingTop}>
        <div>
          <span className={styles.findingMeta}>Q{finding.number}{finding.critical ? " · Critical" : ""}</span>
          <h3>{finding.question}</h3>
        </div>
        <span className={styles.findingStatus}>{statusLabel(finding.status)}</span>
      </div>
      <p className={styles.findingBody}><b>Response:</b> {finding.response}</p>
      <EvidenceList evidence={finding.evidence} />
      <p className={styles.findingBody}><b>Proof / Reason:</b> {finding.proofReason}</p>
      <div className={styles.findingActions}>
        <button className={styles.findingButton} onClick={() => setReviewDecision(finding.number, "APPROVED")}>Approve</button>
        <button className={styles.findingButton} onClick={() => setReviewDecision(finding.number, "OVERRIDDEN")}>Override</button>
        <button className={styles.findingButton} onClick={() => setReviewDecision(finding.number, "NEEDS_REVIEW")}>Needs review</button>
        <span className={styles.decision}>Examiner: {finding.reviewDecision || "PENDING"}</span>
      </div>
      {finding.reviewDecision === "OVERRIDDEN" ? <div className={styles.overrideGrid}>
        <select value={finding.reviewerStatus || finding.status} onChange={(event) => patchFinding(finding.number, { reviewerStatus: event.target.value as FindingStatus })}>
          {["PASS", "FAIL", "CANNOT_CONFIRM", "NOT_APPLICABLE", "NOT_STATED"].map((status) => <option key={status}>{status}</option>)}
        </select>
        <input value={finding.reviewerResponse || ""} onChange={(event) => patchFinding(finding.number, { reviewerResponse: event.target.value })} placeholder="Corrected examiner response" />
        <div />
        <input value={finding.reviewerReason || ""} onChange={(event) => patchFinding(finding.number, { reviewerReason: event.target.value })} placeholder="Override reason — required for the audit trail" />
      </div> : null}
    </article>;
  }

  return <main className={styles.shell}>
    <header className={`${styles.nav} ${styles.noPrint}`}>
      <Link className={styles.brand} href="/" aria-label="Cybrid Title home">
        <Logo height={34} />
        <strong className={styles.brandName}>CYBRID TITLE</strong>
      </Link>
      <div className={styles.navCenter}>Title Evidence Workbench</div>
      <div className={styles.navRight}>
        <span>Testing</span>
        {(exam || runSheet || selectedFiles.length) ? <button className={styles.ghostButton} onClick={startNewPacket}>New packet</button> : null}
      </div>
    </header>

    <section className={`${styles.hero} ${styles.noPrint}`}>
      <div>
        <p className={styles.eyebrow}>Evidence-first title examination</p>
        <h1>Upload. Review. Deliver.</h1>
      </div>
      <p className={styles.heroCopy}>One title packet in. A source-backed VERA v3 review out. The workflow now stops at each meaningful decision instead of disappearing into a black box.</p>
    </section>

    <section className={`${styles.stepper} ${styles.noPrint}`} aria-label="Review workflow">
      {workflowSteps.map(([label, description], index) => {
        const number = index + 1;
        const stateClass = number < activeStep ? styles.stepDone : number === activeStep ? styles.stepActive : "";
        return <div className={`${styles.step} ${stateClass}`} key={label}>
          <span className={styles.stepNumber}>{number < activeStep ? "✓" : number}</span>
          <strong>{label}</strong>
          <span>{description}</span>
        </div>;
      })}
    </section>

    <div className={styles.noPrint}>
      <section className={styles.modeTabs}>
        <button className={`${styles.modeButton} ${mode === "review" ? styles.modeActive : ""}`} onClick={() => changeMode("review")} disabled={busy}>
          <strong>Review Title Report</strong><span>Existing packet → VERA v3 findings → export</span>
        </button>
        <button className={`${styles.modeButton} ${mode === "build" ? styles.modeActive : ""}`} onClick={() => changeMode("build")} disabled={busy}>
          <strong>Build Run Sheet</strong><span>Recorded documents → verified Run Sheet → CSV</span>
        </button>
      </section>

      <section className={styles.setupBar}>
        <label className={styles.field}>State
          <input value={stateCode} maxLength={2} onChange={(event) => setStateCode(event.target.value.toUpperCase())} disabled={busy} />
        </label>
        <label className={styles.field}>Search Type
          <select value={searchType} onChange={(event) => setSearchType(event.target.value as (typeof SEARCH_TYPES)[number])} disabled={busy}>
            {SEARCH_TYPES.map((type) => <option key={type}>{type}</option>)}
          </select>
        </label>
        <div className={styles.systemState}>
          <span className={`${styles.statusPill} ${readiness?.openAIConfigured ? styles.good : styles.warn}`}>{readiness?.openAIConfigured ? "AI connected" : "AI not configured"}</span>
          <span className={`${styles.statusPill} ${readiness?.largeFileStorageConfigured ? styles.good : styles.warn}`}>{readiness?.largeFileStorageConfigured ? "Large-file upload ready" : "Small files only"}</span>
          <span className={styles.statusPill}>{readiness?.authenticationMode === "testing-bypass" ? "Testing mode" : "Authenticated"}</span>
        </div>
      </section>

      {(phase === "select" || phase === "ready") && !exam && !runSheet ? <section className={`${styles.panel} ${styles.uploadPanel}`}>
        <div>
          <p className={styles.eyebrow}>Step 1 · Upload</p>
          <h2>{mode === "review" ? "Choose one complete title-report packet" : "Choose the recorded title documents"}</h2>
          <p>{mode === "review" ? "Selecting a file does not start the AI. You will see the file first, then explicitly start the VERA review." : "Choose one combined PDF or multiple supported title documents. You will confirm them before the Run Sheet build starts."}</p>
          <div className={styles.actions}>
            <label className={styles.secondaryButton}>
              {selectedFiles.length ? "Choose different file" : "Choose file"}
              <input type="file" accept=".pdf,.txt,.md" multiple={mode === "build"} hidden disabled={busy} onChange={(event) => { chooseFiles(event.target.files); event.currentTarget.value = ""; }} />
            </label>
            {selectedFiles.length ? <button className={styles.primaryButton} onClick={() => void runReview()} disabled={!readiness?.openAIConfigured || busy}>
              {mode === "review" ? "Run VERA Review" : "Build Run Sheet"}
            </button> : null}
          </div>
        </div>
        {selectedFiles.length ? <div className={styles.fileCard}>
          <span>{selectedFiles.length === 1 ? "Selected packet" : `${selectedFiles.length} selected documents`}</span>
          {selectedFiles.map((file) => <strong key={`${file.name}-${file.size}`}>{file.name} · {fileSize(file.size)}</strong>)}
          <span>{mode === "review" ? `${stateCode} · ${searchType} · ready to review` : `${stateCode} · ${searchType} · ready to build`}</span>
        </div> : null}
      </section> : null}

      {busy ? <section className={`${styles.panel} ${styles.processingCard}`} aria-live="polite">
        <div className={styles.processingTop}>
          <div>
            <p className={styles.eyebrow}>Step 2 · Run review</p>
            <h2>{phase === "uploading" ? "Uploading the packet securely" : mode === "review" ? "Title review is in progress" : "Run Sheet build is in progress"}</h2>
            <p>{phase === "uploading" ? "The source file is moving into private temporary storage. Analysis has not started yet." : mode === "review" ? "Cybrid Title is reading the full packet, applying VERA/RCS rules, collecting page evidence, and running the second verification pass. Keep this tab open." : "Cybrid Title is extracting the recorded documents, building proposed rows, and running the independent verification pass."}</p>
          </div>
          <span className={styles.statusPill}>{phase === "uploading" ? `${uploadPercent || 1}% uploaded` : "Review running"}</span>
        </div>
        <div className={styles.progressTrack}><div className={styles.progressBar} style={{ width: phase === "uploading" ? `${Math.max(5, uploadPercent)}%` : "72%" }} /></div>
        <div className={styles.processList}>
          <div className={`${styles.processItem} ${phase === "uploading" ? styles.processActive : styles.processDone}`}><strong>Secure upload</strong>{phase === "uploading" ? "Uploading source packet" : "Source packet received"}</div>
          <div className={`${styles.processItem} ${phase === "reviewing" ? styles.processActive : ""}`}><strong>Read + evaluate</strong>{phase === "reviewing" ? "Reading every page and applying rules" : "Waiting for upload"}</div>
          <div className={`${styles.processItem} ${phase === "reviewing" ? styles.processActive : ""}`}><strong>Verify + prepare</strong>{phase === "reviewing" ? "Second-pass verification and output preparation" : "Waiting for analysis"}</div>
        </div>
      </section> : null}

      {phase === "error" && error ? <section className={`${styles.panel} ${styles.errorCard}`} role="alert">
        <div className={styles.errorKicker}>Review stopped</div>
        <h2>{quotaError ? "OpenAI API credits are exhausted" : "The review did not complete"}</h2>
        <p>{quotaError ? "Your PDF upload path is working. The AI provider rejected the review because the API account has no remaining credits, so no title analysis was completed." : error}</p>
        {quotaError ? <p className={styles.errorDetail}>Add credits to the OpenAI API account, then return here and click <b>Retry review</b>. Your selected file is still available in this browser tab, so you do not need to choose it again.</p> : null}
        <div className={styles.actions}>
          {selectedFiles.length ? <button className={styles.primaryButton} onClick={() => void runReview()}>{mode === "review" ? "Retry review" : "Retry build"}</button> : null}
          {quotaError ? <a className={styles.secondaryButton} href="https://platform.openai.com/settings/organization/billing" target="_blank" rel="noreferrer">Open API billing</a> : null}
          <label className={styles.ghostButton}>Choose different file<input type="file" accept=".pdf,.txt,.md" multiple={mode === "build"} hidden onChange={(event) => { chooseFiles(event.target.files); event.currentTarget.value = ""; }} /></label>
        </div>
        {!quotaError ? <p className={styles.errorDetail}>{error}</p> : null}
      </section> : null}

      {exam ? <section>
        <div className={`${styles.panel} ${styles.reviewHeader}`}>
          <div>
            <p className={styles.eyebrow}>Step 3 · Review findings</p>
            <h2>{exam.clientOrder !== "Not Provided" ? exam.clientOrder : exam.sourceFile}</h2>
            <p>{exam.propertyAddress} · {exam.searchType} · {verdict?.failed} critical unresolved · {verdict?.pending} critical awaiting examiner decision</p>
          </div>
          <div className={styles.reviewActions}>
            <button className={styles.secondaryButton} onClick={approveCleanFindings}>Approve clean findings</button>
            <button className={styles.primaryButton} onClick={() => void downloadVeraDocx()}>Export VERA DOCX</button>
            <button className={styles.secondaryButton} onClick={printVera}>Print / Save PDF</button>
          </div>
        </div>

        <div className={styles.summaryGrid}>
          <div className={styles.summaryCard}><strong>{reviewCounts.fail}</strong><span>Fail</span></div>
          <div className={styles.summaryCard}><strong>{reviewCounts.cannot}</strong><span>Cannot confirm</span></div>
          <div className={styles.summaryCard}><strong>{reviewCounts.pass}</strong><span>Pass</span></div>
          <div className={styles.summaryCard}><strong>{reviewCounts.na}</strong><span>Not applicable</span></div>
        </div>

        {notice ? <div className={styles.notice}>{notice}</div> : null}

        <div className={styles.findingList} style={{ marginTop: 12 }}>
          {issueFindings.length ? issueFindings.map(findingCard) : <div className={`${styles.panel} ${styles.processingCard}`}><h2>No exceptions found.</h2><p>All applicable findings returned PASS or N/A. Review the clean findings below before export.</p></div>}
        </div>

        {cleanFindings.length ? <details className={styles.cleanDetails}>
          <summary>{cleanFindings.length} clean PASS / N/A finding{cleanFindings.length === 1 ? "" : "s"} · expand to inspect</summary>
          <div className={styles.cleanBody}>{cleanFindings.map(findingCard)}</div>
        </details> : null}
      </section> : null}

      {runSheet ? <section>
        <div className={`${styles.panel} ${styles.reviewHeader}`}>
          <div>
            <p className={styles.eyebrow}>Step 3 · Review Run Sheet</p>
            <h2>{runSheet.propertyAddress}</h2>
            <p>{runSheet.buildSummary}</p>
          </div>
          <div className={styles.reviewActions}><button className={styles.primaryButton} onClick={downloadRunSheetCsv}>Export Run Sheet CSV</button></div>
        </div>
        {notice ? <div className={styles.notice}>{notice}</div> : null}
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {runSheet.rows.map((row, index) => <details className={styles.runRow} key={`${row.instrumentNumber}-${index}`} open={row.verificationStatus === "REVIEW"}>
            <summary><b>{row.sequence}. {row.category}</b> · {row.instrumentType} · {row.instrumentNumber} · {row.verificationStatus}</summary>
            <div className={styles.runFields}>
              {([
                ["instrumentType", "Instrument Type"], ["documentDate", "Document Date"], ["recordingDate", "Recording Date"], ["instrumentNumber", "Instrument #"],
                ["book", "Book"], ["page", "Page"], ["grantorBorrower", "Grantor / Borrower"], ["granteeBeneficiary", "Grantee / Beneficiary"],
                ["amount", "Amount"], ["status", "Status"], ["legalDescriptionSummary", "Legal Description"], ["notes", "Notes"],
              ] as Array<[keyof RunSheetRow, string]>).map(([key, label]) => <label className={styles.field} key={key}>{label}<input value={String(row[key] ?? "")} onChange={(event) => patchRunRow(index, key, event.target.value)} /></label>)}
            </div>
            <div style={{ padding: "0 14px 14px" }}><p className={styles.findingBody}><b>Verification:</b> {row.verificationNote}</p><EvidenceList evidence={row.evidence} /></div>
          </details>)}
        </div>
      </section> : null}
    </div>

    {exam ? <article className={styles.paper}>
      <header className={styles.paperHeader}><Logo height={48} tone="letterhead" /><div><strong>Cybrid Title</strong><br /><span>Title Report Review Summary · VERA v3</span></div></header>
      <p><b>Search Type:</b> {exam.searchType}<br /><b>Client Order#:</b> {exam.clientOrder}<br /><b>Property Address:</b> {exam.propertyAddress}<br /><b>Search Effective Date:</b> {exam.searchEffectiveDate}<br /><b>MIN#:</b> {exam.minNumber}</p>
      <h3>Property & Tax Information</h3>{exam.summaryEvidence.map((field, index) => <p key={index}><b>{field.field}:</b> {field.value}</p>)}
      <h3>Required Question Responses</h3>{exam.findings.map((finding) => <div key={finding.number} style={{ marginBottom: 12 }}><b>{finding.number}. {finding.question}</b><div>Response: {finding.reviewDecision === "OVERRIDDEN" ? finding.reviewerResponse : finding.response}</div>{finding.evidence.map((evidence, index) => <div key={index}>Evidence — {evidence.sourceFile ? `${evidence.sourceFile}, ` : ""}P{evidence.page}: “{evidence.quote}”</div>)}<div>Examiner decision: {finding.reviewDecision || "PENDING"}</div></div>)}
      <h3>Title Report / Run Sheet Accuracy Audit</h3><p>Vesting Deed Information: {exam.audit.vestingDeed}<br />Chain of Title: {exam.audit.chainOfTitle}<br />Mortgage Information: {exam.audit.mortgageInformation}<br />Tax Information: {exam.audit.taxInformation}<br />Judgments and Liens: {exam.audit.judgmentsAndLiens}<br />Easements and Restrictions: {exam.audit.easementsAndRestrictions}</p>
      <h3>Pass/Fail Determination</h3><p><b>Status:</b> {verdict?.status}<br /><b>Automated reason:</b> {exam.reason}<br /><b>Notes:</b> {exam.notes || "None"}</p>
    </article> : null}
  </main>;
}
