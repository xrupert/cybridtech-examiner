# Production Setup

The code fails closed until the paid AI endpoint and access protection are configured.

## Required

In the Vercel project environment, configure:

```bash
OPENAI_API_KEY=...
EXAMINER_ACCESS_CODE=...
```

Do not commit either value to GitHub.

## Large title packets

Create a **private Vercel Blob store** attached to the project. Vercel supplies the project environment credential used by the upload code:

```bash
BLOB_READ_WRITE_TOKEN=...
```

Without Blob storage the UI deliberately limits direct uploads to small files because Vercel Functions have a request-body limit that many title packets exceed.

## Model defaults

No additional model setting is required. The application forces the cost-controlled default unless premium usage is deliberately enabled:

```bash
OPENAI_DOCUMENT_MODEL=gpt-5.6-luna
OPENAI_VERIFY_MODEL=gpt-5.6-luna
```

Do not enable `OPENAI_ALLOW_PREMIUM_MODEL=true` for the normal production path.

## Readiness

Check:

- `GET /api/examine`
- `GET /api/run-sheet`

Before real testing they should report:

- `openAIConfigured: true`
- `accessProtectionConfigured: true`
- `largeFileStorageConfigured: true` for production-sized packets
- model `gpt-5.6-luna`
- `verificationPasses: 2`

A READY Vercel deployment does not prove the AI workflow is configured; these readiness fields do.
