# Document Engine v1 implementation status

Implemented in this branch:

- Exact-packet SHA-256 identity. Cache keys never use address, parcel, or order number.
- Native PDF text extraction with physical page boundaries and page-level document hints.
- Private Vercel Blob extraction-ledger cache keyed by exact packet hash.
- Conservative native-text threshold; scanned/low-text packets fall back to OpenAI PDF/vision.
- One Sol audit pass against page-addressable extracted text when native coverage is strong.
- Deterministic server evidence/structure critic remains mandatory after the model pass.
- Versioned private review receipts with a fresh `reviewId` for every completed examination.
- Related-matter identity indexes for order number, parcel, and address. These link repeat reviews without treating prior packet contents as current evidence.
- `matterRevision` counts prior related reviews discovered through any matching identity key.
- Usage telemetry now includes page count, packet hash, extraction mode/cache hit, extraction/model timing, review ID, and matter revision.

Important behavior: the same exact PDF may reuse only its extraction ledger. A later PDF for the same property/order is processed as a new packet whenever its bytes differ. A new review receipt is created every time, even for the same exact packet, so later rule-version re-reviews remain distinct.
