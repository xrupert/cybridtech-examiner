# Cybrid Title Document Engine v1

Cybrid Title treats **packet identity**, **property/matter identity**, and **review identity** as three different things.

## Identity model

- `packetHash`: SHA-256 of the exact uploaded bytes. This is the extraction-cache key only. If the bytes change, it is a new packet even when the address, title/order number, parcel, or property is the same.
- `matterKey`: a non-PII SHA-256 key derived from normalized client/order number + parcel ID + property address after examination. Different packets can intentionally share the same matter key.
- `reviewId`: a fresh UUID for every completed examination. The same exact packet may be reviewed again later under a new rule version and therefore receives a new review ID.

This means an order such as `2025-26760` can have multiple reviews over time. Cybrid Title never assumes that matching order number/address means the packet is unchanged.

## Processing path

1. Hash the exact packet.
2. Load or create a page-addressable extraction ledger for that packet hash.
3. Prefer native PDF text extraction when coverage is strong.
4. Preserve physical PDF page numbers in the extracted text.
5. Fall back to full PDF/vision processing when native extraction coverage is insufficient.
6. Run the VERA/RCS audit against the extracted packet representation.
7. Apply the deterministic evidence/structure critic.
8. Persist a private review receipt with packet hash, matter key, review ID, effective date, page count, rule version, model path, and timing metadata.

## Cache rule

Only the exact packet hash is reusable as an extraction cache. **Address, order number, client order number, parcel ID, and property identity are never used as cache keys.**

That prevents a later report for the same property from silently inheriting stale document content.
