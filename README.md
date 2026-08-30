# Cybrid Title

Evidence-first title QC, curative analysis, and client data export built around one governing contract:

`INGEST → EXTRACT → CLASSIFY → CHECK → GROUND → RENDER → RECORD`

The shorter product doctrine is **EXTRACT → CHECK → GROUND → RENDER, every time, in that order**.

## Current user journeys

### Batch QC / Single Review

A complete title-report packet goes in. Cybrid Title:

1. identifies the exact packet by SHA-256;
2. extracts page-addressable native PDF text when coverage is reliable;
3. uses OpenAI PDF/vision as the current fallback for scan/image-heavy packets;
4. auto-detects state and the supported order profile from opening title-summary pages when possible;
5. identifies a functional Run Sheet/title-summary section by structure, not only by literal label;
6. applies the loaded VERA/RCS/Quick Reference/Legal Description rules;
7. runs one GPT-5.6 Sol forensic review pass;
8. applies the deterministic server critic/evidence gate;
9. projects grounded exceptions into QC/curative readiness;
10. renders the review plus configurable CSV/JSON data export;
11. stores a private review receipt.

The current Review fast path is deliberately **one full-packet Sol pass + deterministic server critic**, not two full-PDF AI passes.

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

The deterministic critic currently verifies evidence structure and fails unsupported PASS/FAIL closed. Native-text quote-to-page verification and a dedicated scanned-page OCR ledger remain architecture-hardening work; see `docs/ARCHITECTURE_READINESS_AUDIT.md`.

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

The `architect/full-system-readiness` work adds:

- explicit legal pipeline transitions;
- deterministic architecture regression harness;
- CI build gate;
- an architecture readiness audit with RED/YELLOW/GREEN findings.

Run:

```bash
npm install
npm run verify
npm run typecheck
npm run build
```

Build success proves code-level contracts, **not title accuracy**. Production accuracy requires a secure human-reviewed golden packet corpus.

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
