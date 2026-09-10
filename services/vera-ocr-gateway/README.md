# Vera OCR Gateway

A private OCR execution service for Cybrid Title / Vera. The web application remains the control plane; this service performs native OCR work that does not belong inside Vercel's serverless runtime.

## Runtime contract

The production recovery order is:

`native PDF text → page-local OCR → Vera OCR Gateway → TurboOCR GPU fast path → deterministic Tesseract recovery → model page vision → manual review`

The gateway never decides title facts, PASS/FAIL, lien position, curative action, or legal conclusions. It only returns page text, provider provenance, confidence, and blank/unresolved state.

### Endpoints

- `GET /health`
- `POST /ocr/raw` — raw PNG/JPEG bytes; compatible with the existing Vera `TURBOOCR_URL` image contract.
- `POST /ocr/pdf?pages=4,19,77&dpi=300` — multipart field `file`; returns the requested physical pages only.

For a large candidate set and an upstream TurboOCR server, `/ocr/pdf` sends the complete PDF to TurboOCR once using `mode=auto_verified`, then returns only the requested physical pages. This lets a 500–1000+ page scanned packet use TurboOCR's parallel native PDF pipeline rather than spawning Tesseract page-by-page in Vercel.

If TurboOCR is unavailable, the gateway performs bounded CPU Tesseract recovery using grayscale, deskew, Otsu, adaptive threshold, CLAHE contrast, and PSM 3/6/11 candidate passes. CPU fallback is intentionally capped per request so a missing GPU cannot silently turn a large production packet into an hours-long web request.

## Deploy on Railway or another container host

Build from the repository root so the Dockerfile can copy its service directory:

```bash
docker build -f services/vera-ocr-gateway/Dockerfile -t vera-ocr-gateway .
docker run --rm -p 8080:8080 \
  -e VERA_OCR_API_KEY='replace-me' \
  vera-ocr-gateway
```

For Railway, create one private service per compliance client (or one dedicated OCR environment paired only with that client's Vera deployment), point it at this repository, and set the Dockerfile path to:

`services/vera-ocr-gateway/Dockerfile`

## Environment

Required for authenticated production use:

```text
VERA_OCR_API_KEY=<long random client-specific secret>
```

Optional TurboOCR GPU upstream:

```text
UPSTREAM_TURBOOCR_URL=https://private-turboocr.example
UPSTREAM_TURBOOCR_API_KEY=<if the upstream requires auth>
UPSTREAM_TURBOOCR_TIMEOUT_SECONDS=45
UPSTREAM_TURBOOCR_PDF_TIMEOUT_SECONDS=600
VERA_TURBO_PDF_THRESHOLD_PAGES=12
```

Tesseract / quality controls:

```text
TESSERACT_LANG=eng
VERA_OCR_MIN_CHARS=24
VERA_OCR_MIN_CONFIDENCE=0.45
VERA_OCR_BLANK_INK_RATIO=0.0008
VERA_TESSERACT_MAX_PDF_PAGES=80
VERA_OCR_MAX_IMAGE_BYTES=26214400
VERA_OCR_MAX_PDF_BYTES=524288000
```

Then configure the matching Vera/Vercel client instance:

```text
VERA_OCR_GATEWAY_URL=https://<gateway-host>
VERA_OCR_GATEWAY_API_KEY=<same client-specific gateway secret>
VERA_OCR_GATEWAY_TIMEOUT_MS=600000
VERA_OCR_GATEWAY_DPI=300
```

You may also point Vera's image-level `TURBOOCR_URL` directly at a TurboOCR server. The recommended production topology is Vera → gateway for PDF escalation, with the gateway → TurboOCR GPU and Tesseract CPU as independent recovery engines.

## Security rule

Never commit service-role database keys, OCR gateway secrets, OpenAI keys, or client credentials to source control. Each client deployment receives distinct environment secrets and storage/database scope. The old OCR prototype found elsewhere in the account must not be reused with its historical credential handling.
