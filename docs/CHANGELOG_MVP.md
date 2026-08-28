# MVP Scope Change

This branch converts the Examiner from a one-direction title-report prototype into a simple two-direction evidence workbench:

1. Review an existing title report / Run Sheet packet into VERA v3.
2. Build a verified Run Sheet from the underlying title documents.

It also loads the owner-supplied VERA v3 and RCS order-type rules, adds hard server evidence gates, true DOCX generation, preserved examiner overrides, protected paid AI routes, robust non-JSON error handling, and a private large-file upload path for production-sized PDFs.
