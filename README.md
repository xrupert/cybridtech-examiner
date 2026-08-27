# CybridTech Examiner

Standalone title-exam workbench. Not part of LienSight.

Upload a title report (PDF or text) or load the Kern County mock packets from
[kattanalytics/Title-Examiner-Portfolio](https://github.com/kattanalytics/Title-Examiner-Portfolio).
The extractor fills the Vera Title Report Review Summary. A critic agent stamps Pass/Fail.

## Bones (this commit)

- Dala dark-void UI
- Firm access code (`examiner` by default)
- PDF text extract via `unpdf`
- Vera schema + heuristic extractor + critic
- Printable CybridTech letterhead worksheet
- Demo fixtures for Kern mock + preliminary mock

## Local

```bash
npm install
npm run dev
```

Open `/examine`. Default access code: `examiner`.

## Deploy

Linked to Vercel on the `XRupert's projects` team. Optional env:

- `NEXT_PUBLIC_ACCESS_CODE` — firm desk code
