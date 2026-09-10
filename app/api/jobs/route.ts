import { readJob } from "@/lib/durable-jobs";
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Invalid job id." }, { status: 400 });
  try {
    const job = await readJob(id);
    if (!job) return Response.json({ error: "Job not found." }, { status: 404 });
    return Response.json({ jobId: job.id, status: job.status, attempts: job.attempts, result: job.status === "COMPLETE" ? job.result : undefined, error: job.status === "ERROR" ? "Processing failed after the retry budget. Contact the operator with this job ID." : undefined }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Job storage is temporarily unavailable." }, { status: 503 }); }
}
