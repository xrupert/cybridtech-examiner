"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { VeraExam } from "@/lib/vera";
import { examToPlain } from "@/lib/render-report";
import { critique } from "@/lib/critic";
import { QUESTIONS } from "@/lib/questions";
import { Logo } from "../components/Logo";

export default function ExaminePage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [exam, setExam] = useState<VeraExam | null>(null);
  const [pasted, setPasted] = useState("");
  const [hot, setHot] = useState(false);
  const [sourceName, setSourceName] = useState("");

  async function run(body: FormData | { fixtureId?: string; text?: string }) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/examine", {
        method: "POST",
        body: body instanceof FormData ? body : JSON.stringify(body),
        headers: body instanceof FormData ? undefined : { "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Examine failed");
      setExam(json.exam);
      setSourceName(json.exam?.sourceFile || "upload");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Examine failed");
    } finally {
      setBusy(false);
    }
  }

  function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    setSourceName(Array.from(files).map((f) => f.name).join(", "));
    run(fd);
  }

  function patch(id: string, value: string) {
    if (!exam) return;
    const q = QUESTIONS.find((item) => item.id === id);
    if (!q) return;
    setExam(q.set(exam, value));
  }

  function rerunCritic() {
    if (!exam) return;
    setExam(critique(exam));
  }

  const plain = useMemo(() => (exam ? examToPlain(exam) : ""), [exam]);
  const sections = useMemo(() => {
    const map = new Map<string, typeof QUESTIONS>();
    for (const q of QUESTIONS) {
      const list = map.get(q.section) || [];
      list.push(q);
      map.set(q.section, list);
    }
    return Array.from(map.entries());
  }, []);

  return (
    <div className="wrap">
      <header className="nav">
        <Link href="/" className="brand"><Logo height={32} /></Link>
        <nav className="nav-links">
          <Link href="/">Home</Link>
          <button className="pill no-print" type="button" onClick={() => window.print()} disabled={!exam}>Print worksheet</button>
        </nav>
      </header>
      <p className="kicker">Workbench</p>
      <h1>Upload a report. Review every Vera question.</h1>
      <p className="lede">Each template line is extracted, then left open for you to correct. Re-run the critic when the answers are honest.</p>
      <div className="no-print">
        <div className={`drop ${hot ? "hot" : ""}`} onDragOver={(e) => { e.preventDefault(); setHot(true); }} onDragLeave={() => setHot(false)} onDrop={(e) => { e.preventDefault(); setHot(false); onFiles(e.dataTransfer.files); }}>
          <p>{busy ? "Reading packet…" : "Drop PDF / TXT here, or choose files. Bulk accepted."}</p>
          <div className="row" style={{ justifyContent: "center" }}>
            <label className="pill">Upload packet<input type="file" multiple accept=".pdf,.txt,.md" hidden onChange={(e) => onFiles(e.target.files)} /></label>
          </div>
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="chip" type="button" onClick={() => run({ fixtureId: "kern-mock" })}>Load Kern County mock</button>
            <button className="chip" type="button" onClick={() => run({ fixtureId: "prelim-mock" })}>Load preliminary mock</button>
          </div>
        </div>
        <textarea placeholder="Or paste report text" value={pasted} onChange={(e) => setPasted(e.target.value)} />
        <div className="row">
          <button className="pill" type="button" disabled={busy || !pasted.trim()} onClick={() => run({ text: pasted })}>{busy ? "Examining" : "Examine paste"}</button>
        </div>
        {error ? <p className="muted" style={{ color: "#ffb829", marginTop: 16 }}>{error}</p> : null}
      </div>

      {exam ? (
        <article className="section">
          <div className="letterhead">
            <Logo height={44} />
            <div>
              <div className="sub">Title Report Review Summary</div>
              <div className="tiny">{sourceName}</div>
            </div>
          </div>
          <p className={`tiny ${exam.status === "Pass" ? "status-pass" : "status-fail"}`}>Status {exam.status} — {exam.reason}</p>
          <div className="row no-print" style={{ marginBottom: 36 }}>
            <button className="pill" type="button" onClick={rerunCritic}>Re-run critic</button>
          </div>

          {sections.map(([section, items]) => (
            <section key={section} className="q-section">
              <p className="kicker">{section}</p>
              {items.map((q) => (
                <label key={q.id} className="q">
                  <span className="label">{q.prompt}</span>
                  <textarea
                    className="q-input"
                    rows={q.id === "legalDescription" || q.id === "notes" || q.id === "confirmation" || q.id === "reason" ? 3 : 2}
                    value={q.get(exam)}
                    onChange={(e) => patch(q.id, e.target.value)}
                  />
                </label>
              ))}
            </section>
          ))}

          <h2 style={{ marginTop: 48 }}>Printable worksheet</h2>
          <pre className="report">{plain}</pre>
        </article>
      ) : null}
    </div>
  );
}
