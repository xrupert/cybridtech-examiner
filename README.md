# Cybrid Title

Evidence-first title QC, curative analysis, and client data export built around one governing contract:

`INGEST → EXTRACT → CLASSIFY → CHECK → GROUND → RENDER → RECORD`

The shorter product doctrine is **EXTRACT → CHECK → GROUND → RENDER, every time, in that order**.

## Current user journeys

### Batch QC / Single Review

A complete title-report packet goes in. Cybrid Title:

1. identifies the exact packet by SHA-256;
2. extracts page-addressable native PDF text when coverage is reliable;
3. renders only low-text/non-native pages and runs a bounded page OCR recovery chain: TurboOCR when a trusted GPU endpoint is configured, then local Tesseract when available, then OpenAI page vision as the final page-level recovery provider;
4. falls back to whole-PDF OpenAI vision only when one or more nonblank pages remain unresolved after page recovery;
5. auto-detects state and the supported order profile from opening title-summary pages when possible;
6. identifies a functional Run Sheet/title-summary section by structure, not only by literal label;
7. applies the loaded VERA/RCS/Quick Reference/Legal Description rules;
8. runs one GPT-5.6 Sol forensic review pass over the page-addressable extraction ledger;
9. applies the deterministic server critic/evidence gate;
10. projects grounded exceptions into QC/curative readiness;
11. renders the review plus configurable CSV/JSON data export;
12. stores a private review receipt.

The current Review fast path is deliberately **page extraction/recovery → one structured Sol extraction/check path → deterministic server critic**, not two blind full-PDF AI passes.

### Build Run Sheet

Source title documents can be uploaded to build an evidence-backed Run Sheet. The current Build implementation performs two independent OpenAI builds and reconciles them into `VERIFIED` / `REVIEW` rows. This direction still needs to be brought fully onto the same extraction-ledger architecture before multi-client production use.

## Supported order/QC profiles

- Foreclosure
- 2nd Lien
- Current Owner Search
- Two Owner Search — current Ncala/demo profile supplied by the owner; not represented as an authoritative RCS rule pack

`2nd Lien Limited` is not treated as a normal VERA report because the supplied RCS instructions specify a spreadsheet workflow. Elite requirements supplied so far are Tennessee-specific and are not presented as universal.

## Evidence doctrine

- reset context for each packet;
- no assumptions or inferred negatives;
- supported PASS/FAIL requires a source quote, physical PDF page, and document type;
- referenced but unavailable comparison documents become `CANNOT_CONFIRM`;
- Run Sheet review is bidirectional: summary → source documents and source documents → summary;
- an unlabeled front title-search summary may function as the Run Sheet;
- MERS + MIN does not create an assignment requirement by itself;
- state-law dependencies are not invented when no authoritative state rule is loaded;
- Q4–Q12 and Q17–Q20 control the automated critical verdict.

The page extraction ledger now records native/OCR source, confidence, provider attempts, blank pages, unresolved pages, and quote-to-page verification. Native and OCR-backed page text can therefore be checked independently before downstream conclusions are treated as grounded. Whole-PDF vision remains a last-resort compatibility path and does not receive the same independent page-text verification guarantee.

## OCR provider strategy

The OCR layer is intentionally provider-agnostic and fail-closed:

`native PDF text → TurboOCR (if configured) → Tesseract CLI (if available) → OpenAI page vision → whole-PDF OpenAI vision only if still unresolved`

TurboOCR is best used as a separately hosted, private Linux/NVIDIA service. Tesseract is the local/on-prem CPU fallback. OpenAI page vision keeps the deployed Vercel path functional when neither local OCR provider is available. Semantica was evaluated for this work, but it is not an OCR engine and is not added as a Python runtime dependency to the Next.js application; its provenance/traceability ideas are represented in the versioned per-page extraction ledger instead.

Optional environment variables:

```bash
# Private TurboOCR service, e.g. your own GPU host
TURBOOCR_URL=https://your-private-ocr-host
TURBOOCR_API_KEY=optional

# Local/on-prem Tesseract 5 CLI
TESSERACT_CMD=tesseract
TESSERACT_LANG=eng
TESSERACT_PSM=3

# Provider order and guardrails
CYBRID_PAGE_OCR_ORDER=turboocr,tesseract,openai-page-vision
CYBRID_OCR_RENDER_SCALE=2.75
CYBRID_OCR_CONCURRENCY=2
CYBRID_MAX_OCR_PAGES=80
CYBRID_PAGE_OCR_TIMEOUT_MS=45000
CYBRID_PAGE_OCR_MIN_CHARS=32
CYBRID_PAGE_OCR_MIN_CONFIDENCE=0.50
```

No external TurboOCR service is called unless `TURBOOCR_URL` is explicitly configured. If the Tesseract executable is unavailable, the process marks it unavailable after the first failed launch and continues to page vision rather than repeatedly failing every page.

## Packet / matter / review identity

These are separate:

- `packetHash` — SHA-256 of the exact bytes; the only extraction-cache identity.
- `matterKey` — opaque related-matter identity derived after review.
- `reviewId` — fresh UUID for every completed review.

A later report for the same address/order/parcel is a new packet whenever its bytes differ. Old documentary content is never reused merely because property identity matches.

## Ncala demo data flow

The workbench can process one report or a batch and produce a canonical demo title record containing order/matter fields, borrower, property, target-lien fields, QC status, foreclosure readiness, curative issues, packet identity, and review identity.

The default Ncala export includes:

- TS Number
- Borrower Name
- Property Address
- Lien Position
- QC Status
- Foreclosure Readiness
- Curative Issues

Additional CSV/JSON columns can be toggled without changing the review engine. A client's eventual import file or API contract is an adapter over the canonical record, not the database schema.

## Architecture / harness

The architecture work adds:

- explicit legal pipeline transitions;
- deterministic architecture regression harness;
- deterministic OCR routing/TSV parsing harness;
- CI build gate;
- an architecture readiness audit with RED/YELLOW/GREEN findings.

Run:

```bash
npm install
npm run verify
npm run typecheck
npm run build
```

Build success proves code-level contracts, **not title accuracy**. Production accuracy requires a secure human-reviewed golden packet corpus, including image-heavy/scanned packets.

## Environment

The existing deployment accepts `OPEN_AI_KEY` as an alias for `OPENAI_API_KEY`.

```bash
OPEN_AI_KEY=...
BLOB_READ_WRITE_TOKEN=...
```

Testing currently uses the intentional examiner-auth bypass. Real user/tenant/admin authentication is required before customer production launch.

Large title packets use private Vercel Blob direct upload so they do not traverse Vercel's small request-body path.

## Current architecture status

Do not use this README as a claim that every production-hardening item is complete. The authoritative readiness checklist is:

`docs/ARCHITECTURE_READINESS_AUDIT.md`
