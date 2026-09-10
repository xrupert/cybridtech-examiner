"use client";

import { examinerFetch } from "@/lib/examiner-client";
import { FormEvent, useState } from "react";
import styles from "./AskVera.module.css";

type Citation = {
  page: number;
  quote: string;
  documentType: string;
  instrumentNumber?: string;
  source: string;
  confidence: number;
};

type Answer = {
  answer: string;
  confidence: number;
  cannotConfirm: boolean;
  citations: Citation[];
  retrievedPages: number[];
};

export function AskVera({ reviewId, onOpenSource }: { reviewId: string; onOpenSource: (page: number) => void }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const clean = question.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await examinerFetch("/api/ask-vera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId, question: clean }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || `Ask Vera failed (${response.status}).`);
      setAnswer(payload as Answer);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ask Vera failed.");
    } finally {
      setBusy(false);
    }
  }

  return <section className={`${styles.askVera} screen-only`}>
    <div className={styles.heading}>
      <div><span className={styles.kicker}>Evidence interrogation</span><h2>Ask Vera about this packet</h2></div>
      <p>Answers are constrained to the persisted review dossier and physical PDF evidence. Unreadable or unsupported facts return Cannot Confirm rather than a guess.</p>
    </div>
    <form onSubmit={submit} className={styles.form}>
      <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Example: Who is the current beneficiary, and which assignment proves it?" maxLength={3000} />
      <button type="submit" disabled={busy || !question.trim()}>{busy ? "Checking evidence…" : "Ask Vera"}</button>
    </form>
    {error ? <div className={styles.error}>{error}</div> : null}
    {answer ? <div className={styles.answer}>
      <div className={styles.answerTop}><strong>{answer.cannotConfirm ? "Cannot Confirm" : "Evidence-backed answer"}</strong><span>{Math.round(answer.confidence * 100)}% answer confidence</span></div>
      <p>{answer.answer}</p>
      {answer.citations.length ? <div className={styles.citations}>{answer.citations.map((citation, index) => <div className={styles.citation} key={`${citation.page}-${index}`}>
        <div className={styles.citationTop}><strong>Page {citation.page} · {citation.documentType}</strong><span>{citation.source} · {Math.round(citation.confidence * 100)}%</span></div>
        <blockquote>“{citation.quote}”</blockquote>
        {citation.instrumentNumber ? <div>Instrument: {citation.instrumentNumber}</div> : null}
        <button type="button" onClick={() => onOpenSource(citation.page)}>Open physical page {citation.page}</button>
      </div>)}</div> : <div className={styles.noProof}>No verified physical-page quote could be attached. Manual review is required.</div>}
      {answer.retrievedPages.length ? <div className={styles.retrieved}>Pages examined for this answer: {answer.retrievedPages.join(", ")}</div> : null}
    </div> : null}
  </section>;
}
