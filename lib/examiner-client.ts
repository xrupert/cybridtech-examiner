"use client";

export function examinerFetch(input: string, init: RequestInit = {}) {
  if (!input.startsWith("/api/")) throw new Error("Examiner requests are restricted to local API routes.");
  return fetch(input, { ...init, redirect: "error" });
}
