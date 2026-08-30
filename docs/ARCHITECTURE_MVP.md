# Cybrid Title Architecture

One evidence-oriented product supports three surfaces: Review, Batch QC/Curative Export, and Build Run Sheet.

## Governing process

`INGEST → EXTRACT → CLASSIFY → CHECK → GROUND → RENDER → RECORD`

No stage may invent information on behalf of an earlier stage. Rendering formats an already-grounded result.

## Review / Batch direction

`Complete title packet → exact-byte identity → native extraction or current PDF/vision fallback → state/order/Run Sheet classification → VERA/RCS check → deterministic evidence critic → QC/curative projection → examiner exceptions → VERA + CSV/JSON → private receipt`

The current fast review uses **one GPT-5.6 Sol full-packet pass plus deterministic server validation**. It intentionally does not run two complete PDF model passes because that architecture caused excessive latency and API rate pressure.

## Build Run Sheet direction

Current implementation:

`Recorded title documents → two independent OpenAI builds → deterministic row reconciliation → examiner review → Run Sheet CSV`

Target architecture:

`Recorded documents → same extraction/evidence ledger used by Review → normalized instrument facts → independent verification/reconciliation only where needed → examiner review → Run Sheet CSV`

Build Run Sheet is therefore functional but not yet fully converged onto the shared extraction-ledger architecture.

## Shared stable data layer

Every documentary fact should ultimately retain:

- exact packet hash
- source filename
- physical page
- verbatim source text / quote
- document/instrument type
- instrument number where stated
- document/recording dates
- parties and roles
- amounts
- book/page
- legal-description identifiers/text
- confidence/extraction method when applicable

The current canonical Ncala export record is a smaller projection over the completed review, not yet the complete long-term instrument/evidence graph.

## Identity model

- **Packet identity:** exact SHA-256 bytes. Only this can reuse extraction.
- **Matter identity:** links related reviews by opaque order/parcel/address-derived keys; never makes old packet content current evidence.
- **Review identity:** fresh UUID on every completed review.

Before multi-client production, matter identity must also be tenant/client scoped.

## OCR / scan policy

Current behavior is native PDF text first, with whole-PDF OpenAI vision fallback when native coverage is insufficient. A dedicated page-level OCR ledger (for example local OCR or selective vision extraction) is **not yet implemented** and must not be described as complete.

## Reducer / grounding

The deterministic critic currently:

- enforces Q1-Q20 structure;
- rejects PASS/FAIL without quote + physical page + document type;
- normalizes functional Run Sheet applicability;
- rolls Q20 up from source-reconciliation questions;
- recomputes the critical verdict.

It does not yet independently prove every model quote against the cited source page for vision-fallback evidence. Native quote-to-page validation is a required hardening step.

## Engineering harness

The architecture branch adds a legal transition graph, deterministic synthetic architecture harness, and CI gate. Those catch structural regressions but are not a substitute for a private human-reviewed golden title-packet corpus.

See `ARCHITECTURE_READINESS_AUDIT.md` for the current production-readiness status and merge gates.
