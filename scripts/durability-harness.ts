import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { database, closeDatabase } from "../lib/database";
import { enqueueJob, claimJob, readJob, heartbeat, finishJob, failJob, checkpoint, withJobContext } from "../lib/durable-jobs";
import { createBatchManifest, updateBatchItem, loadBatchManifest } from "../lib/batch-manifest";
import { saveReviewDecision, loadReviewDecisions } from "../lib/review-decisions";
import { makeShards } from "../lib/sharded-title-extractor";
async function main() {
  if (process.env.VERA_TEST_DATABASE !== "1") throw new Error("Run only against a test database with VERA_TEST_DATABASE=1.");
  process.env.VERA_CLIENT_ID = `phase3-test-${randomUUID()}`;
  process.env.BLOB_READ_WRITE_TOKEN = "test-placeholder-no-blob-requests";
  const scope = process.env.VERA_CLIENT_ID;
  let checks = 0;
  const ok = (value: unknown, name: string) => { assert.ok(value, name); checks++; console.log(`PASS ${name}`); };
  const started = performance.now();
  try {
    await database().query(await readFile("migrations/001_durable_processing.sql", "utf8"));
    const input = { pathname: "test-upload", state: "AUTO", searchType: "Auto Detect", clientName: "Test" };
    const duplicates = await Promise.all(Array.from({ length: 20 }, () => enqueueJob(input)));
    ok(new Set(duplicates.map((job) => job.id)).size === 1, "20 concurrent submissions create one job");
    const claims = await Promise.all(Array.from({ length: 12 }, () => claimJob()));
    ok(claims.filter(Boolean).length === 1, "12 concurrent claimers cannot own the same live lease");
    const first = claims.find(Boolean)!;
    ok(await heartbeat(first), "current worker can renew its lease");
    let calls = 0;
    await withJobContext(first, () => checkpoint("shard-1", async () => ({ value: ++calls })));
    await database().query("UPDATE vera_jobs SET lease_until=now()-interval '1 second' WHERE client_id=$1 AND id=$2", [scope, first.id]);
    const second = (await claimJob())!;
    ok(second.id === first.id && second.lease_token !== first.lease_token && second.attempts === 2, "expired work is reclaimed with a new fencing token");
    ok(!await heartbeat(first), "stale worker cannot renew");
    ok(!await finishJob(first, { wrong: true }), "stale worker cannot publish a result");
    const replay = await withJobContext(second, () => checkpoint("shard-1", async () => ({ value: ++calls })));
    ok(replay.value === 1 && calls === 1, "reclaimed worker reuses persisted shard without recomputation");
    await assert.rejects(withJobContext(first, () => checkpoint("stale-shard", async () => ({ value: 99 }))), /JOB_LEASE_LOST/); checks++;
    ok(await finishJob(second, { review: "retained" }), "current worker publishes completion");
    await closeDatabase();
    ok((await readJob(second.id))?.status === "COMPLETE", "result survives closing and reopening database connections");
    process.env.VERA_CLIENT_ID = "other-client";
    ok(await readJob(second.id) === null, "another client cannot read the job");
    process.env.VERA_CLIENT_ID = scope;
    const retry = await enqueueJob({ ...input, pathname: "retry-upload" });
    for (let n = 0; n < 3; n++) {
      const job = (await claimJob())!;
      assert.equal(job.id, retry.id);
      await failJob(job);
      await database().query("UPDATE vera_jobs SET available_at=now() WHERE client_id=$1 AND id=$2", [scope, job.id]);
    }
    ok((await readJob(retry.id))?.status === "ERROR", "three failed attempts reach terminal error");
    ok(await claimJob() === null, "exhausted jobs are not retried forever");
    const batch = await createBatchManifest("Test", Array.from({ length: 24 }, (_, i) => `packet-${i}.pdf`));
    const updateStart = performance.now();
    await Promise.all(batch.items.map((item) => updateBatchItem(batch.batchId, item.itemId, { status: "COMPLETE" })));
    const updated = await loadBatchManifest(batch.batchId);
    ok(updated?.items.every((item) => item.status === "COMPLETE"), "24 simultaneous batch updates lose no items");
    console.log(`MEASURE batch updates 24: ${(performance.now() - updateStart).toFixed(1)} ms (test database, not production throughput)`);
    const reviewId = randomUUID();
    await Promise.all(Array.from({ length: 30 }, (_, i) => saveReviewDecision({ reviewId, checkId: `check-${i % 10}`, decision: "CONFIRM", reason: `revision-${i}`, actor: "test" })));
    const events = await database().query("SELECT count(*)::int AS count FROM vera_decision_events WHERE client_id=$1 AND review_id=$2", [scope, reviewId]);
    ok(events.rows[0].count === 30, "all 30 concurrent decision events remain in history");
    ok((await loadReviewDecisions(reviewId)).decisions.length === 10, "decision projection returns latest event per check");
    process.env.VERA_SHARD_PAGE_LIMIT = "72";
    process.env.VERA_SHARD_CHAR_LIMIT = "220000";
    const pages: any[] = Array.from({ length: 1000 }, (_, i) => ({ page: i + 1, text: "x".repeat(1000) }));
    const shards = makeShards(pages);
    ok(shards.every((part) => part.length <= 72), "1,000-page synthetic packet respects shard page limit");
    ok(new Set(shards.flat().map((page) => page.page)).size === 1000, "all 1,000 physical pages remain represented");
    console.log(`MEASURE synthetic planning: 1,000 pages -> ${shards.length} shards; no OCR/model calls`);
    console.log(`DURABILITY: ${checks} checks passed in ${(performance.now() - started).toFixed(1)} ms`);
  } finally {
    for (const table of ["vera_checkpoints", "vera_jobs", "vera_batches", "vera_decision_events"]) await database().query(`DELETE FROM ${table} WHERE client_id=$1`, [scope]);
    await closeDatabase();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
