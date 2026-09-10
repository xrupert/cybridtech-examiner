import { checkExaminerAccess } from "@/lib/examiner-auth";
import { loadReviewDossier } from "@/lib/review-dossier";
import { loadReviewDecisions } from "@/lib/review-decisions";
import { projectReviewedResult, releaseWarnings } from "@/lib/review-release";
import { AVAILABLE_EXPORT_COLUMNS, createExportProfile, renderCsv, renderJson, validateExportProfile } from "@/lib/export-profiles";
import { assertClientScope } from "@/lib/client-instance";

export async function POST(request: Request) {
  const access = checkExaminerAccess(request);
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status });
  try {
    const body = await request.json();
    if (!body || !Array.isArray(body.reviewIds) || !body.reviewIds.length || body.reviewIds.length > 100 || body.reviewIds.some((id: unknown) => typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id))) return Response.json({ error: "Provide 1–100 valid review IDs." }, { status: 400 });
    if (!["csv", "json"].includes(body.format) || !Array.isArray(body.columns) || body.columns.length > AVAILABLE_EXPORT_COLUMNS.length || body.columns.some((key: unknown) => typeof key !== "string" || !AVAILABLE_EXPORT_COLUMNS.some((column) => column.key === key))) return Response.json({ error: "Invalid export format or columns." }, { status: 400 });
    const instance = assertClientScope();
    const profile = createExportProfile(instance.clientName, AVAILABLE_EXPORT_COLUMNS.filter((column) => body.columns.includes(column.key)), body.format);
    const rows = [];
    for (const id of [...new Set<string>(body.reviewIds)]) {
      const dossier = await loadReviewDossier(id);
      if (!dossier) return Response.json({ error: "Review not found in this client instance." }, { status: 404 });
      const { decisions } = await loadReviewDecisions(id);
      const review = projectReviewedResult(dossier.review, decisions);
      const warnings = releaseWarnings(review, decisions);
      if (warnings.length) return Response.json({ error: warnings.join(" ") }, { status: 409 });
      rows.push({ record: review.record, qc: review.qc });
    }
    const warnings = validateExportProfile(profile, rows);
    if (warnings.length) return Response.json({ error: warnings.join(" ") }, { status: 409 });
    return new Response(body.format === "csv" ? renderCsv(profile, rows) : renderJson(profile, rows), { headers: {
      "Content-Type": body.format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8",
      "Content-Disposition": `attachment; filename="title-review.${body.format}"`, "Cache-Control": "no-store",
    } });
  } catch { return Response.json({ error: "Reviewed export could not be generated. Check storage and saved decisions." }, { status: 503 }); }
}
