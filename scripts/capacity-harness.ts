import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { makeShards, mapConcurrent } from "../lib/sharded-title-extractor";
async function main() {
  process.env.VERA_SHARD_PAGE_LIMIT = "72";
  process.env.VERA_SHARD_CHAR_LIMIT = "220000";
  const pages: any[] = Array.from({ length: 1000 }, (_, i) => ({ page: i + 1, text: `Page ${i + 1} ` + "x".repeat(1000) }));
  const start = performance.now();
  const shards = makeShards(pages);
  assert.equal(new Set(shards.flat().map((p) => p.page)).size, 1000);
  assert.ok(shards.every((s) => s.length <= 72));
  console.log(`CAPACITY synthetic planning: 1000 pages -> ${shards.length} shards in ${(performance.now()-start).toFixed(2)} ms`);
  let active = 0; let peak = 0;
  const outputs = await mapConcurrent(shards, 3, async (_, i) => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--; return i;
  });
  assert.equal(peak, 3); assert.deepEqual(outputs, shards.map((_, i) => i));
  let successful = 0;
  await assert.rejects(mapConcurrent([0,1,2,3,4], 3, async (_, i) => {
    await new Promise((resolve) => setTimeout(resolve, i === 0 ? 1 : 5));
    if (i === 0) throw new Error("injected shard failure");
    successful++; return i;
  }), /injected shard failure/);
  assert.equal(successful, 4, "running workers drain remaining work before surfacing a failure");
  console.log("CAPACITY: coverage, page bound, concurrency bound, ordered results and sibling completion passed. No OCR/model throughput claim.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
