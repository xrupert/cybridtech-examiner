import { checkExaminerAccess } from "@/lib/examiner-auth";
export async function GET(request: Request) {
  const access = checkExaminerAccess(request);
  return access.ok
    ? Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
    : Response.json({ error: access.error }, { status: access.status, headers: { "Cache-Control": "no-store" } });
}
