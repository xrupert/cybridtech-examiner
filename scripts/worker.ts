import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { claimJob, failJob, heartbeat, type Job } from "../lib/durable-jobs";
import { closeDatabase } from "../lib/database";
import { assertClientScope } from "../lib/client-instance";
let stopping = false;
let active: ChildProcess | undefined;
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { stopping = true; active?.kill("SIGKILL"); });
async function execute(job: Job) {
  const child = spawn(process.execPath, ["--max-old-space-size=2048", "--import", "tsx", "scripts/run-job.ts"], {
    env: { ...process.env, VERA_JOB_ID: job.id, VERA_JOB_TOKEN: job.lease_token }, stdio: "inherit",
  });
  active = child;
  let renewing = false;
  const interval = setInterval(async () => {
    if (renewing) return;
    renewing = true;
    try { if (!await heartbeat(job)) child.kill("SIGKILL"); }
    catch { child.kill("SIGKILL"); }
    finally { renewing = false; }
  }, 15_000);
  // A separate supervisor bounds native calls even when the child's event loop stalls.
  const deadline = setTimeout(() => child.kill("SIGKILL"), 30 * 60_000);
  try {
    const code = await new Promise<number | null>((resolve) => { child.once("exit", resolve); child.once("error", () => resolve(1)); });
    if (code !== 0) await failJob(job);
  } finally { clearInterval(interval); clearTimeout(deadline); active = undefined; }
}
async function main() {
  assertClientScope();
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Worker requires private storage.");
  try {
    while (!stopping) {
      try { const job = await claimJob(); if (job) await execute(job); else await delay(1000); }
      catch { console.error("Worker unavailable; checking again in five seconds."); await delay(5000); }
    }
  } finally { await closeDatabase(); }
}
main().catch(() => { console.error("Worker startup failed. Check client, database and storage configuration."); process.exitCode = 1; });
