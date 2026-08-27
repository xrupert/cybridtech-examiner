"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { AuditFinding, VeraExam } from "@/lib/vera";
import { examToPlain } from "@/lib/render-report";
import { QUESTIONS } from "@/lib/questions";
import { SEARCH_TYPES } from "@/lib/audit-rules";
import { Logo } from "../components/Logo";

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function safeFileName(value: string) {
  return (value || "title-review").replace(/\.[^/.]+$/, "").replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "title-review";
}

async function imageToDataUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load the CybridTech letterhead logo.");
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not prepare the letterhead logo."));
    reader.readAsDataURL(blob);
  });
}

function statusLabel(finding: AuditFinding) {
  if (finding.status === "NOT_APPLICABLE") return "PASS / N/A";
  if (finding.status === "CANNOT_CONFIRM") return "FAIL / CANNOT CONFIRM";
  if (finding.status === "NOT_STATED") return finding.critical ? "FAIL / NOT STATED" : "NOT STATED";
  return finding.status.replaceAll("_", " ");
}

function evidenceHtml(finding: AuditFinding) {
  if (!finding.evidence.length) return `<div class="evidence empty">Evidence: Not Stated</div>`;
  return finding.evidence.map((ev) => `<div class="evidence"><b>Page ${ev.page} · ${escapeHtml(ev.documentType)}</b><br>“${escapeHtml(ev.quote)}”<br><small>${escapeHtml(ev.source)}${typeof ev.confidence === "number" ? ` · ${(ev.confidence * 100).toFixed(1)}% confidence` : ""}</small></div>`).join("");
}

function buildWordDocument(exam: VeraExam, logoDataUrl: string) {
  const findings = exam.findings.map((finding) => `
    <section class="finding">
      <h3>${finding.number}. ${escapeHtml(finding.question)} <span class="status">${escapeHtml(statusLabel(finding))}</span></h3>
      <p><b>Response:</b> ${escapeHtml(finding.response)}</p>
      ${evidenceHtml(finding)}
      ${finding.critical ? `<p><b>Status:</b> ${finding.status === "PASS" || finding.status === "NOT_APPLICABLE" ? "PASS" : "FAIL"}</p>` : ""}
      <p><b>Proof / Reason:</b> ${escapeHtml(finding.proofReason)}</p>
    </section>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>CybridTech Title Report Review</title><style>
  @page{margin:.55in} body{font-family:Arial,Helvetica,sans-serif;color:#15161a;font-size:10pt;line-height:1.45;margin:0}.letterhead{display:table;width:100%;border-bottom:3px solid #6f46c7;padding-bottom:14px;margin-bottom:18px}.brand,.title{display:table-cell;vertical-align:middle}.brand img{width:250px}.title{text-align:right}.title strong{display:block;font-size:15pt}.title span{color:#667085;font-size:8pt;text-transform:uppercase;letter-spacing:.08em}.summary{width:100%;border-collapse:collapse;margin-bottom:14px}.summary td{padding:4px 8px 4px 0}.label{color:#667085;width:20%;font-size:8pt;text-transform:uppercase}.verdict{margin:12px 0 20px;padding:10px 12px;border-left:4px solid ${exam.status === "Pass" ? "#16846e" : "#b7791f"};background:#f7f7fa}.verdict strong{font-size:14pt}.finding{break-inside:avoid;margin:0 0 18px}.finding h3{font-size:10pt;margin:0 0 6px;border-bottom:1px solid #d9dce3;padding-bottom:5px;color:#5f3fb2}.status{float:right;color:#667085;font-size:8pt}.finding p{margin:5px 0}.evidence{margin:7px 0;padding:8px 10px;background:#f7f7fa;border-left:2px solid #8052ff;font-size:9pt}.evidence small{color:#667085}.audit{margin:24px 0;padding-top:12px;border-top:2px solid #15161a}.footer{margin-top:24px;padding-top:10px;border-top:1px solid #d9dce3;color:#7a808b;font-size:8pt}</style></head><body>
  <div class="letterhead"><div class="brand"><img src="${logoDataUrl}" alt="CybridTech Solutions"></div><div class="title"><strong>Forensic Title Report Review</strong><span>Evidence-First Examiner</span></div></div>
  <table class="summary"><tr><td class="label">Client Order</td><td>${escapeHtml(exam.clientOrder)}</td><td class="label">Search Type</td><td>${escapeHtml(exam.searchType)}</td></tr><tr><td class="label">Property</td><td colspan="3">${escapeHtml(exam.propertyAddress)}</td></tr><tr><td class="label">State / County</td><td>${escapeHtml(exam.state)} / ${escapeHtml(exam.county)}</td><td class="label">Effective Date</td><td>${escapeHtml(exam.searchEffectiveDate)}</td></tr></table>
  <div class="verdict"><strong>${escapeHtml(exam.status.toUpperCase())}</strong> — ${exam.criticalPassRate}% critical pass rate<br>${escapeHtml(exam.reason)}</div>
  <h2>Required Questions 1–20</h2>${findings}
  <div class="audit"><h2>Accuracy Audit</h2><p><b>Vesting Deed:</b> ${escapeHtml(exam.audit.vestingDeed)}</p><p><b>Chain of Title:</b> ${escapeHtml(exam.audit.chainOfTitle)}</p><p><b>Mortgage Information:</b> ${escapeHtml(exam.audit.mortgageInformation)}</p><p><b>Tax Information:</b> ${escapeHtml(exam.audit.taxInformation)}</p><p><b>Judgments and Liens:</b> ${escapeHtml(exam.audit.judgmentsAndLiens)}</p><p><b>Easements and Restrictions:</b> ${escapeHtml(exam.audit.easementsAndRestrictions)}</p></div>
  <div class="audit"><h2>Extraction Audit Trail</h2><p>${escapeHtml(exam.extractionSummary)}</p><p><b>Manual review required:</b> ${exam.manualReviewRequired ? "YES" : "NO"}</p><p><b>Rule pack:</b> ${escapeHtml(exam.rulePackStatus)}</p></div>
  <div class="footer">Prepared with CybridTech Examiner · ${escapeHtml(new Date(exam.extractedAt).toLocaleString())}</div></body></html>`;
}

const selectStyle = { width: "100%", background: "#050505", color: "#fff", border: "1px solid rgba(255,255,255,.16)", borderRadius: 8, padding: "10px 11px", fontSize: 12 } as const;
const evidenceStyle = { marginTop: 8, padding: "10px 12px", borderLeft: "2px solid #8052ff", background: "rgba(128,82,255,.07)", color: "#d7d7dc", fontSize: 12, lineHeight: 1.5 } as const;

export default function ExaminePage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exams, setExams] = useState<VeraExam[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pasted, setPasted] = useState("");
  const [hot, setHot] = useState(false);
  const [state, setState] = useState("TX");
  const [searchType, setSearchType] = useState("General Search");

  const exam = exams[activeIndex] || null;
  const plain = useMemo(() => exam ? examToPlain(exam) : "", [exam]);
  const completion = useMemo(() => exam?.findings.length ? Math.round((exam.findings.filter((f) => f.status !== "UNDETERMINED").length / exam.findings.length) * 100) : 0, [exam]);

  async function run(body: FormData | { fixtureId?: string; text?: string }) {
    setBusy(true); setError(""); setNotice("");
    try {
      let requestBody: BodyInit;
      let headers: HeadersInit | undefined;
      if (body instanceof FormData) {
        body.set("state", state); body.set("searchType", searchType); requestBody = body;
      } else {
        requestBody = JSON.stringify({ ...body, state, searchType }); headers = { "Content-Type": "application/json" };
      }
      const response = await fetch("/api/examine", { method: "POST", body: requestBody, headers });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Examination failed");
      const incoming: VeraExam[] = Array.isArray(json.exams) ? json.exams : json.exam ? [json.exam] : [];
      if (!incoming.length) throw new Error("The examiner did not return a review.");
      setExams(incoming); setActiveIndex(0);
      setNotice(`${incoming.length} review${incoming.length === 1 ? "" : "s"} ready. ${json.azureOcrConfigured ? "Azure OCR is configured." : "Azure OCR is not configured yet."}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Examination failed"); }
    finally { setBusy(false); }
  }

  function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const form = new FormData(); Array.from(files).forEach((file) => form.append("files", file)); void run(form);
  }

  function patch(id: string, value: string) {
    const question = QUESTIONS.find((item) => item.id === id); if (!question) return;
    setExams((current) => current.map((item, index) => index === activeIndex ? question.set(item, value) : item));
  }

  async function copyReport() {
    try { await navigator.clipboard.writeText(plain); setNotice("Forensic review copied to clipboard."); }
    catch { setError("Clipboard access was blocked by the browser."); }
  }

  async function downloadWord() {
    if (!exam) return;
    try {
      const logo = await imageToDataUrl("/cybridtech-logo-letterhead.png");
      const blob = new Blob([buildWordDocument(exam, logo)], { type: "application/msword;charset=utf-8" });
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${safeFileName(exam.clientOrder !== "Not Provided" ? exam.clientOrder : exam.sourceFile)}-forensic-title-review.doc`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url); setNotice("Detailed Word review downloaded with CybridTech letterhead.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create Word review."); }
  }

  function clearWorkspace() { setExams([]); setActiveIndex(0); setPasted(""); setError(""); setNotice(""); }

  return <main className="workbench-page">
    <header className="workbench-nav no-print"><Link href="/" aria-label="CybridTech home"><Logo height={38} /></Link><div className="workbench-nav-center"><span>EXAMINER / FORENSIC WORKBENCH</span>{exam ? <b>{activeIndex + 1} OF {exams.length}</b> : null}</div><div className="workbench-nav-actions">{exam ? <button className="text-button" onClick={clearWorkspace}>New packet</button> : null}<button className="primary-pill" onClick={() => window.print()} disabled={!exam}>Export PDF</button></div></header>

    <section className="workbench-heading no-print"><p className="eyebrow">Evidence-first title audit</p><h1>Every answer carries its proof.</h1><p>Page-aware extraction, OCR fallback when configured, 20 VERA audit questions, bidirectional Run Sheet checks, explicit Cannot Confirm handling, and a branded deliverable with the evidence attached.</p></section>

    <div className="workbench-grid">
      <aside className="queue-rail no-print">
        <div className="rail-label">Audit context</div>
        <label style={{display:"grid",gap:6,marginBottom:10,fontSize:11,color:"#9a9a9a"}}>State<input value={state} maxLength={2} onChange={(e) => setState(e.target.value.toUpperCase())} style={selectStyle} /></label>
        <label style={{display:"grid",gap:6,marginBottom:18,fontSize:11,color:"#9a9a9a"}}>Search type<select value={searchType} onChange={(e) => setSearchType(e.target.value)} style={selectStyle}>{SEARCH_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
        <div className="rail-label">Source packet</div>
        <div className={`upload-zone ${hot ? "is-hot" : ""}`} onDragOver={(e) => {e.preventDefault();setHot(true)}} onDragLeave={() => setHot(false)} onDrop={(e) => {e.preventDefault();setHot(false);onFiles(e.dataTransfer.files)}}><div className="upload-mark">+</div><strong>{busy ? "Building evidence index…" : "Drop title reports here"}</strong><span>PDF, TXT, MD · single or bulk</span><label className="primary-pill compact-pill">Choose files<input type="file" multiple accept=".pdf,.txt,.md" hidden onChange={(e) => onFiles(e.target.files)} /></label></div>
        <details className="paste-drawer"><summary>Paste report text</summary><textarea className="paste-input" placeholder="Paste title report text…" value={pasted} onChange={(e) => setPasted(e.target.value)} /><button className="text-button accent-text" disabled={busy || !pasted.trim()} onClick={() => void run({text:pasted})}>Examine pasted text →</button></details>
        <div className="fixture-links"><span>DEMO DATA</span><button onClick={() => void run({fixtureId:"kern-mock"})}>Kern County mock</button><button onClick={() => void run({fixtureId:"prelim-mock"})}>Preliminary mock</button></div>
        {exams.length ? <div className="queue-list"><div className="rail-label">Review queue</div>{exams.map((item,index) => <button key={`${item.sourceFile}-${index}`} className={`queue-item ${index===activeIndex?"is-active":""}`} onClick={() => setActiveIndex(index)}><span className={`queue-status ${item.status.toLowerCase()}`}>{item.status}</span><strong>{item.clientOrder !== "Not Provided" ? item.clientOrder : `Report ${index+1}`}</strong><small>{item.sourceFile}</small></button>)}</div> : null}
      </aside>

      <section className="editor-column no-print">
        {exam ? <>
          <div className="editor-toolbar"><div><span className="rail-label">Active forensic review</span><h2>{exam.clientOrder !== "Not Provided" ? exam.clientOrder : exam.sourceFile}</h2><p>{exam.propertyAddress}</p></div><div className="editor-score"><span>{completion}%</span><small>questions evaluated</small></div></div>
          <div className={`critic-strip ${exam.status.toLowerCase()}`}><div><span>FORENSIC VERDICT · {exam.criticalPassRate}% CRITICAL PASS</span><strong>{exam.status}</strong><p>{exam.reason}</p></div></div>
          <div style={{padding:"14px 0 18px",borderBottom:"1px solid rgba(255,255,255,.09)",fontSize:12,color:exam.manualReviewRequired?"#ffb829":"#9a9a9a"}}><b>Extraction audit:</b> {exam.extractionSummary}<br/><b>Manual review required:</b> {exam.manualReviewRequired ? " YES" : " NO"}<br/><b>Rule pack:</b> {exam.rulePackStatus}</div>

          <div style={{marginTop:26}}><span className="rail-label">Required questions 1–20 · evidence attached</span></div>
          {exam.findings.map((finding) => <details className="review-section" key={finding.number} open={finding.critical && finding.status !== "PASS" && finding.status !== "NOT_APPLICABLE"}>
            <summary><span>{finding.number}. {finding.question}</span><small>{statusLabel(finding)}</small></summary>
            <div className="question-list" style={{padding:"8px 0 16px"}}>
              <div style={{fontSize:14,lineHeight:1.5}}><b>Response:</b> {finding.response}</div>
              {finding.evidence.length ? finding.evidence.map((ev,index) => <div key={`${ev.page}-${index}`} style={evidenceStyle}><b>Evidence · Page {ev.page} · {ev.documentType}</b><div style={{marginTop:4}}>“{ev.quote}”</div><small style={{color:"#85858d"}}>{ev.source}{typeof ev.confidence === "number" ? ` · ${(ev.confidence*100).toFixed(1)}% confidence` : ""}</small></div>) : <div style={evidenceStyle}><b>Evidence:</b> Not Stated</div>}
              {finding.critical ? <div style={{marginTop:10,fontSize:12}}><b>Status:</b> {finding.status === "PASS" || finding.status === "NOT_APPLICABLE" ? "PASS" : "FAIL"}</div> : null}
              <div style={{marginTop:8,color:"#bdbdbd",fontSize:12,lineHeight:1.55}}><b>Proof / Reason:</b> {finding.proofReason}</div>
            </div>
          </details>)}

          <details className="review-section"><summary><span>Packet document inventory</span><small>{exam.documents.length} page records</small></summary><div className="question-list">{exam.documents.map((doc,index) => <div key={`${doc.pageStart}-${index}`} style={{padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,.08)",fontSize:12}}><b>Page {doc.pageStart} · {doc.documentType}</b><div style={{color:"#9a9a9a",marginTop:4}}>{doc.instrumentNumber ? `Instrument ${doc.instrumentNumber} · ` : ""}{doc.recordingDate || "No recording date parsed"}</div><div style={{color:"#777",marginTop:3}}>{doc.excerpt}</div></div>)}</div></details>

          <details className="review-section"><summary><span>Extracted fields / examiner corrections</span><small>{QUESTIONS.length} fields</small></summary><div className="question-list"><p style={{color:"#9a9a9a",fontSize:11,lineHeight:1.5}}>These fields may be corrected for the deliverable. Manual edits do not manufacture or replace cited source evidence.</p>{QUESTIONS.map((question) => <label className="question-row" key={question.id}><span>{question.prompt}</span><textarea rows={["legalDescription","reason","confirmation","notes"].includes(question.id)?4:1} value={question.get(exam)} onChange={(e) => patch(question.id,e.target.value)} /></label>)}</div></details>
        </> : <div className="editor-empty"><span className="eyebrow">Waiting for a packet</span><h2>Your evidence review appears here.</h2><p>Choose the state and search type, then upload a title-report packet. The examiner will retain page-level evidence and refuse unsupported conclusions.</p></div>}
      </section>

      <aside className={`report-rail ${exam?"":"no-print"}`}>
        {exam ? <><div className="report-actions no-print"><div><span className="rail-label">Client output</span><small>Detailed forensic document</small></div><div><button className="text-button" onClick={() => void copyReport()}>Copy</button><button className="text-button" onClick={() => void downloadWord()}>Word</button></div></div>
          <article className="document-preview printable-document">
            <header className="document-letterhead"><Logo height={54} tone="letterhead" /><div><strong>Forensic Title Report Review</strong><span>Evidence-First Examiner</span></div></header>
            <div className="document-meta-grid"><div><span>Client Order</span><b>{exam.clientOrder}</b></div><div><span>Search Type</span><b>{exam.searchType}</b></div><div className="wide"><span>Property Address</span><b>{exam.propertyAddress}</b></div><div><span>State / County</span><b>{exam.state} / {exam.county}</b></div><div><span>Effective Date</span><b>{exam.searchEffectiveDate}</b></div></div>
            <div className={`document-verdict ${exam.status.toLowerCase()}`}><span>Review status · {exam.criticalPassRate}% critical pass</span><strong>{exam.status}</strong><p>{exam.reason}</p></div>
            <section className="document-section"><h3>Property & Tax Information</h3><div className="document-rows"><div className="document-row"><span>Parcel ID</span><p>{exam.parcelId}</p></div><div className="document-row"><span>Land Value</span><p>{exam.landValue}</p></div><div className="document-row"><span>Improvements</span><p>{exam.improvements}</p></div><div className="document-row"><span>Tax Status</span><p>{exam.taxStatus}</p></div></div></section>
            <section className="document-section"><h3>Required Questions 1–20</h3>{exam.findings.map((finding) => <div className="document-row" key={`doc-${finding.number}`} style={{display:"block",padding:"10px 0"}}><span>{finding.number}. {finding.question} · {statusLabel(finding)}</span><p><b>Response:</b> {finding.response}</p>{finding.evidence.length ? finding.evidence.map((ev,index) => <p key={index} style={{fontSize:"9px",color:"#4e5562",margin:"4px 0"}}><b>Evidence P{ev.page}:</b> “{ev.quote}”</p>) : <p style={{fontSize:"9px",color:"#777"}}>Evidence: Not Stated</p>}<p style={{fontSize:"9px"}}><b>Proof / Reason:</b> {finding.proofReason}</p></div>)}</section>
            <section className="document-section"><h3>Accuracy Audit</h3><div className="document-rows"><div className="document-row"><span>Vesting Deed</span><p>{exam.audit.vestingDeed}</p></div><div className="document-row"><span>Chain of Title</span><p>{exam.audit.chainOfTitle}</p></div><div className="document-row"><span>Mortgage Information</span><p>{exam.audit.mortgageInformation}</p></div><div className="document-row"><span>Tax Information</span><p>{exam.audit.taxInformation}</p></div><div className="document-row"><span>Judgments and Liens</span><p>{exam.audit.judgmentsAndLiens}</p></div><div className="document-row"><span>Easements and Restrictions</span><p>{exam.audit.easementsAndRestrictions}</p></div></div></section>
            <section className="document-section"><h3>Extraction Audit Trail</h3><p style={{color:"#4e5562",fontSize:"10px"}}>{exam.extractionSummary}</p><p style={{color:"#4e5562",fontSize:"10px"}}>Manual review required: <b>{exam.manualReviewRequired?"YES":"NO"}</b></p><p style={{color:"#4e5562",fontSize:"10px"}}>{exam.rulePackStatus}</p></section>
            <footer className="document-footer"><span>Prepared with CybridTech Examiner</span><span>{new Date(exam.extractedAt).toLocaleString()}</span></footer>
          </article></> : <div className="report-empty"><span>FORENSIC DOCUMENT PREVIEW</span><p>The evidence-backed review will appear here.</p></div>}
      </aside>
    </div>
    {(error||notice)?<div className={`toast no-print ${error?"error":"success"}`} role="status">{error||notice}</div>:null}
  </main>;
}
