# VERA MVP Acceptance Standard

The MVP is not accepted because the UI renders or a model returns JSON. It is accepted when the following user journeys work end to end with representative title documents.

## A. Review Existing Title Report

1. Upload one real title-report / Run Sheet packet, including a production-sized PDF.
2. Select State and one supported RCS order type: Foreclosure, 2nd Lien, or Current Owner Search.
3. The complete packet is read, including scanned pages.
4. Exactly 20 VERA findings are returned.
5. Every supported PASS or FAIL contains a usable verbatim quote and physical PDF page; the server rejects unsupported conclusions.
6. Critical Q4–Q12 and Q17–Q20 control the automated verdict.
7. RCS order-type applicability is honored; a 2nd Lien is not failed for copy types RCS specifically says not to provide.
8. Independent-pass disagreements become review/Cannot Confirm rather than a silent answer.
9. Examiner can Approve, Override, or mark Needs Review. Override reason is preserved without deleting the original AI finding.
10. A genuine VERA v3 `.docx` can be exported and the printable view can be saved as PDF.

## B. Build Run Sheet From Documents

1. Upload one combined packet or multiple title-document files.
2. Every distinct supplied instrument is classified and represented once unless documentary evidence justifies otherwise.
3. Each Run Sheet row retains source filename, physical page, document type, and verbatim source quote.
4. Recording number, dates, parties, book/page, amount, status, and legal-description identifiers are never invented when absent.
5. A second independent build re-reads the documents from scratch.
6. Missing rows or field disagreements between passes are marked REVIEW.
7. Matching core facts are marked VERIFIED.
8. Selected RCS order-type requirements that cannot be established from the packet are shown for examiner review.
9. Examiner can edit the generated row values without deleting source evidence or verification notes.
10. Run Sheet can be exported to CSV. Exact customer production columns are mapped when a representative production Run Sheet is supplied.

## C. Fail-closed requirements

- No OpenAI key: paid processing does not run.
- No server access protection: paid processing does not run.
- Large packet without private upload storage: user receives an explicit large-file configuration message, not a JSON parse error.
- Missing/ambiguous documentary evidence: Cannot Confirm / Review rather than guess.
- Missing Quick Reference Checklist or Legal Description Compliance Protocol: do not invent the absent rule content.

## D. Validation corpus

Before calling the product production-accurate, run representative human-reviewed packets that include at minimum:

- known clean packet
- missing referenced instrument
- assignment/vesting discrepancy
- legal-description discrepancy
- MERS + MIN case
- HOA/CC&R case
- scanned/image-heavy packet
- Run Sheet extra/missing instrument case
- Foreclosure case
- 2nd Lien case
- Current Owner case reaching the qualifying non-family FVD + PMM

The acceptance bar is evidence correctness and examiner usefulness, not a preselected marketing accuracy percentage.
