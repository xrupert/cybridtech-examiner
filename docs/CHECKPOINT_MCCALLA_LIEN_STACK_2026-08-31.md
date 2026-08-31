# Cybrid Title — McCalla lien-stack checkpoint — 2026-08-31

## Product direction

Cybrid Title must keep order-type QC requirements separate from downstream foreclosure analysis. A Current Owner Search must not be failed for foreclosure-only document requirements, but the canonical record must still develop the lien stack and McCalla foreclosure data whenever the packet supports it.

## Implemented in PR #22

- Evidence-backed open lien stack.
- Lien amount developed from the selected/provisional security instrument, with matching title-summary amount as a grounded fallback.
- First-in-time recording chronology used as the baseline lien-position method.
- Priority confidence is downgraded when chronology alone is not reliable, including federal tax, mechanics/construction, HOA/association, UCC, same-day sequencing ambiguity, or other jurisdiction-specific priority exceptions.
- Senior and junior open interests are identified relative to the target lien.
- Foreclosure analysis is projected for every order without turning those downstream needs into false QC failures.
- McCalla export requires target lien amount, lien position, and priority basis and includes foreclosure cure/action output.
- Title report remains distinct from a Run Sheet / Abstractor Sheet.
- RCS Current Owner requirements remain scoped to Current Owner review.
- Deterministic architecture harness: 17/17 checks passed on the feature build before merge.

## Real-packet error found after merge

A real McCalla batch hit: `Vercel Blob: This blob already exists`.

Root cause: `lib/batch-manifest.ts` intentionally stores each batch manifest at one stable Blob pathname and then rewrites it as an item advances through QUEUED -> PROCESSING -> COMPLETE/ERROR. The Blob `put()` call used `addRandomSuffix: false` but did not set `allowOverwrite: true`, so the first manifest update could collide with the manifest created at batch start.

Required fix: add `allowOverwrite: true` to the batch-manifest `put()` options. This is a manifest persistence bug, not a PDF filename bug.

## Next acceptance steps

1. Merge the batch-manifest overwrite fix to main and confirm production deployment is READY.
2. Re-run one real McCalla packet in production.
3. Verify the batch progresses past PROCESSING without Blob collision.
4. Inspect output for target lien, amount, first-in-time position, priority basis/confidence, open lien stack, senior/junior interests, and foreclosure cure/action requirements.
5. Confirm Current Owner QC does not inherit false foreclosure-only defects while McCalla foreclosure data remains populated.
6. Inspect Vercel runtime logs for extraction mode, page count, model timing/tokens, and any provider/extraction warning.
7. Do not expand login/domain/billing/admin work until this real review is correct and understandable.

## Important edge case to verify

When historical mortgages exist but some are released, target-lien selection should be based on the open/unknown lien stack, not merely the total count of every historical mortgage in the packet. If only one mortgage/security lien remains open and there is no conflicting explicit target hint, the system should not create a false target-selection exception solely because released historical mortgages are present.
