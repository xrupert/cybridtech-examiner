"use client";

import { useState } from "react";
import type { QcCheckResult, QcStatus } from "@/lib/title-domain";
import styles from "./demo.module.css";

export type ExaminerDecision = "CONFIRM" | "CORRECT" | "NEEDS_EVIDENCE";
export interface SavedDecision {
  checkId: string;
  decision: ExaminerDecision;
  correctedStatus?: QcStatus;
  correctedValue?: string;
  reason: string;
}

export function ReviewDecisionControls({
  reviewId,
  check,
  currentDecision,
  onSaved,
}: {
  reviewId: string;
  check: QcCheckResult;
  currentDecision?: ExaminerDecision;
  onSaved: (decision: SavedDecision) => void;
}) {
  const [mode, setMode] = useState<"CORRECT" | "NEEDS_EVIDENCE" | null>(null);
  const [status, setStatus] = useState<QcStatus>(check.status === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : check.status === "CANNOT_CONFIRM" ? "PASS" : check.status);
  const [value, setValue] = useState(check.summary);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(decision: ExaminerDecision) {
    const resolvedReason = decision === "CONFIRM"
      ? "Examiner confirmed this finding against the displayed packet evidence."
      : reason.trim();
    if (!resolvedReason) { setError("Add a reason so the correction/rejection is auditable."); return; }
    setSaving(true); setError("");
    const body = {
      reviewId,
      checkId: check.id,
      decision,
      correctedStatus: decision === "CORRECT" ? status : undefined,
      correctedValue: decision === "CORRECT" ? value.trim() || check.summary : undefined,
      reason: resolvedReason,
    };
    try {
      const response = await fetch("/api/review-decisions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Could not save examiner decision.");
      onSaved({ checkId: check.id, decision, correctedStatus: body.correctedStatus, correctedValue: body.correctedValue, reason: resolvedReason });
      setMode(null); setReason("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save examiner decision.");
    } finally { setSaving(false); }
  }

  return <div style={{ marginTop: 10 }}>
    <div className={styles.actions}>
      <button className={styles.secondary} disabled={saving} onClick={() => save("CONFIRM")}>Confirm</button>
      <button className={styles.secondary} disabled={saving} onClick={() => setMode(mode === "CORRECT" ? null : "CORRECT")}>Reject / correct</button>
      <button className={styles.danger} disabled={saving} onClick={() => setMode(mode === "NEEDS_EVIDENCE" ? null : "NEEDS_EVIDENCE")}>Need evidence</button>
      {currentDecision ? <span className={styles.profileNote}>Disposition: {currentDecision.replaceAll("_", " ")}</span> : <span className={styles.profileNote}>Examiner review required</span>}
    </div>

    {mode === "CORRECT" ? <div style={{ marginTop: 10, display: "grid", gap: 8, padding: 12, border: "1px solid #e0e2e7", borderRadius: 10, background: "#fafafa" }}>
      <label className={styles.field}>Correct result
        <select value={status} onChange={(event) => setStatus(event.target.value as QcStatus)}>
          <option value="PASS">PASS</option><option value="FAIL">FAIL</option><option value="CANNOT_CONFIRM">CANNOT CONFIRM</option><option value="NOT_APPLICABLE">NOT APPLICABLE</option>
        </select>
      </label>
      <label className={styles.field}>Corrected finding
        <textarea value={value} onChange={(event) => setValue(event.target.value)} rows={3} style={{ border: "1px solid #d7d9df", borderRadius: 9, padding: 10, font: "inherit" }} />
      </label>
      <label className={styles.field}>Why are you correcting it?
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} placeholder="Example: Source document on page 18 shows the release recorded under Instrument..." style={{ border: "1px solid #d7d9df", borderRadius: 9, padding: 10, font: "inherit" }} />
      </label>
      <div className={styles.actions}><button className={styles.primary} disabled={saving} onClick={() => save("CORRECT")}>Save correction</button><button className={styles.secondary} disabled={saving} onClick={() => setMode(null)}>Cancel</button></div>
    </div> : null}

    {mode === "NEEDS_EVIDENCE" ? <div style={{ marginTop: 10, display: "grid", gap: 8, padding: 12, border: "1px solid #f0c6be", borderRadius: 10, background: "#fffaf8" }}>
      <label className={styles.field}>What evidence is missing or insufficient?
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="Describe the missing document, page, recording, or proof needed to close this question." style={{ border: "1px solid #d7d9df", borderRadius: 9, padding: 10, font: "inherit" }} />
      </label>
      <div className={styles.actions}><button className={styles.danger} disabled={saving} onClick={() => save("NEEDS_EVIDENCE")}>Mark evidence required</button><button className={styles.secondary} disabled={saving} onClick={() => setMode(null)}>Cancel</button></div>
    </div> : null}
    {error ? <div className={styles.errorBox} style={{ marginTop: 8, marginBottom: 0 }}>{error}</div> : null}
  </div>;
}
