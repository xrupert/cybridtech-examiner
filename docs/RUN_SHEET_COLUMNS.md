# Run Sheet Columns — MVP

The reverse-build workflow uses a provisional evidence-first schema until a representative production Run Sheet is supplied for exact column/order mapping.

Current columns:

1. Sequence
2. Category
3. Instrument Type
4. Document Date
5. Recording Date
6. Instrument Number
7. Book
8. Page
9. Grantor / Borrower
10. Grantee / Beneficiary
11. Amount
12. Status
13. Legal Description Summary
14. Notes
15. Verification
16. Verification Note
17. Evidence Pages

These columns are intentionally broader than any one customer format. The extraction contract is the stable layer: every row keeps the source document, physical page, verbatim quote, and independent verification state. When a real production Run Sheet sample is supplied, its exact presentation columns can replace this export mapping without changing the evidence pipeline.
