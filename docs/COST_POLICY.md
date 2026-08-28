# CybridTech Examiner AI Cost Policy

CybridTech Examiner is a high-volume document-audit workload. The default production model is GPT-5.6 Luna for both full-packet audit passes because OpenAI positions Luna for cost-sensitive, high-volume workloads.

## Guardrails

- Default full-packet model: `gpt-5.6-luna`
- Default independent verifier: `gpt-5.6-luna`
- No automatic GPT-5.6 Terra or Sol calls.
- Premium models are blocked unless `OPENAI_ALLOW_PREMIUM_MODEL=true` is explicitly set.
- The active model is exposed by the non-secret `/api/examine` readiness endpoint.
- Any future premium escalation must be targeted to disputed evidence/pages rather than re-reading an entire packet by default.

## Current OpenAI public API rates

As of 2026-08-28, GPT-5.6 Luna is listed at $0.20 per million input tokens, $0.02 per million cached input tokens, and $1.20 per million output tokens. Prompts over 272K input tokens are priced at 2x input and 1.5x output for the full request. Pricing can change, so production cost telemetry should be checked against the current OpenAI rate card before changing the model policy.
