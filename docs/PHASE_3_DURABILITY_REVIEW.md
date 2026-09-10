# Phase 3: performance, scalability and durable processing

Base: Phase 2 draft commit efceaeb8566649b9a3dc19529e59e51ebba5580a. This phase extends draft PR #30; it does not deploy production infrastructure.

## Findings and changes

| Priority | Finding | Implementation |
| --- | --- | --- |
| High | A review depended on an 800-second web request and browser connection. | With VERA_DATABASE_URL configured, POST /api/examine stores a job and returns 202 without downloading or processing the PDF. /api/jobs exposes authenticated, client-scoped progress/results. The UI polls and retains the submitted job ID for refresh recovery. |
| High | Duplicate submission could trigger duplicate work. | A unique client/request hash makes repeated submission of the same authorized path and options return the same job. Re-uploading creates a new path and therefore a new job; content-level deduplication is not claimed. |
| High | A process crash lost model extraction progress. | PostgreSQL checkpoints preserve prepared page text, successful extraction shards, semantic checks and final results. Reclaimed jobs reuse completed checkpoints. |
| High | Parallel workers could process the same job or publish stale results. | Atomic SKIP LOCKED claims, 90-second leases, 15-second heartbeat, new lease tokens on reclaim, fenced checkpoint/result writes, and a three-attempt retry budget. This is at-least-once execution with fenced completion, not exactly-once external side effects. |
| High | Native CPU work could block worker renewal indefinitely. | A supervisor runs each job in a separate Node process, renews its lease independently and kills attempts after 30 minutes. One job runs per worker process; deployment replicas set fleet concurrency. |
| High | Batch read/overwrite updates lost concurrent changes. | Database mode locks the batch row within a transaction before updating the manifest. Cross-item updates are retained. Blob-only mode remains for development, not compliance mode. |
| High | Decisions overwrote previous audit events. | Database mode inserts one event per decision and projects the latest event per check. Prior events remain queryable. Database grants and individual identity still need production configuration. |
| Medium | One shard exception rejected aggregation while sibling work was still running. | The scheduler awaits sibling workers before surfacing errors; completed shards remain reusable through checkpoints. It does not silently certify an incomplete extraction. |
| High | OCR rendering and admission lacked budgets. | Local and Python renderers cap pages at 25 megapixels. Python admits one OCR request per process, returns 429 with Retry-After when busy, streams bounded image bodies, limits PDF reads, and moves Tesseract work off the async event loop. Container memory/CPU limits are still required. |
| Medium | Unresolved cached ledgers could preserve old OCR failure states. | Unresolved/skipped ledgers are not reused as ordinary cache hits, and extraction caches are client-scoped. In-job checkpoints intentionally retain the job's original prepared state; rerun a new job after changing OCR configuration. |
| Medium | Model calls and full semantic payloads had no explicit budgets. | Extraction/checking requests use four-minute per-attempt timeouts; file cleanup uses ten seconds. Oversized semantic payloads retain unresolved checks for manual review instead of truncating evidence or implying a completed semantic check. |

PostgreSQL's locking documentation supports using SKIP LOCKED for multiple consumers of queue-like tables. Transactions use one checked-out connection as required by node-postgres. Sources: [PostgreSQL SELECT locking](https://www.postgresql.org/docs/current/sql-select.html), [node-postgres transactions](https://node-postgres.com/features/transactions).

## Verification and evidence limits

The capacity harness plans a synthetic 1,000-page, roughly one-million-character packet into 15 shards, preserves all physical page numbers, caps concurrency at three, preserves output order, and verifies sibling completion after an injected failure. Planning time is measured locally, but this is not a PDF/OCR/model throughput benchmark.

The durability harness requires a real test PostgreSQL database. It exercises 20 duplicate submissions, 12 concurrent claimers, lease expiry and reclaim, stale-writer rejection, checkpoint reuse, reconnect persistence, client isolation, retry exhaustion, 24 simultaneous batch updates and 30 concurrent decision events. CI includes PostgreSQL 17 and executes this harness. Actual CI status is recorded in the PR/phase response; presence of a workflow is not evidence that it passed.

Local TypeScript, existing deterministic regression harnesses and Next production build are also checked. Native OCR and representative real packets have not been load-tested. The local workspace cannot change ownership to start the test PostgreSQL binaries as a non-root user; the database integration gate runs in CI instead.

## Still open before production

- Provision a dedicated PostgreSQL database, restricted application credentials, and an always-on worker per client. Migrate existing Blob histories deliberately. No database or worker has been provisioned by these commits.
- Migrate historical receipt lookup/revision assignment to transactional storage. Existing Blob receipt writes are external side effects: a crash between a write and a checkpoint can create duplicate receipts or source copies. Successful result publication is fenced; these side effects are not atomic with the queue transaction.
- Pin worker/web releases and define checkpoint-version migration before changing models, extraction prompts or OCR configuration while jobs are outstanding. Current checkpoint keys are versioned in code; in-flight jobs should drain before rollout changes.
- Enforce a fleet-wide worker cap, admission/rate limits, connection pool sizing and storage-retention policy. The supervisor heap limit does not cap native allocations; set container memory/CPU limits.
- Batch files still upload/submit sequentially from the browser. A submitted job survives closing the tab; files not yet submitted do not. Refresh recovery restores the saved job, not the entire batch workbench. Batch status is currently driven by the UI; job status is authoritative for execution.
- Add cancellation, operator retry/recovery controls, queue age/dead-letter alerts, worker heartbeat monitoring and a server-side reviewed-export workflow.
- Individual user identity, permissions, database-enforced immutable audit grants and comprehensive provider/input runtime schemas remain Phase 4 gates. Ask Vera still reads the original dossier, not a server-side projection of all examiner decisions.
- Load-test representative 50, 250 and 1,000+ page native/scanned/mixed packets. Measure completion rate, memory peak, wall time, provider retries, per-page unresolved coverage and cost. Obtain examiner acceptance on evidence/output parity with Lovable.
