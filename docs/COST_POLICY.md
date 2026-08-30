# Cybrid Title AI Cost / Latency Policy

Cybrid Title is a high-volume document-audit workload. Cost controls must never create stale evidence or bypass required grounding, but the system also must not reread a complete title packet with multiple expensive model passes when deterministic software can do the verification.

## Review path

Current Review policy:

- full-packet model: `gpt-5.6-sol`
- full-packet AI passes: **1**
- reasoning effort: low
- deterministic server evidence/structure critic follows the model
- native PDF text is used when extraction coverage is reliable
- scan/image-heavy packets currently fall back to OpenAI PDF/vision
- no automatic second full-PDF verifier

This policy replaced the earlier two-full-pass design after real 65-page packets produced unacceptable latency and rate-limit pressure.

## Build Run Sheet path

Build Run Sheet is currently a separate implementation:

- model defaults to the Build route's cost-controlled model
- two independent complete builds are performed
- deterministic row reconciliation marks `VERIFIED` vs `REVIEW`

This path is an architecture convergence item because it does not yet reuse the same extraction/evidence ledger as Review and can therefore duplicate document-read cost.

## Guardrails

- Never retry a model call indefinitely.
- A repeated model answer is not new evidence.
- Prefer deterministic comparison for exact dates, amounts, instrument numbers, book/page, parties, and other normalized fields.
- Reuse extraction only for an exact SHA-256 packet match.
- Never reuse prior property/order content merely to save tokens.
- Do not perform premium/full-packet escalation automatically for an isolated uncertainty; target disputed evidence/pages when a future escalation path is added.
- Persist enough usage telemetry to calculate real per-client cost before setting production pricing.

## Pricing data

Do not hard-code external model prices in this repository as a lasting architecture assumption. Provider pricing changes. Billing/pricing decisions should use current provider rates plus persisted production token/usage telemetry.
