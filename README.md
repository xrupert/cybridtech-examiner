# CybridTech Examiner

Evidence-first forensic review workbench for non-insured title reports.

## Current engine

The production architecture uses the OpenAI Responses API directly for PDF and text review. PDFs are uploaded to OpenAI as temporary `user_data` files, analyzed multimodally (document text + page images), reviewed twice independently, reconciled conservatively, and then deleted from OpenAI after the audit request completes.

Core behavior:

- OpenAI multimodal PDF reading for native-text and scanned/image pages
- GPT-5.6 Sol by default (`gpt-5.6-sol`)
- two independent audit passes; status disagreements become `CANNOT_CONFIRM`
- exact quote + physical PDF page evidence for every supported finding
- 20 VERA audit questions with critical Q4–12 and Q17–20 driving the overall verdict
- no-assumption / evidence-first CybridTech audit doctrine
- MERS/MIN, HOA, legal-description, and bidirectional Run Sheet ↔ packet checks
- page/document inventory and extraction audit trail
- manual-review escalation when evidence is ambiguous or independent passes disagree
- branded CybridTech PDF/Word output with evidence attached
- batch upload, state, and search-type context

## Required environment

Set this in Vercel (and `.env.local` for local development):

```bash
OPENAI_API_KEY=...
```

Optional model overrides:

```bash
OPENAI_DOCUMENT_MODEL=gpt-5.6-sol
OPENAI_VERIFY_MODEL=gpt-5.6-sol
```

No Azure Document Intelligence resource is required.

## Rule-pack status

The recovered owner audit doctrine is encoded in `lib/audit-rules.ts`. The following authoritative source files are still required before the app can claim exact RCS/search-type/state rule parity:

- `Title Report Forensic Audit – Quick Reference Checklist.docx`
- `VERA_Template_v3.3.docx`
- `Title Report Legal Description Compliance Protocol.docx`
- `RCS Title General Search Requirements by order type.pdf`

Until those source documents are loaded, the app must not invent state mandates or missing RCS requirements.

## Local

```bash
npm install
npm run dev
```

Open `/examine`.
