"use client";

import Link from "next/link";
import { upload } from "@vercel/blob/client";
import { useEffect, useMemo, useState } from "react";
import { SEARCH_TYPES } from "@/lib/audit-rules";
import { runSheetToCsv, type RunSheetBuild, type RunSheetRow } from "@/lib/run-sheet";
import type { AuditFinding, EvidenceRef, FindingStatus, VeraExam } from "@/lib/vera";
import { Logo } from "../components/Logo";

type Mode = "review" | "build";
type Readiness = {
  openAIConfigured: boolean;
  accessProtectionConfigured: boolean;
  largeFileStorageConfigured: boolean;
  documentModel?: string;
};

const inputStyle = { width: "100%", background: "#050505", color: "#fff", border: "1px solid rgba(255,255,255,.16)", borderRadius: 8, padding: "10px 11px", fontSize: 12 } as const;
const panelStyle = { background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.09)", borderRadius: 16, padding: 18 } as const;
const evidenceStyle = { marginTop: 8, padding: "10px 12px", borderLeft: "2px solid #8052ff", background: "rgba(128,82,255,.07)", color: "#d7d7dc", fontSize: 12, lineHeight: 1.5 } as const;

function statusLabel(status: FindingStatus) {
  if (status === "NOT_APPLICABLE") return "PASS / N/A";
  if (status === "CANNOT_CONFIRM") return "CANNOT CONFIRM";
  return status.replaceAll("_", " ");
}

function safeName(value: string) {
  return (value || "title-output").replace(/\.[^/.]+$/, "").replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "title-output";
}

async function parseApiResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  let payload: any = null;
  let raw = "";
  if (contentType.includes("application/json")) {
    try { payload = await response.json(); } catch { payload = null; }
  } else {
    raw = await response.text().catch(() => "");
  }
  if (!response.ok) {
    if (response.status === 413) throw new Error("This packet is larger than Vercel's direct-request limit. Configure the private large-file store or use the direct-upload path.");
    throw new Error(payload?.error || raw || `Request failed (${response.status}).`);
  }
  return payload;
}

function EvidenceList({ evidence }: { evidence: EvidenceRef[] }) {
  if (!evidence.length) return <div style={evidenceStyle}><b>Evidence:</b> Not Stated</div>;
  return <>{evidence.map((item, index) => <div key={`${item.sourceFile || "packet"}-${item.page}-${index}`} style={evidenceStyle}>
    <b>{item.sourceFile ? `${item.sourceFile} · ` : ""}Page {item.page} · {item.documentType}</b>
    <div style={{ marginTop: 4 }}>“{item.quote}”</div>
    {item.instrumentNumber ? <small style={{ color: "#85858d" }}>Instrument {item.instrumentNumber}</small> : null}
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
  const [accessCode, setAccessCode] = useState("");
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exam, setExam] = useState<VeraExam | null>(null);
  const [runSheet, setRunSheet] = useState<RunSheetBuild | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem("cybrid-examiner-access") || "";
    if (saved) setAccessCode(saved);
    fetch("/api/examine").then((response) => response.json()).then((data) => setReadiness(data)).catch(() => setReadiness(null));
  }, []);

  useEffect(() => {
    if (accessCode) sessionStorage.setItem("cybrid-examiner-access", accessCode);
  }, [accessCode]);

  const attentionFindings = useMemo(() => exam ? [...exam.findings].sort((a, b) => {
    const score = (item: AuditFinding) => (item.critical && !["PASS", "NOT_APPLICABLE"].includes(item.status) ? 0 : !["PASS", "NOT_APPLICABLE"].includes(item.status) ? 1 : item.critical ? 2 : 3);
    return score(a) - score(b) || a.number - b.number;
  }) : [], [exam]);
  const verdict = useMemo(() => exam ? reviewVerdict(exam) : null, [exam]);

  function authHeaders(extra: HeadersInit = {}) {
    return { ...extra, "x-examiner-access-code": accessCode };
  }

  async function uploadToPrivateStore(files: File[]) {
    if (!accessCode) throw new Error("Enter the Examiner access code first.");
    const pathnames: string[] = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const result = await upload(`title-examiner/${Date.now()}-${safeName(file.name)}`, file, {
        access: "private",
        handleUploadUrl: "/api/uploads",
        clientPayload: JSON.stringify({ accessCode }),
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

  async function submitFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    const files = Array.from(fileList);
    if (mode === "review" && files.length !== 1) {
      setError("Review Existing Title Report accepts one complete title-report packet at a time.");
      return;
    }
    setBusy(true); setError(""); setNotice(""); setUploadPercent(0);
    try {
      if (!accessCode) throw new Error("Enter the Examiner access code.");
      const endpoint = mode === "review" ? "/api/examine" : "/api/run-sheet";
      let response: Response;
      const totalSize = files.reduce((sum, file) => sum + file.size, 0);
      if (readiness?.largeFileStorageConfigured) {
        const blobPathnames = await uploadToPrivateStore(files);
        response = await fetch(endpoint, {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ blobPathnames, state: stateCode, searchType }),
        });
      } else {
        if (totalSize > 4_000_000) throw new Error("This packet is too large for direct Vercel upload. Create the project's private Vercel Blob store so large title packets can upload directly without the 4.5 MB function limit.");
        const form = new FormData();
        files.forEach((file) => form.append("files", file));
        form.set("state", stateCode);
        form.set("searchType", searchType);
        response = await fetch(endpoint, { method: "POST", headers: authHeaders(), body: form });
      }
      const data = await parseApiResponse(response);
      if (mode === "review") {
        const incoming = data?.exam as VeraExam | undefined;
        if (!incoming) throw new Error("The Examiner did not return a VERA review.");
        incoming.findings = incoming.findings.map((finding) => ({ ...finding, reviewDecision: "PENDING" }));
        setExam(incoming); setRunSheet(null);
        setNotice(`VERA v3 review ready · ${data.documentModel || "OpenAI"} · ${data.verificationPasses || 2} passes.`);
      } else {
        const incoming = data?.build as RunSheetBuild | undefined;
        if (!incoming) throw new Error("The Examiner did not return a Run Sheet.");
        setRunSheet(incoming); setExam(null);
        setNotice(`Run Sheet built from ${incoming.sourceFiles.length} document${incoming.sourceFiles.length === 1 ? "" : "s"} · ${data.verificationPasses || 2} passes.`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Processing failed.");
    } finally {
      setBusy(false); setUploadPercent(0);
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
        headers: authHeaders({ "Content-Type": "application/json" }),
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not export DOCX.");
    }
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
  }

  function reset() {
    setExam(null); setRunSheet(null); setError(""); setNotice("");
  }

  return <main className="workbench-page">
    <header className="workbench-nav no-print">
      <Link href="/" aria-label="CybridTech home"><Logo height={38} /></Link>
      <div className="workbench-nav-center"><span>EXAMINER / TITLE EVIDENCE WORKBENCH</span><b>MVP</b></div>
      <div className="workbench-nav-actions">{exam || runSheet ? <button className="text-button" onClick={reset}>New packet</button> : null}</div>
    </header>

    <section className="workbench-heading no-print">
      <p className="eyebrow">One evidence engine · two directions</p>
      <h1>Review the run sheet. Or build it.</h1>
      <p>Use the same source-preserving document engine either to audit an existing title report against VERA v3, or to construct a verified Run Sheet from the recorded title documents themselves.</p>
    </section>

    <div className="no-print" style={{ maxWidth: 1500, margin: "0 auto", padding: "0 24px 60px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12, marginBottom: 18 }}>
        <button onClick={() => { setMode("review"); reset(); }} style={{ ...panelStyle, textAlign: "left", color: "#fff", cursor: "pointer", outline: mode === "review" ? "2px solid #8052ff" : "none" }}>
          <span className="eyebrow">MODE 1</span><h3 style={{ margin: "8px 0" }}>Review Existing Title Report</h3><p style={{ color: "#9a9a9a", margin: 0 }}>Run Sheet + title-document packet → evidence-backed VERA v3 examination → examiner approval/override → DOCX/PDF.</p>
        </button>
        <button onClick={() => { setMode("build"); reset(); }} style={{ ...panelStyle, textAlign: "left", color: "#fff", cursor: "pointer", outline: mode === "build" ? "2px solid #8052ff" : "none" }}>
          <span className="eyebrow">MODE 2</span><h3 style={{ margin: "8px 0" }}>Build Run Sheet From Documents</h3><p style={{ color: "#9a9a9a", margin: 0 }}>Recorded title documents → classify/extract → independently verify → editable Run Sheet → CSV.</p>
        </button>
      </div>

      <section style={{ ...panelStyle, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 18 }}>
        <label style={{ display: "grid", gap: 6, fontSize: 11, color: "#9a9a9a" }}>State
          <input value={stateCode} maxLength={2} onChange={(event) => setStateCode(event.target.value.toUpperCase())} style={inputStyle} />
        </label>
        <label style={{ display: "grid", gap: 6, fontSize: 11, color: "#9a9a9a" }}>RCS Search Type
          <select value={searchType} onChange={(event) => setSearchType(event.target.value as (typeof SEARCH_TYPES)[number])} style={inputStyle}>{SEARCH_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
        </label>
        <label style={{ display: "grid", gap: 6, fontSize: 11, color: "#9a9a9a" }}>Examiner Access Code
          <input type="password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} style={inputStyle} placeholder="Server-verified access code" />
        </label>
        <div style={{ fontSize: 11, color: "#9a9a9a", alignSelf: "end", lineHeight: 1.6 }}>
          OpenAI: <b style={{ color: readiness?.openAIConfigured ? "#80d7c5" : "#ffb829" }}>{readiness?.openAIConfigured ? "READY" : "NOT CONFIGURED"}</b><br />
          Protected: <b style={{ color: readiness?.accessProtectionConfigured ? "#80d7c5" : "#ffb829" }}>{readiness?.accessProtectionConfigured ? "YES" : "NO"}</b><br />
          Large files: <b style={{ color: readiness?.largeFileStorageConfigured ? "#80d7c5" : "#ffb829" }}>{readiness?.largeFileStorageConfigured ? "READY" : "DIRECT <4.5MB ONLY"}</b>
        </div>
      </section>

      {!exam && !runSheet ? <section style={{ ...panelStyle, textAlign: "center", padding: 34 }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>＋</div>
        <h2 style={{ margin: "0 0 8px" }}>{mode === "review" ? "Upload one complete title-report packet" : "Upload the title documents"}</h2>
        <p style={{ color: "#9a9a9a", maxWidth: 720, margin: "0 auto 18px" }}>{mode === "review" ? "The packet is examined against VERA v3, the recovered no-assumption doctrine, and the selected RCS order-type rules." : "Upload one combined PDF or multiple PDF/TXT/MD title documents. The system builds a Run Sheet, then independently re-reads the documents to verify each row."}</p>
        <label className="primary-pill" style={{ cursor: "pointer", display: "inline-block" }}>{busy ? (uploadPercent ? `Uploading ${uploadPercent}%…` : "Processing…") : "Choose file(s)"}<input type="file" accept=".pdf,.txt,.md" multiple={mode === "build"} hidden disabled={busy} onChange={(event) => void submitFiles(event.target.files)} /></label>
        {busy ? <p style={{ marginTop: 14, color: "#bdbdbd", fontSize: 12 }}>{uploadPercent ? "Secure private upload in progress." : "OpenAI is reading the packet and running independent verification."}</p> : null}
      </section> : null}

      {exam ? <section style={{ marginTop: 18 }}>
        <div style={{ ...panelStyle, display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div><span className="eyebrow">VERA v3 review</span><h2 style={{ margin: "6px 0" }}>{exam.clientOrder !== "Not Provided" ? exam.clientOrder : exam.sourceFile}</h2><p style={{ margin: 0, color: "#9a9a9a" }}>{exam.propertyAddress}</p></div>
          <div style={{ textAlign: "right" }}><strong style={{ fontSize: 28 }}>{verdict?.status.toUpperCase()}</strong><div style={{ color: "#9a9a9a", fontSize: 12 }}>{verdict?.failed} critical unresolved · {verdict?.pending} critical awaiting examiner decision</div></div>
          <div style={{ display: "flex", gap: 8 }}><button className="text-button" onClick={approveCleanFindings}>Approve clean passes</button><button className="primary-pill" onClick={() => void downloadVeraDocx()}>Export VERA DOCX</button><button className="text-button" onClick={() => window.print()}>PDF</button></div>
        </div>

        <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
          {attentionFindings.map((finding) => <article key={finding.number} style={{ ...panelStyle, borderColor: finding.critical && !["PASS", "NOT_APPLICABLE"].includes(finding.status) ? "rgba(255,184,41,.45)" : "rgba(255,255,255,.09)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start" }}>
              <div><span className="eyebrow">Q{finding.number}{finding.critical ? " · CRITICAL" : ""}</span><h3 style={{ margin: "6px 0" }}>{finding.question}</h3></div>
              <b>{statusLabel(finding.status)}</b>
            </div>
            <p><b>AI response:</b> {finding.response}</p>
            <EvidenceList evidence={finding.evidence} />
            <p style={{ color: "#bdbdbd", fontSize: 12 }}><b>Proof / Reason:</b> {finding.proofReason}</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <button className="text-button" onClick={() => setReviewDecision(finding.number, "APPROVED")}>Approve</button>
              <button className="text-button" onClick={() => setReviewDecision(finding.number, "OVERRIDDEN")}>Override</button>
              <button className="text-button" onClick={() => setReviewDecision(finding.number, "NEEDS_REVIEW")}>Needs review</button>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "#9a9a9a" }}>Examiner: {finding.reviewDecision || "PENDING"}</span>
            </div>
            {finding.reviewDecision === "OVERRIDDEN" ? <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "160px 1fr", gap: 8 }}>
              <select value={finding.reviewerStatus || finding.status} onChange={(event) => patchFinding(finding.number, { reviewerStatus: event.target.value as FindingStatus })} style={inputStyle}>
                {["PASS", "FAIL", "CANNOT_CONFIRM", "NOT_APPLICABLE", "NOT_STATED"].map((status) => <option key={status}>{status}</option>)}
              </select>
              <input value={finding.reviewerResponse || ""} onChange={(event) => patchFinding(finding.number, { reviewerResponse: event.target.value })} style={inputStyle} placeholder="Corrected examiner response" />
              <div />
              <input value={finding.reviewerReason || ""} onChange={(event) => patchFinding(finding.number, { reviewerReason: event.target.value })} style={inputStyle} placeholder="Override reason — required for the audit trail" />
            </div> : null}
          </article>)}
        </div>
      </section> : null}

      {runSheet ? <section style={{ marginTop: 18 }}>
        <div style={{ ...panelStyle, display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div><span className="eyebrow">Generated Run Sheet</span><h2 style={{ margin: "6px 0" }}>{runSheet.propertyAddress}</h2><p style={{ margin: 0, color: "#9a9a9a" }}>{runSheet.buildSummary}</p></div>
          <button className="primary-pill" onClick={downloadRunSheetCsv}>Export CSV</button>
        </div>
        {runSheet.requirementsReview.length ? <div style={{ ...panelStyle, marginTop: 12, borderColor: "rgba(255,184,41,.45)" }}><b>Requirements requiring examiner review</b>{runSheet.requirementsReview.map((item, index) => <p key={index} style={{ color: "#d7d7dc", fontSize: 12 }}>{item}</p>)}</div> : null}
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {runSheet.rows.map((row, index) => <details key={`${row.instrumentNumber}-${index}`} style={panelStyle} open={row.verificationStatus === "REVIEW"}>
            <summary style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12 }}><span><b>{row.sequence}. {row.category}</b> · {row.instrumentType} · {row.instrumentNumber}</span><b>{row.verificationStatus}</b></summary>
            <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 8 }}>
              {([
                ["instrumentType", "Instrument Type"], ["documentDate", "Document Date"], ["recordingDate", "Recording Date"], ["instrumentNumber", "Instrument #"],
                ["book", "Book"], ["page", "Page"], ["grantorBorrower", "Grantor / Borrower"], ["granteeBeneficiary", "Grantee / Beneficiary"],
                ["amount", "Amount"], ["status", "Status"], ["legalDescriptionSummary", "Legal Description"], ["notes", "Notes"],
              ] as Array<[keyof RunSheetRow, string]>).map(([key, label]) => <label key={key} style={{ display: "grid", gap: 5, fontSize: 10, color: "#9a9a9a" }}>{label}<input value={String(row[key] ?? "")} onChange={(event) => patchRunRow(index, key, event.target.value)} style={inputStyle} /></label>)}
            </div>
            <p style={{ fontSize: 11, color: row.verificationStatus === "VERIFIED" ? "#80d7c5" : "#ffb829" }}><b>Verification:</b> {row.verificationNote}</p>
            <EvidenceList evidence={row.evidence} />
          </details>)}
        </div>
        <p style={{ marginTop: 12, color: "#777", fontSize: 11 }}>MVP Run Sheet columns are evidence-first and export cleanly to CSV. The exact customer/RCS sheet column mapping can be swapped in when a sample production Run Sheet is supplied; the underlying extracted evidence does not change.</p>
      </section> : null}

      {(error || notice) ? <div className={`toast ${error ? "error" : "success"}`} role="status">{error || notice}</div> : null}
    </div>

    {exam ? <article className="document-preview printable-document" style={{ maxWidth: 850, margin: "0 auto 60px", background: "#fff", color: "#15161a", padding: 42 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 18, borderBottom: "3px solid #8052ff", paddingBottom: 16 }}><Logo height={52} tone="letterhead" /><div style={{ textAlign: "right" }}><strong>Title Report Review Summary</strong><div style={{ fontSize: 10, color: "#667085" }}>VERA v3 · CybridTech Examiner</div></div></header>
      <p><b>Search Type:</b> {exam.searchType}<br /><b>Client Order#:</b> {exam.clientOrder}<br /><b>Property Address:</b> {exam.propertyAddress}<br /><b>Search Effective Date:</b> {exam.searchEffectiveDate}<br /><b>MIN#:</b> {exam.minNumber}</p>
      <h3>Property & Tax Information</h3>{exam.summaryEvidence.map((field, index) => <p key={index}><b>{field.field}:</b> {field.value}</p>)}
      <h3>Required Question Responses</h3>{exam.findings.map((finding) => <div key={finding.number} style={{ marginBottom: 12 }}><b>{finding.number}. {finding.question}</b><div>Response: {finding.reviewDecision === "OVERRIDDEN" ? finding.reviewerResponse : finding.response}</div>{finding.evidence.map((evidence, index) => <div key={index} style={{ fontSize: 10, color: "#4e5562" }}>Evidence — {evidence.sourceFile ? `${evidence.sourceFile}, ` : ""}P{evidence.page}: “{evidence.quote}”</div>)}<div style={{ fontSize: 10 }}>Examiner decision: {finding.reviewDecision || "PENDING"}{finding.reviewDecision === "OVERRIDDEN" ? ` · ${finding.reviewerStatus} · ${finding.reviewerReason}` : ""}</div></div>)}
      <h3>Title Report / Run Sheet Accuracy Audit</h3><p>Vesting Deed Information: {exam.audit.vestingDeed}<br />Chain of Title: {exam.audit.chainOfTitle}<br />Mortgage Information: {exam.audit.mortgageInformation}<br />Tax Information: {exam.audit.taxInformation}<br />Judgments and Liens: {exam.audit.judgmentsAndLiens}<br />Easements and Restrictions: {exam.audit.easementsAndRestrictions}</p>
      <h3>Pass/Fail Determination</h3><p><b>Status:</b> {verdict?.status}<br /><b>Automated reason:</b> {exam.reason}<br /><b>Notes:</b> {exam.notes || "None"}</p>
    </article> : null}
  </main>;
}
