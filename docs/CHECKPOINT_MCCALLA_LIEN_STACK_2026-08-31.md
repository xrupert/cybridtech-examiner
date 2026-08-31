# Cybrid Title — McCalla lien-stack checkpoint — 2026-08-31

## Current production state

Production: `https://cybridtech-examiner.vercel.app/examine`

PR #22 is merged to main. The McCalla lien-stack / foreclosure-analysis work is in production. The subsequent Vercel Blob batch-manifest collision fix is also on main at commit `096255bb1a18f55d309267b52123dab282643249` and its production deployment is READY (`dpl_BPUMbqqUqg3snuMyv7cKwv1524se`). The production build passed the deterministic architecture harness 17/17, compiled successfully, and passed Next.js type checking.

## Product direction

Cybrid Title keeps order-type QC requirements separate from downstream foreclosure analysis. A Current Owner Search must not be failed for foreclosure-only document requirements, but the canonical record must still develop the lien stack and McCalla foreclosure data whenever the packet supports it.

## Implemented

- Evidence-backed open lien stack.
- Lien amount developed from the selected/provisional security instrument, with matching title-summary amount as a grounded fallback.
- First-in-time recording chronology used as the baseline lien-position method.
- Priority confidence is downgraded when chronology alone is not reliable, including federal tax, mechanics/construction, HOA/association, UCC, same-day sequencing ambiguity, or other jurisdiction-specific priority exceptions.
- Senior and junior open interests are identified relative to the target lien.
- Foreclosure analysis is projected for every order without turning those downstream needs into false QC failures.
- McCalla export requires target lien amount, lien position, and priority basis and includes foreclosure cure/action output.
- Title report remains distinct from a Run Sheet / Abstractor Sheet.
- RCS Current Owner requirements remain scoped to Current Owner review.
- Historical released mortgages do not by themselves force a target-lien selection exception: target development uses the active/open lien stack so one surviving open mortgage can be used provisionally when appropriate.

## Vercel Blob error and fix

A real McCalla batch hit: `Vercel Blob: This blob already exists`.

Root cause was `lib/batch-manifest.ts`, not the uploaded PDF filename. Each batch manifest intentionally uses one stable Blob pathname and is rewritten as an item advances through `QUEUED -> PROCESSING -> COMPLETE/ERROR`. The Blob `put()` call used `addRandomSuffix: false` without permitting overwrite, so the first status update could collide with the manifest created at batch start.

Fix now in production: batch-manifest persistence uses `allowOverwrite: true` while retaining the stable pathname. This preserves one durable manifest per batch and allows status transitions to update it normally.

## Exact next acceptance step

Do not expand login, domain, billing, or admin work yet. Re-run one real McCalla title packet in production and then inspect the result and Vercel runtime logs.

Acceptance checks for that run:

1. Batch progresses through PROCESSING to COMPLETE without the Blob collision.
2. Target lien is correctly selected/developed from the active lien stack.
3. Target lien amount is grounded to packet evidence.
4. Lien position is developed using first-in-time recording chronology when reliable.
5. Priority basis and confidence are visible, with exception warnings rather than false certainty where tax/mechanics/HOA/UCC/same-day/state-law rules may alter priority.
6. Senior and junior open interests are identified relative to the target lien.
7. McCalla foreclosure cure/action output explains payoff/release/subordination/priority-review/notice/evidence needs as appropriate.
8. Current Owner QC does not inherit false foreclosure-only defects while the McCalla foreclosure data remains populated.
9. Run Sheet remains N/A unless an actual separate Run Sheet / Abstractor Sheet is supplied.
10. Inspect runtime logs for extraction mode, page count, model timing/tokens, and any extraction/provider warning.

If the real run is wrong or confusing, fix review accuracy and clarity before any broader product expansion.
