# Client-Isolated Vera Deployment Standard

## Governing rule

Cybrid Title / Vera is built once from one canonical repository, but **production is deployed as one isolated system per client** when compliance isolation is required.

A client deployment is not a logical dropdown inside a shared evidence database. It is a separate application boundary with its own environment identity, authentication secrets, private packet storage, database project/schema boundary as required, review dossiers, OCR credentials, audit receipts, and observability scope.

The source code remains common so fixes, eval gates, OCR improvements, and VERA logic can be promoted consistently across clients.

## Required isolation

Each production client receives a dedicated:

- Vercel project/environment and domain.
- `VERA_CLIENT_ID` and `VERA_CLIENT_NAME` lock.
- authentication secret/configuration.
- private Blob store/token or client-exclusive storage namespace/account.
- Supabase/Postgres project when contractual/compliance requirements call for physical database isolation. This is the preferred production standard for regulated clients.
- OCR gateway credentials; for higher-isolation contracts, a dedicated OCR gateway service and GPU namespace.
- rule-pack/export configuration and version history.
- observability project/environment so traces never cross client boundaries.

No packet evidence, previous matter evidence, chat history, canonical review dossier, or examiner decision from Client A is available to Client B.

## Vercel environment

Production variables:

```text
VERA_COMPLIANCE_MODE=1
VERA_CLIENT_ID=<stable-client-slug>
VERA_CLIENT_NAME=<client-display-name>
VERA_DEPLOYMENT_ID=<client-prod-identifier>

OPENAI_API_KEY=<client/deployment secret or approved platform key>
BLOB_READ_WRITE_TOKEN=<client-exclusive private Blob token>

VERA_OCR_GATEWAY_URL=<client-approved OCR service>
VERA_OCR_GATEWAY_API_KEY=<client-specific secret>
VERA_OCR_GATEWAY_TIMEOUT_MS=600000
VERA_OCR_GATEWAY_DPI=300
```

The API refuses a conflicting client scope when `VERA_COMPLIANCE_MODE=1`.

## Database boundary

Postgres is the authoritative system of record for durable application data. Vector indexes are derived retrieval infrastructure and must never become the sole source of truth.

Preferred regulated-client topology:

```text
Client A Vercel -> Client A Postgres/Supabase -> Client A Blob -> Client A OCR scope
Client B Vercel -> Client B Postgres/Supabase -> Client B Blob -> Client B OCR scope
```

If a future contract explicitly permits shared infrastructure, tenant/RLS isolation may be used, but that is a separately approved deployment model and is not the default compliance posture.

## Client knowledge versus packet evidence

Client-specific memory may contain approved procedural knowledge such as:

- order/search requirements;
- output schema;
- client terminology;
- approved exceptions and policy rules;
- effective dates and rule versions;
- examiner-approved workflow corrections.

Client memory **must never be used as documentary proof for a current packet**. Every substantive title finding must trace to current-packet physical-page evidence or an explicitly versioned authoritative rule source.

A future Supermemory/Qdrant/pgvector layer therefore carries an explicit context class such as `CLIENT_RULE`, `PROCEDURE`, or `PACKET_EVIDENCE`. Only `PACKET_EVIDENCE` from the current packet may prove a documentary fact.

## Promotion model

One canonical branch is promoted through:

`development -> golden-packet/eval gate -> per-client preview -> per-client production`

A code release is not accepted merely because it compiles. It must pass deterministic architecture tests and the secure human-reviewed golden packet corpus. Client-specific output adapters are then regression-compared before promotion.

## Large packet policy

Packets from roughly 50 through 1000+ pages are not treated as one model prompt.

1. create exact-byte packet identity;
2. inventory every physical page;
3. recover questionable pages independently;
4. preserve explicit unreadable-page markers;
5. escalate large scan sets to the external OCR execution plane;
6. partition large readable packets into bounded physical-page extraction shards;
7. deterministically merge the structured extraction;
8. run global reconciliation, evidence grounding, VERA checks, critic, and reducer;
9. persist the complete review dossier for Ask Vera.

An unreadable page can force `CANNOT_CONFIRM` / manual review. It cannot delete readable pages and it cannot create a title defect by itself.

## Deployment checklist

Before a new client is released:

1. create the client Vercel project from the canonical GitHub repository;
2. set the client identity lock and distinct secrets;
3. provision client database/storage boundaries;
4. connect the client OCR gateway/GPU path;
5. load only that client's approved rule/export package;
6. run clean, mixed native/scan, fully scanned, rotated, blank-page, malformed-page, and large-packet fixtures;
7. compare JSON/CSV/PDF output against the approved client baseline;
8. verify Ask Vera never answers without current-packet physical-page proof;
9. verify no cross-client storage, retrieval, memory, or trace access exists;
10. promote only after the release gate is green.
