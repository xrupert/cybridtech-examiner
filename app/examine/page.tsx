"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { VeraExam } from "@/lib/vera";
import { examToPlain } from "@/lib/render-report";
import { Logo } from "../components/Logo";

export default function ExaminePage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [exam, setExam] = useState<VeraExam | null>(null);
  const [pasted, setPasted] = useState("");
  const [hot, setHot] = useState(false);

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
    run(fd);
  }

  const plain = useMemo(() => (exam ? examToPlain(exam) : ""), [exam]);

  return (
    <div className="wrap">
      <header className="nav">
        <Link href="/" className="brand">
          <Logo height={32} />
        </Link>
        <nav className="nav-links">
          <Link href="/">Home</Link>
          <button className="pill no-print" type="button" onClick={() => window.print()} disabled={!exam}>Print worksheet</button>
        </nav>
      </header>
      <p className="kicker">Workbench</p>
      <h1>Drop a title report</h1>
      <p className="lede">PDF or plain text. Demo fixtures are the Kern County packets from Title-Examiner-Portfolio.</p>
      <div className="no-print">
        <div className={`drop ${hot ? "hot" : ""}`} onDragOver={(e) => { e.preventDefault(); setHot(true); }} onDragLeave={() => setHot(false)} onDrop={(e) => { e.preventDefault(); setHot(false); onFiles(e.dataTransfer.files); }}>
          <p>Drop PDF / TXT here, or choose files. Bulk accepted.</p>
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
            <div className="sub">Title Report Review Summary</div>
          </div>
          <p className={`tiny ${exam.status === "Pass" ? "status-pass" : "status-fail"}`}>Status {exam.status} — {exam.reason}</p>
          <div className="grid" style={{ marginTop: 36 }}>
            <div>
              <Field label="Search Type" value={exam.searchType} />
              <Field label="Client Order#" value={exam.clientOrder} />
              <Field label="Property Address" value={exam.propertyAddress} />
              <Field label="Effective Date" value={exam.searchEffectiveDate} />
              <Field label="Parcel ID" value={exam.parcelId} />
              <Field label="Land Value" value={exam.landValue} />
            </div>
            <div>
              <Field label="Legal description" value={exam.legalDescription} />
              <Field label="HOA / CCR" value={`${exam.hoaPresent} · ${exam.ccrs}`} />
              <Field label="Loan type / status" value={`${exam.loanDocumentType} · ${exam.loanStatus}`} />
              <Field label="Confirmation" value={exam.confirmation} />
            </div>
          </div>
          <h2 style={{ marginTop: 48 }}>Vera worksheet</h2>
          <pre className="report">{plain}</pre>
        </article>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
