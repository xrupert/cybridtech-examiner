# Vera durable worker

The Next app submits durable jobs to PostgreSQL. A separate, always-on Node worker claims one job at a time, launches a child process, renews its lease and bounds each attempt to 30 minutes. Completed extraction shards are reused after a worker interruption. Exhausted retries produce an explicit ERROR, never an inferred PASS.

## Provisioning and rollout

1. Create a dedicated PostgreSQL database and private Blob store for each client. Use provider-supported TLS and a pooler appropriate to serverless web connections. Do not disable certificate verification.
2. Configure VERA_DATABASE_URL on web and worker; keep it server-only. The pool is capped at five connections per process. Size the database for the maximum web instances and worker replicas.
3. Run `npm run migrate` with a migration role against the intended database. Migrations are explicit; request handlers never create tables.
4. Supply matching VERA_CLIENT_ID, VERA_CLIENT_NAME, VERA_COMPLIANCE_MODE=1, BLOB_READ_WRITE_TOKEN, OpenAI settings and OCR endpoint credentials on web and worker. Configure EXAMINER_ACCESS_CODE for web access.
5. Build `services/vera-worker/Dockerfile` from the repository root and run it as an always-on worker. `railway.vera-worker.toml` supplies the build/start configuration. This service does not expose an HTTP application port. Monitor process health and database queue age.
6. Set container CPU and memory limits, start with one replica, and validate representative packets before increasing replicas. All replicas for one client must share the same client settings/database/store and pinned code revision.
7. Apply a verified migration for old batch, decision, receipt and history objects; there is no automatic import from Blob.

`npm run worker` runs locally after configuration. `npm run test:durability` requires VERA_TEST_DATABASE=1 and VERA_DATABASE_URL pointing to a disposable test database. It uses its own random client namespace and removes only those test records. Never point it at production.

Lease renewal failure stops the child; another worker reclaims after expiry. There are at most three attempts, separated by 30 seconds after known failures. The web status endpoint excludes lease tokens and input paths. Existing job results survive browser refresh or worker restarts. This does not make external provider calls or Blob writes exactly-once.

Before changing code, prompts, models or extraction configuration, drain in-flight jobs or implement a checkpoint migration. Update checkpoint keys when semantics change. A new upload generates a new request identity; terminal errors are not silently reset by duplicate submission.

See docs/PHASE_3_DURABILITY_REVIEW.md for remaining production gates.
