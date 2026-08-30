# Cybrid Title Architecture Readiness Audit

**Audit branch:** `architect/full-system-readiness`  
**Baseline:** production `1633a5c060d0750040b58de2702c060971ac8fed`  
**Purpose:** determine whether Cybrid Title is architecturally ready for another real-packet acceptance test.

## Canonical processing contract

The product contract is:

`INGEST → EXTRACT → CLASSIFY → CHECK → GROUND → RENDER → RECORD`

The shorter evidence doctrine remains:

`EXTRACT → CHECK → GROUND → RENDER. Every time. In that order.`

A stage may fail closed. It may not skip forward. Rendering has no authority to invent or reinterpret documentary facts.

## Executive verdict

**NOT YET architecture-green for production title accuracy.**

The core product spine exists and the current production build is materially closer to the intended design, but the audit found several places where documentation or UI language implied stronger guarantees than the implementation actually provides. The architecture branch adds an explicit pipeline graph, deterministic architecture harness, and CI gate so these contracts can no longer exist only as prose.

Another real title packet should not be treated as an architecture acceptance test until the RED items below are closed or deliberately accepted as demo limitations.

## Component status

| Area | Status | Current implementation | Required disposition |
| --- | --- | --- | --- |
| Packet ingest / large files | GREEN | Private Vercel Blob upload for production-sized packets; one packet per review job | Keep |
| Exact packet identity | GREEN | SHA-256 of exact bytes; cache only by packet hash | Keep |
| Repeat-property identity | YELLOW | Related reviews are linked by opaque order/parcel/address indexes | Scope identity by client/tenant before multi-client production |
| Native text extraction | GREEN | pdf.js page-addressable extraction with physical page numbers | Keep |
| Scanned-page OCR | RED | No Tesseract/local OCR layer; image-heavy packets fall back to whole-PDF OpenAI vision | Build a bounded OCR/vision extraction strategy or formally accept whole-PDF vision as demo fallback |
| Extraction cache | GREEN | Private Blob ledger keyed only by exact packet hash | Keep |
| Functional Run Sheet detection | GREEN/YELLOW | Structural + label-based detection of opening title-summary pages | Add real-packet regression cases; current heuristics are intentionally fail-closed when ambiguous |
| State auto-detection | GREEN/YELLOW | Opening summary text, state labels/names, state+ZIP patterns; no manual state required for Review | Add state fixtures and fail closed when not established |
| Order-profile auto-detection | GREEN/YELLOW | Current Owner, Two Owner, 2nd Lien, Foreclosure from opening summary text | Real-packet corpus still required |
| Review CHECK stage | YELLOW | One GPT-5.6 Sol full-packet audit with low reasoning; deterministic critic follows | Separate extraction and checking more cleanly for vision-fallback packets |
| Grounding | YELLOW/RED | Server requires nonempty quote + physical page + document type | Native-text quotes should be verified against the extracted cited page; vision evidence still lacks independent quote verification |
| Reducer / critic | GREEN/YELLOW | Fail-closed evidence gate, Q1-Q20 structure, critical verdict, Run Sheet applicability/roll-up | Expand deterministic field comparisons and quote verification |
| Legal-description verification | YELLOW | Strong governing protocol in rules/prompt; evidence-gated model comparison | No deterministic parser/closure engine yet |
| Canonical title record | YELLOW | Demo projection for order, borrower, property, target lien, QC/curative/export | Expand to canonical instruments/parties/taxes/liens/releases/assignments instead of deriving mostly from final findings |
| Borrower normalization | RED | Current fallback may use vesting grantee when explicit borrower is not normalized | Must return Needs Review rather than silently substituting owner for borrower |
| Target lien selection | GREEN/YELLOW | Multiple mortgages require examiner selection; lien position stays Needs Review unless established | Persist examiner choice server-side before production integration |
| Curative classification | YELLOW | Deterministic mapping from VERA exception numbers to blocking/review/QC issue codes | Needs client-specific curative rule packs and golden cases |
| Batch QC | YELLOW | Browser orchestrates independent review jobs sequentially | Fine for demo; durable server job/batch manifest required for production volume/resume |
| Human exception loop | RED | Current Ncala workbench displays exception queue but does not preserve the earlier Confirm / Correct / Need More Evidence workflow | Restore explicit examiner dispositions and persist them |
| VERA DOCX | GREEN/YELLOW | Genuine DOCX export; understands reviewer overrides if present | Block/label final export appropriately when examiner dispositions remain unresolved |
| CSV / JSON export | GREEN/YELLOW | Configurable columns from canonical demo record | Add saved per-client mappings and validation of unresolved required export fields |
| Review receipts | GREEN/YELLOW | Private receipt with hash/review/matter/revision/rule/model/timing | Add tenant/client scope plus token/cost metrics |
| Admin metrics | YELLOW | Aggregate receipt metrics endpoint | Real admin authentication/role protection before production |
| Authentication | DEMO ONLY | Testing bypass intentionally active | Real user/tenant/admin authentication before customer launch |
| Runtime graph engineering | NEW / YELLOW | Explicit legal transition graph now exists on architecture branch | Integrate graph transitions/correlation into runtime pipeline rather than leaving it as a test-only contract |
| Harness engineering | NEW / YELLOW | Deterministic synthetic architecture harness now runs before every build | Add secure human-reviewed golden packet corpus; proprietary packets must not be committed to public repo |
| CI | NEW / GREEN | PR/main CI runs harness, typecheck, production build | Add dependency lockfile and real-packet eval job using secure fixtures |
| Loop engineering | YELLOW | Provider retry + human exception concept exist; no durable bounded repair loop | Define failure-class routing: extraction → classification → check → ground → human; do not add blind agent loops |
| Graph/data lineage | YELLOW | Packet → review → matter relationship plus evidence references exist | Canonical instrument/evidence graph is not yet explicit enough for future client integrations |
| Observability | GREEN/YELLOW | extraction/search type/state/model/usage logs and review receipts | Add one correlation ID/pipeline trace and persistent token/cost fields |
| Documentation truthfulness | RED | README/old architecture/acceptance docs still describe two review passes/Luna/access-code assumptions that no longer match production | Reconcile docs before merge |

## Architecture principles locked by this audit

1. **No giant-agent architecture.** AI is a bounded document reader/reasoner; deterministic software owns identity, state transitions, evidence gates, reconciliation, output schemas, and fail-closed behavior.
2. **One source of documentary truth.** The long-term canonical evidence record must represent instruments/facts once and serve Review, Build Run Sheet, curative analysis, export, admin, and future API integrations.
3. **Exact bytes define a packet.** Property, order number, address, or parcel may link history but may never be used to reuse documentary content.
4. **Run Sheet is functional, not label-dependent.** Front title-summary pages can be the Run Sheet inside a combined PDF and must be reconciled bidirectionally to supporting documents.
5. **No silent inference.** Unknown borrower, lien position, state, order profile, missing source, or ungrounded conclusion remains Needs Review / Cannot Confirm.
6. **Human review is exception-based.** Clean PASS/N/A findings may collapse; unresolved or consequential exceptions require an explicit disposition.
7. **Client export is an adapter, never the database schema.** CSV, JSON, API, webhook, or future SFTP mappings are views over the canonical record.
8. **Harness before confidence.** Architecture compile success is not title accuracy. A human-reviewed, secure golden corpus is required before making production-accuracy claims.

## Current automated architecture harness

The architecture branch now checks, without network/model calls:

- legal pipeline graph order and illegal-stage skips
- functional Run Sheet detection
- fail-closed evidence reducer behavior
- curative projection for assignment-chain failure
- all four supported order-profile detectors
- CSV escaping/export contract
- VERA 20-question and critical-question shape

The build is gated by this harness plus TypeScript validation and the Next.js production build.

## Golden packet acceptance gate still required

The secure eval corpus must cover at least:

- clean packet
- scanned/image-heavy packet
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

For each golden packet, expected state/order profile, Run Sheet page range, key normalized fields, Q1-Q20 statuses, curative issues, and export values must be independently established by a human reviewer.

## Merge gate

Do **not** merge this readiness branch to `main` merely because it builds. Close the RED architecture items, run the deterministic harness, then use the real-packet corpus as the next acceptance layer.
