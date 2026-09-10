"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { examinerFetch, setExaminerAccessCode } from "@/lib/examiner-client";

export function ExaminerAccess({ children }: { children: ReactNode }) {
  const [code, setCode] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setExaminerAccessCode(code);
    try {
      const response = await examinerFetch("/api/access");
      if (!response.ok) throw new Error((await response.json()).error || "Access could not be verified.");
      setCode(""); setReady(true);
    } catch (e) {
      setExaminerAccessCode(""); setError(e instanceof Error ? e.message : "Access could not be verified.");
    } finally { setBusy(false); }
  }
  if (ready) return <>{children}</>;
  return <main style={{ maxWidth: 440, margin: "80px auto", padding: 24 }}>
    <h1>Open VeraTitle</h1>
    <form onSubmit={submit}>
      <label htmlFor="access-code">Examiner access code</label>
      <input id="access-code" type="password" autoComplete="current-password" value={code} onChange={(e) => setCode(e.target.value)} style={{ display: "block", width: "100%", margin: "12px 0" }} />
      <button disabled={busy}>{busy ? "Checking access…" : "Continue"}</button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  </main>;
}
