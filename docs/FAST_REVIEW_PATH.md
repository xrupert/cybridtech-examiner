# Fast review path

Cybrid Title review mode uses one full-packet GPT-5.6 Sol pass followed by the deterministic server evidence/structure critic.

Why: a 65-page packet was previously sent through two simultaneous full-PDF model passes. On a low API usage tier, that creates a large token burst and can trigger OpenAI TPM rate limits while also doubling work.

Current review path:

1. Upload source packet once.
2. One full-packet forensic model pass reads and cross-checks the complete packet.
3. The model internally self-checks critical PASS findings and proposed FAIL findings before returning.
4. The server critic rejects unsupported PASS/FAIL conclusions, enforces Q1-Q20 structure, recomputes critical verdict, and forces unsupported results to Cannot Confirm.
5. Human examiner reviews/approves/overrides findings.
6. Export VERA DOCX/PDF.

The model returns only cited/manual-review pages rather than an excerpt for every PDF page, reducing structured-output size without instructing the model to skip any source pages.

Production telemetry records model latency and token usage so the next real packet can be measured rather than guessed.
