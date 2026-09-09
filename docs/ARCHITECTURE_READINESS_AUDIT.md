# Cybrid Title Architecture Readiness Audit

**Audit branch:** `feature/page-ocr-provenance`  
**Baseline:** production/main `2952a173b3bce39611b6e469ce766363885b5f5b`  
**Purpose:** determine whether Cybrid Title is architecturally ready for another real-packet acceptance test.

## Canonical processing contract

The product contract is:

`INGEST → EXTRACT → CLASSIFY → CHECK → GROUND → RENDER → RECORD`

The shorter evidence doctrine remains:

`EXTRACT → CHECK → GROUND → RENDER. Every time. In that order.`

A stage may fail closed. It may not skip forward. Rendering has no authority to invent or reinterpret documentary facts.

## Executive verdict

**OCR architecture is materially improved, but production title accuracy still requires the secure golden-packet acceptance layer.**

The page extraction path no longer jumps directly from weak native text to a whole-PDF vision pass. Low-text pages are recovered individually, their source and confidence are recorded, and extracted evidence can be checked back against the recovered physical page text. Whole-PDF vision remains only as a final compatibility fallback when a nonblank page remains unresolved.

This closes the earlier architectural gap around bounded scanned-page recovery. It does **not** prove title accuracy on real scanned instruments. The scanned/image-heavy golden corpus remains mandatory before changing that claim.

## Component status

| Area | Status | Current implementation | Required disposition |
| --- | --- | --- | --- |
| Packet ingest / large files | GREEN | Private Vercel Blob upload for production-sized packets; one packet per review job | Keep |
| Exact packet identity | GREEN | SHA-256 of exact bytes; cache only by packet hash | Keep |
| Repeat-property identity | YELLOW | Related reviews are linked by opaque order/parcel/address indexes | Scope identity by client/tenant before multi-client production |
| Native text extraction | GREEN | pdf.js page-addressable extraction with physical page numbers | Keep |
| Scanned-page OCR | GREEN/YELLOW | Low-text pages are rendered individually and routed through TurboOCR when configured, local Tesseract when available, then OpenAI page vision; whole-PDF vision is last resort | Run the scanned golden-packet corpus; deploy TurboOCR only on trusted private GPU infrastructure if used |
| OCR provenance | GREEN/YELLOW | Versioned extraction ledger records page text source, provider attempts, confidence, blank/unresolved state, recovery pages, and provider set | Persist aggregate OCR timing/cost metrics in review receipts |
| Extraction cache | GREEN | Private Blob ledger keyed only by exact packet hash; OCR schema uses a new cache version | Keep |
| Functional Run Sheet detection | GREEN/YELLOW | Structural + label-based detection of opening title-summary pages after page recovery | Add real-packet regression cases; current heuristics intentionally fail closed when ambiguous |
| State auto-detection | GREEN/YELLOW | Opening summary text, state labels/names, state+ZIP patterns; no manual state required for Review | Add state fixtures and fail closed when not established |
| Order-profile auto-detection | GREEN/YELLOW | Current Owner, Two Owner, 2nd Lien, Foreclosure from opening summary text | Real-packet corpus still required |
| Review CHECK stage | YELLOW | Documentary extraction is separated from QC; one semantic checker pass follows canonical normalization | Continue expanding deterministic comparisons so fewer questions require semantic resolution |
| Grounding | YELLOW | Server requires nonempty quote + physical page + document type; native and recovered OCR page text can verify quotes independently | Whole-PDF vision evidence still lacks an independent recovered-page verification guarantee and should remain fallback-only |
| Reducer / critic | GREEN/YELLOW | Fail-closed evidence gate, Q1-Q20 structure, critical verdict, Run Sheet applicability/roll-up | Expand deterministic field comparisons and enforce text-verified evidence for selected high-risk checks after golden validation |
| Legal-description verification | YELLOW | Strong governing protocol in rules/prompt; evidence-gated model comparison | No deterministic parser/closure engine yet |
| Canonical title record | YELLOW | Canonical instruments/parties/taxes/liens/releases/assignments feed QC and exports | Continue hardening normalization with golden cases |
| Borrower normalization | YELLOW | Canonical extraction rules prohibit substituting current owner for borrower without explicit support | Add targeted regression fixtures for ambiguous vesting/borrower cases |
| Target lien selection | GREEN/YELLOW | Multiple mortgages require examiner selection; lien position stays Needs Review unless established | Persist examiner choice server-side before production integration |
| Curative classification | YELLOW | Deterministic mapping from VERA exception numbers to blocking/review/QC issue codes | Needs client-specific curative rule packs and golden cases |
| Batch QC | YELLOW | Browser orchestrates independent review jobs sequentially | Fine for demo; durable server job/batch manifest required for production volume/resume |
| Human exception loop | YELLOW | Examiner decision controls exist but still require broader production workflow hardening | Persist complete examiner dispositions and unresolved-evidence states |
| VERA DOCX | GREEN/YELLOW | Genuine DOCX export; understands reviewer overrides if present | Block/label final export appropriately when examiner dispositions remain unresolved |
| CSV / JSON export | GREEN/YELLOW | Configurable columns from canonical record | Add saved per-client mappings and validation of unresolved required export fields |
| Review receipts | GREEN/YELLOW | Private receipt with hash/review/matter/revision/rule/model/timing | Add tenant/client scope plus token/cost and OCR provider metrics |
| Admin metrics | YELLOW | Aggregate receipt metrics endpoint | Real admin authentication/role protection before production |
| Authentication | DEMO ONLY | Testing bypass intentionally active | Real user/tenant/admin authentication before customer launch |
| Runtime graph engineering | YELLOW | Explicit legal transition graph runs through the canonical pipeline | Correlate transition trace with durable observability/receipts |
| Harness engineering | YELLOW | Deterministic architecture harness plus OCR provider/TSV routing harness run before every build | Add secure human-reviewed golden packet corpus; proprietary packets must not be committed to public repo |
| CI | GREEN/YELLOW | PR/main CI runs harness, typecheck, production build | Add real-packet eval job using secure fixtures |
| Loop engineering | GREEN/YELLOW | OCR escalation is bounded by provider order, per-provider timeout, page cap, and fail-closed fallback; provider failures do not create blind retry loops | Add durable job retry only at the packet/job orchestration layer |
| Graph/data lineage | YELLOW | Packet → page extraction source → evidence node → canonical record → review relationship is explicit enough for audit/debugging | Future Semantica/graph-store integration may consume this ledger, but should not replace the canonical source-of-truth model |
| Observability | GREEN/YELLOW | extraction/search type/state/model/usage/OCR source logs and review receipts | Add one correlation ID/pipeline trace and persistent token/cost/OCR timing fields |
| Documentation truthfulness | GREEN/YELLOW | README describes page OCR escalation and explicitly limits production-accuracy claims | Keep docs synchronized with deployment configuration and golden-corpus status |

## OCR design decision

Three candidate repositories were evaluated for this hardening work:

1. **Tesseract** is used through the standard Tesseract 5 CLI contract as the deterministic local/on-prem CPU OCR fallback. It is a strong fit for controlled environments and does not require document egress.
2. **TurboOCR** is supported as the preferred high-throughput OCR service when a trusted private Linux/NVIDIA endpoint is configured. It is not embedded into the Vercel function because its CUDA/TensorRT runtime does not match the serverless deployment model.
3. **Semantica** is not an OCR engine and is Python-native. Adding it directly to the Next.js request path would create a second runtime without improving page transcription. Its useful idea here is provenance: the extraction ledger now records which engine produced each page, which attempts failed, and whether downstream evidence quotes can be found in that recovered page text.

The production-safe escalation contract is therefore:

`native PDF text → TurboOCR (configured only) → Tesseract CLI (available only) → OpenAI page vision → whole-PDF OpenAI vision only if unresolved`

The important architectural property is not the vendor order by itself. It is that **physical pages remain the unit of recovery and provenance**, while semantic title extraction remains a separate downstream stage.

## Architecture principles locked by this audit

1. **No giant-agent architecture.** AI is a bounded document reader/reasoner; deterministic software owns identity, state transitions, evidence gates, reconciliation, output schemas, and fail-closed behavior.
2. **One source of documentary truth.** The canonical evidence record represents instruments/facts once and serves Review, Build Run Sheet, curative analysis, export, admin, and future API integrations.
3. **Exact bytes define a packet.** Property, order number, address, or parcel may link history but may never be used to reuse documentary content.
4. **Physical page is the OCR recovery unit.** A bad page is recovered as a page, not by discarding the rest of the extraction ledger and treating the entire packet as one opaque image input.
5. **Run Sheet is functional, not label-dependent.** Front title-summary pages can be the Run Sheet inside a combined PDF and must be reconciled bidirectionally to supporting documents.
6. **No silent inference.** Unknown borrower, lien position, state, order profile, missing source, or ungrounded conclusion remains Needs Review / Cannot Confirm.
7. **Human review is exception-based.** Clean PASS/N/A findings may collapse; unresolved or consequential exceptions require an explicit disposition.
8. **Client export is an adapter, never the database schema.** CSV, JSON, API, webhook, or future SFTP mappings are views over the canonical record.
9. **Harness before confidence.** Architecture compile success is not title accuracy. A human-reviewed, secure golden corpus is required before making production-accuracy claims.

## Current automated architecture harness

The automated checks run without network/model calls and cover:

- legal pipeline graph order and illegal-stage skips
- functional Run Sheet detection
- fail-closed evidence reducer behavior
- curative projection for assignment-chain failure
- all four supported order-profile detectors
- CSV escaping/export contract
- VERA 20-question and critical-question shape
- OCR provider-order parsing and deduplication
- Tesseract TSV line reconstruction and normalized confidence
- OCR acceptance thresholds for short or low-confidence text

The build is gated by these harnesses plus TypeScript validation and the Next.js production build.

## Golden packet acceptance gate still required

The secure eval corpus must cover at least:

- clean packet
- scanned/image-heavy packet with mixed native/scanned pages
- fully scanned packet
- rotated/poor-quality recorded instrument
- blank/separator pages inside a scanned packet
- OCR failure that must fall back to page vision
- functional unlabeled Run Sheet
- missing referenced instrument
- extra source instrument omitted from Run Sheet
- assignment/vesting gap
- MERS + MIN case
- legal-description discrepancy
- HOA/CC&R case
- Foreclosure
- 2nd Lien
- Current Owner through qualifying FVD/PMM
- Two Owner
- repeated property/order with changed packet bytes
- same exact packet re-reviewed under a later rule version
- multiple mortgages requiring target-lien selection
- mixed-state/mixed-order batch

For each golden packet, expected state/order profile, Run Sheet page range, key normalized fields, Q1-Q20 statuses, curative issues, export values, OCR-recovered page set, and any manual-review pages must be independently established by a human reviewer.

## Merge gate

A passing build is necessary but not sufficient. Merge only after CI is green and the implementation behavior has been reviewed. Treat the scanned golden-packet corpus as the next acceptance layer before making any production-accuracy claim.
