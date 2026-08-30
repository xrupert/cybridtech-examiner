# Ncala Demo Workflow

## Product goal

Demonstrate that Cybrid Title can ingest one title report or a batch, QC the title package against the selected order profile, identify foreclosure-relevant curative issues, and export grounded title data without re-keying it manually.

## Processing contract

Every packet follows the same contract:

1. **Extract** — identify exact packet bytes, preserve page identity, extract native text when reliable, and retain vision fallback for scanned/image-heavy packets.
2. **Check** — identify the functional Run Sheet/title-summary section and reconcile it bidirectionally against supporting instruments using the selected QC/order profile.
3. **Ground** — supported PASS/FAIL findings require packet evidence with physical PDF page provenance; unresolved critical evidence remains Cannot Confirm.
4. **Render** — produce the review detail, curative summary, VERA output, and client export only from grounded results.

## Demo surfaces

### Batch QC

- Accept multiple title-report PDFs.
- Process each packet as its own review job so one failure does not abort the batch.
- Surface per-file QC status and foreclosure readiness.
- Separate blocking curative issues from QC deficiencies and Cannot Confirm items.
- Preserve evidence for drill-down.

### Order/QC profiles

- Foreclosure
- 2nd Lien
- Current Owner Search
- Two Owner Search demo profile: establish current owner and immediately prior owner from deed evidence supplied in the packet.

### Canonical title record

The client export is not the database schema. Each completed review is normalized into a canonical record containing matter/order identity, borrower, property, target-lien fields, QC status, foreclosure readiness, curative issues, packet identity, and review identity.

### Export builder

The Ncala demo preset exports:

- TS Number
- Borrower Name
- Property Address
- Lien Position
- QC Status
- Foreclosure Readiness
- Curative Issues

Additional fields can be toggled without changing the QC engine. CSV and JSON use the same canonical record.

## Foreclosure readiness labels

- **CLEAR** — no material grounded QC/curative exception remains.
- **QC_DEFICIENCY** — report/package needs correction but no blocking title issue is currently established.
- **CURATIVE_REQUIRED** — a grounded blocking title/foreclosure issue is present.
- **CANNOT_CONFIRM** — a critical conclusion cannot be closed from supplied evidence.

## Demo limitation deliberately preserved

Lien position is exported only when it is explicitly established by the completed review. If the packet does not establish it cleanly, the UI shows `Needs review` and allows the examiner to correct that export field rather than inventing priority.

Future client integrations should map the canonical record to the client's required CSV headers, JSON contract, API payload, webhook, or SFTP format. The client's export format must never become Cybrid Title's underlying schema.
