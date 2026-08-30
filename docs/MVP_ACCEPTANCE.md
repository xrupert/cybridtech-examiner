# Cybrid Title Acceptance Standard

The product is not accepted because the UI renders, the model returns JSON, or a Vercel deployment is READY. Acceptance has three layers: architecture, deterministic regression, and human-reviewed title-packet evidence.

## A. Architecture gate

Before real-packet acceptance testing:

1. Build and typecheck pass.
2. Architecture harness passes.
3. Legal pipeline order remains `INGEST → EXTRACT → CLASSIFY → CHECK → GROUND → RENDER → RECORD`.
4. Exact packet bytes are hashed and only the exact packet hash can reuse extraction.
5. State/order auto-detection fails closed rather than inventing a profile.
6. Functional Run Sheet detection does not depend on the literal words `Run Sheet`.
7. Supported PASS/FAIL requires source evidence with physical page provenance.
8. A model result cannot bypass the deterministic critic.
9. Client export is produced from a normalized title record, not from ad-hoc prose scraping at export time.
10. Known architecture limitations are truthfully documented.

## B. Review Existing Title Report / Batch QC

1. Upload one real packet or a batch of independent packets.
2. Each packet is one independent review job.
3. State is auto-detected when reliable; no normal manual State entry is required.
4. Auto Detect identifies one supported profile from opening title-summary pages or returns an explicit manual-profile requirement.
5. The complete packet is read, including scans through the current PDF/vision fallback when native text is insufficient.
6. Exactly 20 VERA findings are returned.
7. Every supported PASS or FAIL contains a source quote, physical PDF page, and document type; the server rejects unsupported conclusions.
8. Critical Q4-Q12 and Q17-Q20 control the automated verdict.
9. RCS applicability is honored; for example, 2nd Lien is not failed for document-copy categories the supplied RCS instructions explicitly do not require.
10. A front title-search summary may function as the Run Sheet and must be checked bidirectionally against supporting instruments.
11. Curative, QC deficiency, Cannot Confirm, and Clear are kept distinct.
12. Multiple mortgages do not silently establish the foreclosure target lien.
13. CSV/JSON can export the selected grounded demo fields.
14. Examiner exception dispositions must be restored/persisted before production acceptance.
15. A genuine VERA v3 DOCX can be exported, with pending/unresolved findings clearly represented.

The current Review fast path is one GPT-5.6 Sol full-packet pass plus deterministic server critic. A second full-PDF model pass is **not** an acceptance requirement.

## C. Build Run Sheet From Documents

1. Upload one combined packet or multiple title-document files.
2. Every distinct supplied instrument is represented once unless evidence justifies otherwise.
3. Each row retains source filename, physical page, document type, and source quote.
4. Recording number, dates, parties, book/page, amount, status, and legal identifiers are never invented when absent.
5. Current implementation performs two independent builds and deterministically reconciles rows to `VERIFIED` / `REVIEW`.
6. Missing rows or field disagreements remain REVIEW.
7. Selected RCS requirements that cannot be established are shown for examiner review.
8. Run Sheet exports to CSV.
9. Before production acceptance, Build Run Sheet must converge onto the shared extraction/evidence-ledger architecture rather than remaining a separate full-document model pipeline.

## D. Fail-closed requirements

- Missing OpenAI configuration: paid processing does not run.
- Production-sized packet without private upload storage: explicit configuration error, not malformed JSON.
- Missing/ambiguous documentary evidence: Cannot Confirm / Needs Review rather than guess.
- Unknown state/order profile: no invented rule context.
- Multiple candidate foreclosure liens: examiner target selection required.
- Missing authoritative state-law rule: no fabricated state-law PASS/FAIL.
- Different packet bytes for same property/order: always new packet evidence.

Testing access bypass is currently intentional. Real customer production requires user/tenant/admin authentication; the testing bypass is not a production acceptance condition.

## E. Deterministic harness

The architecture harness must continuously verify:

- legal pipeline transitions;
- functional Run Sheet detection;
- fail-closed critic behavior;
- curative projection;
- supported order-profile detection;
- CSV export contract;
- VERA Q1-Q20 / critical-question shape.

CI runs the harness, TypeScript validation, and production build on pull requests and main pushes.

## F. Human-reviewed golden packet corpus

Before calling the product production-accurate, securely run representative packets covering at least:

- known clean packet
- scan/image-heavy packet
- unlabeled functional Run Sheet
- missing referenced instrument
- Run Sheet extra/missing source instrument
- assignment/vesting discrepancy
- legal-description discrepancy
- MERS + MIN
- HOA/CC&R
- Foreclosure
- 2nd Lien
- Current Owner reaching qualifying non-family FVD + PMM
- Two Owner
- multiple mortgages requiring target-lien selection
- mixed-state/mixed-order batch
- repeated property/order with changed packet bytes
- exact same packet re-reviewed under a later rule version

For each golden packet, a human reviewer must independently establish expected state/order profile, Run Sheet range, key normalized values, Q1-Q20 statuses, curative classification, and export values.

The acceptance bar is evidence correctness and examiner usefulness, not a marketing accuracy percentage.
