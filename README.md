# CybridTech Examiner

Evidence-first non-insured title workbench with two directions built on one source-preserving document engine.

## MVP modes

### 1. Review Existing Title Report

One complete title-report / Run Sheet packet goes in. The Examiner reads the packet multimodally, applies the loaded VERA v3 structure and selected RCS order-type requirements, runs two independent passes, enforces evidence server-side, and presents the findings for human approval, override, or needs-review disposition.

Output:

- VERA v3 review structure
- exact quote + physical PDF page evidence
- critical Q4–Q12 and Q17–Q20 verdict logic
- examiner decisions preserved separately from the AI finding
- genuine `.docx` export plus printable PDF view

### 2. Build Run Sheet From Documents

One or more recorded title documents go in. The Examiner classifies each supplied document, extracts recording facts with source evidence, builds Run Sheet rows, then independently rereads the entire packet and reconciles the two builds.

Output:

- evidence-backed Run Sheet rows
- `VERIFIED` or `REVIEW` state per row
- editable extracted values
- selected RCS requirements that still require examiner review
- CSV export

The exact customer/RCS production Run Sheet column mapping can be substituted once a representative production sheet is supplied; the evidence model and verification flow remain the same.

## Supported MVP search types

The current authoritative RCS source supplied by the owner is encoded for:

- Foreclosure
- 2nd Lien
- Current Owner Search

`2nd Lien Limited` is intentionally not treated as a VERA report because the supplied RCS instructions specify a spreadsheet workflow. Elite requirements supplied so far are Tennessee-specific and are not presented as a universal search type.

## Evidence rules

- reset context for each packet; use only supplied evidence and loaded rules
- no assumptions or inferred negatives
- every supported PASS or FAIL must carry usable quoted packet evidence and a physical page
- referenced but unavailable comparison documents become `CANNOT_CONFIRM`
- MERS + MIN does not create an assignment requirement by itself
- HOA requirements depend on reference/applicability and selected RCS order type
- Run Sheet review is bidirectional: Run Sheet → packet and packet → Run Sheet
- independent-pass disagreements require review rather than silent resolution
- human overrides do not overwrite the original AI finding
- Q4–Q12 and Q17–Q20 are the critical verdict questions

The server, not merely the model prompt, rejects supported PASS/FAIL findings that lack usable evidence.

## Legal Description Compliance Protocol

The owner-supplied protocol is loaded and applies whenever legal-description validation is required. It requires the Examiner to:

- parse and preserve every metes-and-bounds THENCE call
- preserve directions, degrees, minutes, seconds, distances, punctuation, decimal notation, and standard symbols
- compare referenced source instruments line-by-line and word-for-word when an instrument number is cited
- identify omitted or altered calls, landmarks, bearings, directions, and measurements
- verify call sequence and logical return to the Place of Beginning
- classify material, formatting, and typographical discrepancies
- use `CANNOT_CONFIRM` when a required referenced source instrument cannot be inspected

The system does not invent state mandates. When a checklist item depends on state law and no authoritative state rule has been loaded for that issue, the dependency is left for manual verification rather than converted to an unsupported PASS/FAIL.

## Model and cost policy

OpenAI is the document-reading and reasoning provider. Azure Document Intelligence is not required.

The normal path uses:

```bash
OPENAI_DOCUMENT_MODEL=gpt-5.6-luna
OPENAI_VERIFY_MODEL=gpt-5.6-luna
```

The API forces GPT-5.6 Luna unless premium use is deliberately unlocked with:

```bash
OPENAI_ALLOW_PREMIUM_MODEL=true
```

There is no automatic Terra/Sol escalation.

## Required production environment

```bash
OPENAI_API_KEY=...
EXAMINER_ACCESS_CODE=...
```

`EXAMINER_ACCESS_CODE` is checked server-side before any paid AI processing or VERA DOCX export. This prevents a public deployment from becoming an unauthenticated OpenAI-spend endpoint.

### Large title packets

Vercel Functions have a request-body limit that is too small for many real title packets. For production-sized PDFs, create a **private Vercel Blob store** for the project. Vercel then supplies:

```bash
BLOB_READ_WRITE_TOKEN=...
```

The browser uploads large title packets directly to the private Blob store, the server reads the private object for processing, and the temporary Blob object is deleted after ingestion. Small files can still use the direct request path.

## Authoritative rule-pack status

Loaded:

- VERA Template v3 supplied by the owner
- RCS Title Search Requirements by order type supplied by the owner
- recovered owner no-assumption/evidence audit doctrine
- `Title Report Forensic Audit – Quick Reference Checklist.docx`
- `Title Report Legal Description Compliance Protocol.docx`

The loaded rule version is `CYBRID-VERA3-RCS-QRC-LDP-2026-08-28`.

## Local

```bash
npm install
npm run dev
```

Open `/examine`.
