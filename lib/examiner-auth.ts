import { timingSafeEqual } from "node:crypto";

export function accessProtectionConfigured(): boolean {
  return Boolean(process.env.EXAMINER_ACCESS_CODE);
}

function equalSecrets(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function checkExaminerAccess(request: Request): { ok: true } | { ok: false; status: number; error: string } {
  const configured = process.env.EXAMINER_ACCESS_CODE;
  if (!configured) {
    return {
      ok: false,
      status: 503,
      error: "Examiner access protection is not configured. Add EXAMINER_ACCESS_CODE to the Vercel project before enabling production AI processing.",
    };
  }
  const provided = request.headers.get("x-examiner-access-code") || "";
  if (!provided || !equalSecrets(provided, configured)) {
    return { ok: false, status: 401, error: "Invalid Examiner access code." };
  }
  return { ok: true };
}

export function checkExaminerAccessCode(value: string): boolean {
  const configured = process.env.EXAMINER_ACCESS_CODE;
  return Boolean(configured && value && equalSecrets(value, configured));
}
