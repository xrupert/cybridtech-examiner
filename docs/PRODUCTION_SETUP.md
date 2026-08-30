# Production / Demo Setup

A Vercel deployment being READY proves the application built; it does not prove paid document review is configured.

## Current demo environment

The current testing/demo deployment intentionally uses the examiner-auth bypass. Review should report:

- `openAIConfigured: true`
- `openAIKeyAliasAccepted: true` when the existing `OPEN_AI_KEY` is used
- `largeFileStorageConfigured: true`
- `authenticationMode: testing-bypass`
- Review model `gpt-5.6-sol`
- one full-packet Review model pass
- deterministic server evidence critic

The application accepts either `OPENAI_API_KEY` or the existing alias:

```bash
OPEN_AI_KEY=...
```

Do not rename or expose a working key merely to satisfy documentation.

## Large title packets

Production-sized files use the private Vercel Blob store already attached to the project:

```bash
BLOB_READ_WRITE_TOKEN=...
```

The browser uploads directly to private Blob storage and the processing route deletes the temporary object after ingestion.

## Customer production authentication

The testing bypass is not customer-production security. Before external launch, replace the temporary access-code/bypass mechanism with real user/tenant/admin authentication and role checks. Do not rely on `EXAMINER_ACCESS_CODE` as the final customer identity architecture.

## Model policy

Review currently uses GPT-5.6 Sol because the earlier two-pass full-PDF design produced unacceptable latency/rate pressure. The Review path is one Sol pass followed by the deterministic server critic.

Build Run Sheet currently uses its separate cost policy and still performs two independent builds; it is an architecture convergence item, not evidence that Review runs two passes.

## Readiness checks

Check:

- `GET /api/examine`
- `GET /api/run-sheet`

For the current demo, `/api/examine` should report OpenAI and Blob ready, state/order auto-detection enabled, testing authentication bypass, one Review model pass, and deterministic verification.

See `ARCHITECTURE_READINESS_AUDIT.md` before treating the deployment as production-accurate.
