import { readJob, finishJob, withJobContext, checkpoint } from "../lib/durable-jobs";
import { filesFromPrivateBlobs } from "../lib/blob-files";
import { reviewTitlePdfUnified } from "../lib/unified-title-engine";
import { closeDatabase } from "../lib/database";
async function main() {
  try {
    const job = await readJob(process.env.VERA_JOB_ID || "");
    if (!job || job.status !== "PROCESSING" || job.lease_token !== process.env.VERA_JOB_TOKEN) throw new Error("Job lease is invalid.");
    await withJobContext(job, async () => {
      const result = await checkpoint("review-result-v1", async () => {
        const [file] = await filesFromPrivateBlobs([job.input.pathname]);
        const execution = await reviewTitlePdfUnified(await file.arrayBuffer(), file.name, { clientName: job.input.clientName, requestedState: job.input.state, requestedSearchType: job.input.searchType });
        return { review: execution.review, diagnostics: execution.diagnostics, count: 1, engine: execution.review.engineVersion };
      });
      if (!await finishJob(job, result)) throw new Error("Job lease expired before completion.");
    });
  } finally { await closeDatabase(); }
}
main().catch(() => { console.error("Job attempt failed; the supervisor will apply the retry policy."); process.exitCode = 1; });
