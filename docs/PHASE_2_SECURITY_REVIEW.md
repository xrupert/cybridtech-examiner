# Phase 2: security and correctness

Reviewed base: a6dfc4129d548f797d3a7619ef2e93c181852ab6 (main).

## Intended result

One isolated deployment per client, with the VeraTitle workflow, reliable 50–1,000+ page packet processing, physical-page evidence, structured JSON and reports, attributable examiner decisions, persistent source documents, and grounded Ask Vera answers. Unreadable pages must preserve readable neighbors and require manual review without creating a substantive title defect. This phase does not certify legal accuracy or deployment compliance.

## Findings addressed in this branch

| Severity | Finding | Change |
| --- | --- | --- |
| Critical | Authentication allowed access when configuration was missing; UI supplied no credentials. | Default deny; bypass restricted to explicit local development outside compliance mode and Vercel. An access screen and in-memory credential helper now cover review, upload, batch, decision and chat requests. |
| Critical | Examination accepted arbitrary private Blob paths and deleted them even after failure. | Server-issued, signed, client-scoped PDF paths validated before upload authorization and storage reads. Automatic deletion removed. Upload size capped at 500 MiB. This provides client-level authorization, not individual ownership. |
| High | Unreadable-only FAIL and mixed readable/unreadable citations retained conclusive outcomes. | Conclusions citing unresolved pages become Cannot Confirm. A separately grounded defect on readable pages remains FAIL. |
| High | Examiner decision reduction removed document-integrity holds. | The hold survives individual check corrections; a dedicated page-resolution workflow is still needed to release it. |
| High | Presentation and receipts converted unresolved review into Fail. | Reports and receipts distinguish Needs review from confirmed failure. |
| High | OCR upstream exceptions bypassed local fallback; one page exception aborted the PDF loop. | Upstream transport/parse failure falls back to local OCR; per-page failures produce explicit unresolved entries and continue. Tesseract calls have a 30-second per-attempt timeout. |
| High | OCR gateway had an authentication bypass when its key was absent. | Missing gateway key returns unavailable; incorrect key denied using constant-time comparison. |
| High | Missing dossier persistence could still yield COMPLETE. | Compliance mode requires private storage, stores the exact source PDF before processing, links its path in the dossier, and raises on receipt/dossier write failure. |
| High | Batch/decision/receipt namespaces were global. | Paths use the configured client namespace. Decision reads and writes require a dossier in that client; writes require a known check. |
| High | Request JSON could spoof examiner identity. | Client-supplied actor is ignored; current shared-code identity is explicitly marked unverified. This is not a replacement for individual login. |
| High | Public scanned-regression GET could trigger model work. | Disabled by default and authenticated when enabled. |

## Release blockers still open

1. **Individual identity and roles:** replace the shared access code with authenticated sessions/SSO, server-derived user IDs, revocation and role checks. Add distributed rate limits to login, upload, OCR and paid model routes. No claim of client compliance is made with shared credentials.
2. **Durable jobs and atomic persistence:** batch and decision manifests still use read/modify/overwrite; concurrent updates can be lost. Decision history currently replaces earlier decisions for the same check. Use transactional storage and append-only events. The examination still runs within one HTTP request; shard exceptions abort aggregation.
3. **Evidence and release correctness:** build explicit page-resolution events and a server-side reviewed-output/export path. Current client-side decisions do not update Ask Vera's persisted original dossier. Quote matching establishes textual presence, not that an answer follows from the evidence; adversarial and domain-expert evaluations are required.
4. **OCR execution limits:** native OCR still runs synchronously within async endpoints, request bodies are read before length checks, and rendered pixel dimensions are not bounded. Per-call timeout does not establish a total job time/memory budget. These require worker isolation, admission limits and stress tests.
5. **Runtime validation:** decision and batch enum checks are improved, but API bodies and provider responses still contain TypeScript casts rather than complete runtime schemas. Bound all arrays/strings and reject invalid IDs, statuses and transitions consistently.
6. **Deployment parity:** Lovable, Vercel, Railway, external OCR configuration and real storage behavior have not been verified in this phase. Repository changes do not establish that the live applications have changed. No representative 1,000+ page packet or live model evaluation was run.

## Rollout requirements

- Set a strong EXAMINER_ACCESS_CODE before deploying this branch. EXAMINER_REQUIRE_ACCESS_CODE=false no longer bypasses deployed authentication. Local bypass requires NODE_ENV=development and no VERCEL/compliance mode.
- Configure VERA_OCR_API_KEY on the OCR service and the matching caller credential before using it.
- Dedicated instances require stable VERA_CLIENT_ID, VERA_CLIENT_NAME, VERA_COMPLIANCE_MODE=1 and their own private storage credentials. Client naming settings alone do not provision isolated infrastructure.
- Existing global batch, decision, receipt and history-index objects need an explicit, verified per-client migration before users depend on old history. This branch does not copy or delete existing data, and deliberately does not fall back to unscoped objects.
- Old upload paths must be reissued through /api/upload-intents. Signing depends on the Blob token; rotating it invalidates pending signed upload paths.
- Source uploads are retained. Establish retention/deletion and storage-cost policies before broad rollout. Compliance-mode source copies use unique paths and preserve their locator in the dossier.
- Keep this change in draft until live storage/auth/OCR acceptance and migration are complete.

## Validation

- Added a deterministic 20-check security/correctness harness covering default denial, explicit local bypass, protected acceptance routing, signed upload rejection cases, unreadable-page outcomes and hold preservation after examiner correction.
- Existing OCR routing, unified engine, architecture (23 cases), lien, owner fallback, inversion and examiner workflow harnesses passed locally. The previously omitted report-output harness is now in the verification gate and passed.
- TypeScript validation and a production Next build passed during implementation; final checks are recorded in the PR.
- Python OCR source passed syntax compilation only. Native OCR behavior and remote API compatibility require integration testing.
- The tsx CLI cannot create its IPC socket in this workspace. Equivalent tests were executed with `node --import tsx <script>`; no test was skipped because of that launcher restriction.

Phase 3 should focus on durable jobs, concurrent writes, worker/resource limits and performance measurements, retaining these security requirements.
