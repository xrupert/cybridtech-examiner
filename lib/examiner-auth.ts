import { timingSafeEqual } from "node:crypto";

export function testingAccessBypassEnabled(): boolean {
  return process.env.EXAMINER_REQUIRE_ACCESS_CODE !== "true";
}

export function accessProtectionConfigured(): boolean {
  return !testingAccessBypassEnabled() && Boolean(process.env.EXAMINER_ACCESS_CODE);
}

export function examinerAuthenticationMode(): "testing-bypass" | "access-code" {
  return testingAccessBypassEnabled() ? "testing-bypass" : "access-code";
}

function equalSecrets(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function checkExaminerAccess(request: Request): { ok: true } | { ok: false; status: number; error: string } {
  if (testingAccessBypassEnabled()) return { ok: true };

  const configured = process.env.EXAMINER_ACCESS_CODE;
  if (!configured) {
    return {
      ok: false,
      status: 503,
      error: "Examiner access protection is enabled but EXAMINER_ACCESS_CODE is not configured.",
    };
  }
  const provided = request.headers.get("x-examiner-access-code") || "";
  if (!provided || !equalSecrets(provided, configured)) {
    return { ok: false, status: 401, error: "Invalid Examiner access code." };
  }
  return { ok: true };
}

export function checkExaminerAccessCode(value: string): boolean {
  if (testingAccessBypassEnabled()) return true;
  const configured = process.env.EXAMINER_ACCESS_CODE;
  return Boolean(configured && value && equalSecrets(value, configured));
}
