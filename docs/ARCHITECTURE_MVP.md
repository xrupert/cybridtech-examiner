# MVP Architecture

One evidence engine supports two user journeys.

## Review direction

`Title report / Run Sheet packet → OpenAI document read → independent verification → server evidence gate → VERA 1–20 → examiner approve/override → DOCX/PDF`

## Build direction

`Recorded title documents → OpenAI document classification/extraction → independent rebuild → deterministic reconciliation → examiner review → Run Sheet CSV`

## Shared stable layer

Both directions use the same documentary facts and provenance:

- source filename
- physical page
- verbatim quote
- document/instrument type
- instrument number where stated
- dates
- parties
- amounts
- book/page
- legal-description identifiers

The application should not add specialized OCR, large agent teams, multi-tenant billing, or other platform complexity until representative corpus testing demonstrates a concrete need. Large-file transport is infrastructure, not a new examination engine.
