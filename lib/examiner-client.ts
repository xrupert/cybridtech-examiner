"use client";

// Keep the shared access code in memory, never in browser persistent storage.
let accessCode = "";
export function setExaminerAccessCode(value: string) { accessCode = value; }
export function examinerUploadPayload() { return JSON.stringify({ accessCode }); }
export function examinerFetch(input: string, init: RequestInit = {}) {
  if (!input.startsWith("/api/")) throw new Error("Examiner credentials are restricted to local API routes.");
  const headers = new Headers(init.headers);
  if (accessCode) headers.set("x-examiner-access-code", accessCode);
  return fetch(input, { ...init, headers, redirect: "error" });
}
