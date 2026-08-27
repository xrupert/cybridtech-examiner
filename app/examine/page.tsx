"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { VeraExam } from "@/lib/vera";
import { examToPlain } from "@/lib/render-report";
import { critique } from "@/lib/critic";
import { QUESTIONS } from "@/lib/questions";
import { Logo } from "../components/Logo";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeFileName(value: string) {
  return (value || "title-review")
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "title-review";
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

function buildWordDocument(exam: VeraExam, logoDataUrl: string) {
  const grouped = new Map<string, typeof QUESTIONS>();
  for (const question of QUESTIONS) {
    const current = grouped.get(question.section) || [];
    current.push(question);
    grouped.set(question.section, current);
  }

  const sections = Array.from(grouped.entries()).map(([section, items]) => {
    const rows = items.map((question) => {
      const answer = escapeHtml(question.get(exam)).replaceAll("\n", "<br>");
      return `<tr><td class="question">${escapeHtml(question.prompt)}</td><td>${answer}</td></tr>`;
    }).join("");
    return `<h2>${escapeHtml(section)}</h2><table>${rows}</table>`;
  }).join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>CybridTech Title Report Review</title>
<style>
  @page { margin: .55in; }
  body { font-family: Arial, Helvetica, sans-serif; color: #15161a; font-size: 10.5pt; line-height: 1.45; margin: 0; }
  .letterhead { display: table; width: 100%; border-bottom: 3px solid #6f46c7; padding-bottom: 14px; margin-bottom: 18px; }
  .brand, .title { display: table-cell; vertical-align: middle; }
  .brand img { width: 250px; height: auto; }
  .title { text-align: right; }
  .title strong { display: block; font-size: 15pt; letter-spacing: .04em; }
  .title span { color: #667085; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .08em; }
  .summary { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  .summary td { padding: 4px 8px 4px 0; border: 0; }
  .summary .label { color: #667085; width: 20%; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .05em; }
  .verdict { margin: 12px 0 20px; padding: 10px 12px; border-left: 4px solid ${exam.status === "Pass" ? "#16846e" : "#b7791f"}; background: #f7f7fa; }
  .verdict strong { text-transform: uppercase; letter-spacing: .08em; }
  h2 { font-size: 10pt; margin: 20px 0 6px; padding-bottom: 5px; border-bottom: 1px solid #d9dce3; text-transform: uppercase; letter-spacing: .08em; color: #5f3fb2; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  td { vertical-align: top; padding: 6px 8px; border-bottom: 1px solid #eceef2; }
  td.question { width: 46%; color: #4e5562; font-weight: 600; }
  .footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #d9dce3; color: #7a808b; font-size: 8pt; }
</style>
</head>
<body>
  <div class="letterhead">
    <div class="brand"><img src="${logoDataUrl}" alt="CybridTech Solutions"></div>
    <div class="title"><strong>Title Report Review</strong><span>Examiner Summary</span></div>
  </div>
  <table class="summary">
    <tr><td class="label">Client Order</td><td>${escapeHtml(exam.clientOrder)}</td><td class="label">Search Type</td><td>${escapeHtml(exam.searchType)}</td></tr>
    <tr><td class="label">Property</td><td colspan="3">${escapeHtml(exam.propertyAddress)}</td></tr>
    <tr><td class="label">Effective Date</td><td>${escapeHtml(exam.searchEffectiveDate)}</td><td class="label">Source</td><td>${escapeHtml(exam.sourceFile)}</td></tr>
  </table>
  <div class="verdict"><strong>${escapeHtml(exam.status)}</strong> — ${escapeHtml(exam.reason)}</div>
  ${sections}
  <div class="footer">Prepared with CybridTech Examiner • ${escapeHtml(new Date(exam.extractedAt).toLocaleString())}</div>
</body>
</html>`;
}

export default function ExaminePage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exams, setExams] = useState<VeraExam[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pasted, setPasted] = useState("");
  const [hot, setHot] = useState(false);

  const exam = exams[activeIndex] || null;
  const plain = useMemo(() => (exam ? examToPlain(exam) : ""), [exam]);
  const sections = useMemo(() => {
    const map = new Map<string, typeof QUESTIONS>();
    for (const question of QUESTIONS) {
      const list = map.get(question.section) || [];
      list.push(question);
      map.set(question.section, list);
    }
    return Array.from(map.entries());
  }, []);

  const completion = useMemo(() => {
    if (!exam) return 0;
    const answered = QUESTIONS.filter((question) => {
      const value = question.get(exam).trim();
      return value.length > 0 && value !== "Not Provided";
    }).length;
    return Math.round((answered / QUESTIONS.length) * 100);
  }, [exam]);

  async function run(body: FormData | { fixtureId?: string; text?: string }) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/examine", {
        method: "POST",
        body: body instanceof FormData ? body : JSON.stringify(body),
        headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" },
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Examination failed");
      const incoming: VeraExam[] = Array.isArray(json.exams)
        ? json.exams
        : json.exam
          ? [json.exam]
          : [];
      if (!incoming.length) throw new Error("The examiner did not return a review.");
      setExams(incoming);
      setActiveIndex(0);
      setNotice(incoming.length > 1 ? `${incoming.length} reports are ready for review.` : "Review ready.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Examination failed");
    } finally {
      setBusy(false);
    }
  }

  function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const form = new FormData();
    Array.from(files).forEach((file) => form.append("files", file));
    void run(form);
  }

  function patch(id: string, value: string) {
    const question = QUESTIONS.find((item) => item.id === id);
    if (!question) return;
    setExams((current) => current.map((item, index) => (
      index === activeIndex ? question.set(item, value) : item
    )));
  }

  function rerunCritic() {
    setExams((current) => current.map((item, index) => (
      index === activeIndex ? critique(item) : item
    )));
    setNotice("Critic re-run against the edited answers.");
  }

  async function copyReport() {
    if (!plain) return;
    try {
      await navigator.clipboard.writeText(plain);
      setNotice("Review copied to clipboard.");
    } catch {
      setError("Clipboard access was blocked by the browser.");
    }
  }

  async function downloadWord() {
    if (!exam) return;
    setError("");
    try {
      const logoDataUrl = await imageToDataUrl("/cybridtech-logo-letterhead.png");
      const html = buildWordDocument(exam, logoDataUrl);
      const blob = new Blob([html], { type: "application/msword;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${safeFileName(exam.clientOrder !== "Not Provided" ? exam.clientOrder : exam.sourceFile)}-title-review.doc`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice("Word review downloaded with the CybridTech letterhead.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the Word review.");
    }
  }

  function clearWorkspace() {
    setExams([]);
    setActiveIndex(0);
    setPasted("");
    setError("");
    setNotice("");
  }

  return (
    <main className="workbench-page">
      <header className="workbench-nav no-print">
        <Link href="/" aria-label="CybridTech home"><Logo height={38} /></Link>
        <div className="workbench-nav-center">
          <span>EXAMINER / WORKBENCH</span>
          {exam ? <b>{activeIndex + 1} OF {exams.length}</b> : null}
        </div>
        <div className="workbench-nav-actions">
          {exam ? <button className="text-button" type="button" onClick={clearWorkspace}>New packet</button> : null}
          <button className="primary-pill" type="button" onClick={() => window.print()} disabled={!exam}>Export PDF</button>
        </div>
      </header>

      <section className="workbench-heading no-print">
        <p className="eyebrow">Title review bench</p>
        <h1>Read the packet. Verify the answer. Deliver the review.</h1>
        <p>
          Bulk files stay together, every Vera field remains editable, and the client-facing document updates as you work.
        </p>
      </section>

      <div className="workbench-grid">
        <aside className="queue-rail no-print">
          <div className="rail-label">Source packet</div>
          <div
            className={`upload-zone ${hot ? "is-hot" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setHot(true); }}
            onDragLeave={() => setHot(false)}
            onDrop={(event) => {
              event.preventDefault();
              setHot(false);
              onFiles(event.dataTransfer.files);
            }}
          >
            <div className="upload-mark">+</div>
            <strong>{busy ? "Reading packet…" : "Drop title reports here"}</strong>
            <span>PDF, TXT, MD • single or bulk</span>
            <label className="primary-pill compact-pill">
              Choose files
              <input type="file" multiple accept=".pdf,.txt,.md" hidden onChange={(event) => onFiles(event.target.files)} />
            </label>
          </div>

          <details className="paste-drawer">
            <summary>Paste report text</summary>
            <textarea
              className="paste-input"
              placeholder="Paste title report text…"
              value={pasted}
              onChange={(event) => setPasted(event.target.value)}
            />
            <button className="text-button accent-text" type="button" disabled={busy || !pasted.trim()} onClick={() => void run({ text: pasted })}>
              Examine pasted text →
            </button>
          </details>

          <div className="fixture-links">
            <span>DEMO DATA</span>
            <button type="button" onClick={() => void run({ fixtureId: "kern-mock" })}>Kern County mock</button>
            <button type="button" onClick={() => void run({ fixtureId: "prelim-mock" })}>Preliminary mock</button>
          </div>

          {exams.length ? (
            <div className="queue-list">
              <div className="rail-label">Review queue</div>
              {exams.map((item, index) => (
                <button
                  key={`${item.sourceFile}-${index}`}
                  type="button"
                  className={`queue-item ${index === activeIndex ? "is-active" : ""}`}
                  onClick={() => setActiveIndex(index)}
                >
                  <span className={`queue-status ${item.status.toLowerCase()}`}>{item.status}</span>
                  <strong>{item.clientOrder !== "Not Provided" ? item.clientOrder : `Report ${index + 1}`}</strong>
                  <small>{item.sourceFile}</small>
                </button>
              ))}
            </div>
          ) : null}
        </aside>

        <section className="editor-column no-print">
          {exam ? (
            <>
              <div className="editor-toolbar">
                <div>
                  <span className="rail-label">Active review</span>
                  <h2>{exam.clientOrder !== "Not Provided" ? exam.clientOrder : exam.sourceFile}</h2>
                  <p>{exam.propertyAddress}</p>
                </div>
                <div className="editor-score">
                  <span>{completion}%</span>
                  <small>fields populated</small>
                </div>
              </div>

              <div className={`critic-strip ${exam.status.toLowerCase()}`}>
                <div>
                  <span>CRITIC VERDICT</span>
                  <strong>{exam.status}</strong>
                  <p>{exam.reason}</p>
                </div>
                <button className="text-button" type="button" onClick={rerunCritic}>Re-run critic ↻</button>
              </div>

              {sections.map(([section, items]) => (
                <details
                  className="review-section"
                  key={section}
                  open={section === "Header" || section === "Pass/Fail Determination"}
                >
                  <summary>
                    <span>{section}</span>
                    <small>{items.length} fields</small>
                  </summary>
                  <div className="question-list">
                    {items.map((question) => {
                      const tall = ["legalDescription", "reason", "confirmation", "notes"].includes(question.id);
                      return (
                        <label className="question-row" key={question.id}>
                          <span>{question.prompt}</span>
                          <textarea
                            rows={tall ? 4 : 1}
                            value={question.get(exam)}
                            onChange={(event) => patch(question.id, event.target.value)}
                          />
                        </label>
                      );
                    })}
                  </div>
                </details>
              ))}
            </>
          ) : (
            <div className="editor-empty">
              <span className="eyebrow">Waiting for a packet</span>
              <h2>Your review workspace appears here.</h2>
              <p>Upload a title report on the left. The extracted Vera questions will stay editable while the finished document builds on the right.</p>
            </div>
          )}
        </section>

        <aside className={`report-rail ${exam ? "" : "no-print"}`}>
          {exam ? (
            <>
              <div className="report-actions no-print">
                <div>
                  <span className="rail-label">Client output</span>
                  <small>Live document preview</small>
                </div>
                <div>
                  <button className="text-button" type="button" onClick={() => void copyReport()}>Copy</button>
                  <button className="text-button" type="button" onClick={() => void downloadWord()}>Word</button>
                </div>
              </div>

              <article className="document-preview printable-document">
                <header className="document-letterhead">
                  <Logo height={54} tone="letterhead" />
                  <div>
                    <strong>Title Report Review</strong>
                    <span>Examiner Summary</span>
                  </div>
                </header>

                <div className="document-meta-grid">
                  <div><span>Client Order</span><b>{exam.clientOrder}</b></div>
                  <div><span>Search Type</span><b>{exam.searchType}</b></div>
                  <div className="wide"><span>Property Address</span><b>{exam.propertyAddress}</b></div>
                  <div><span>Effective Date</span><b>{exam.searchEffectiveDate}</b></div>
                  <div><span>Source</span><b>{exam.sourceFile}</b></div>
                </div>

                <div className={`document-verdict ${exam.status.toLowerCase()}`}>
                  <span>Review status</span>
                  <strong>{exam.status}</strong>
                  <p>{exam.reason}</p>
                </div>

                {sections.map(([section, items]) => (
                  <section className="document-section" key={`document-${section}`}>
                    <h3>{section}</h3>
                    <div className="document-rows">
                      {items.map((question) => (
                        <div className="document-row" key={`document-${question.id}`}>
                          <span>{question.prompt}</span>
                          <p>{question.get(exam)}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}

                <footer className="document-footer">
                  <span>Prepared with CybridTech Examiner</span>
                  <span>{new Date(exam.extractedAt).toLocaleString()}</span>
                </footer>
              </article>
            </>
          ) : (
            <div className="report-empty">
              <span>DOCUMENT PREVIEW</span>
              <p>The branded review will appear here.</p>
            </div>
          )}
        </aside>
      </div>

      {(error || notice) ? (
        <div className={`toast no-print ${error ? "error" : "success"}`} role="status">
          {error || notice}
        </div>
      ) : null}
    </main>
  );
}
