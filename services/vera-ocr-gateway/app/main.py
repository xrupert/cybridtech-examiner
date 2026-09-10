import io
import os
import re
import time
from typing import Optional

import cv2
import fitz
import httpx
import numpy as np
import pytesseract
from fastapi import FastAPI, File, Header, HTTPException, Query, Request, UploadFile
from PIL import Image

app = FastAPI(title="Vera OCR Gateway", version="1.0.0")

MAX_IMAGE_BYTES = int(os.getenv("VERA_OCR_MAX_IMAGE_BYTES", str(25 * 1024 * 1024)))
MAX_PDF_BYTES = int(os.getenv("VERA_OCR_MAX_PDF_BYTES", str(250 * 1024 * 1024)))
MIN_CHARS = int(os.getenv("VERA_OCR_MIN_CHARS", "24"))
MIN_CONFIDENCE = float(os.getenv("VERA_OCR_MIN_CONFIDENCE", "0.45"))
UPSTREAM_TIMEOUT = float(os.getenv("UPSTREAM_TURBOOCR_TIMEOUT_SECONDS", "40"))

TITLE_SIGNALS = re.compile(
    r"instrument|document\s*(?:no|number)|book\s*/?\s*page|recorded|grantor|grantee|"
    r"beneficiary|mortgagor|mortgagee|deed of trust|assignment|release|satisfaction|"
    r"mers|\bmin\b|legal description|lot\s+\d|block\s+\d|parcel|county|trustee|lien",
    re.I,
)


def _require_auth(authorization: Optional[str]) -> None:
    expected = os.getenv("VERA_OCR_API_KEY", "").strip()
    if not expected:
        return
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="Unauthorized")


def _compact(text: str) -> str:
    text = (text or "").replace("\x00", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _confidence(data: dict) -> float:
    values = []
    for raw in data.get("conf", []):
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if value >= 0:
            values.append(value / 100.0)
    return sum(values) / len(values) if values else 0.0


def _deskew(gray: np.ndarray) -> np.ndarray:
    inv = cv2.bitwise_not(gray)
    coords = np.column_stack(np.where(inv > 0))
    if len(coords) < 100:
        return gray
    angle = cv2.minAreaRect(coords)[-1]
    angle = -(90 + angle) if angle < -45 else -angle
    if abs(angle) < 0.15 or abs(angle) > 15:
        return gray
    h, w = gray.shape[:2]
    matrix = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(gray, matrix, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def _variants(image: Image.Image):
    rgb = np.array(image.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    gray = _deskew(gray)
    yield "gray", gray
    yield "otsu", cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    yield "adaptive", cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    yield "contrast", clahe


def _candidate_score(text: str, confidence: float) -> float:
    clean = _compact(text)
    signal_count = len(TITLE_SIGNALS.findall(clean))
    length_bonus = min(0.12, len(clean) / 20_000.0)
    signal_bonus = min(0.16, signal_count * 0.012)
    return confidence + length_bonus + signal_bonus


def _tesseract_image(image: Image.Image) -> dict:
    best = {"text": "", "confidence": 0.0, "score": -1.0, "variant": "", "psm": 3}
    attempts = []
    language = os.getenv("TESSERACT_LANG", "eng")
    for variant_name, variant in _variants(image):
        for psm in (3, 6, 11):
            started = time.time()
            data = pytesseract.image_to_data(
                variant,
                lang=language,
                config=f"--oem 1 --psm {psm}",
                output_type=pytesseract.Output.DICT,
            )
            lines = []
            current_key = None
            current_words = []
            for i, word in enumerate(data.get("text", [])):
                word = (word or "").strip()
                if not word:
                    continue
                key = (data.get("block_num", [0])[i], data.get("par_num", [0])[i], data.get("line_num", [0])[i])
                if current_key is not None and key != current_key and current_words:
                    lines.append(" ".join(current_words))
                    current_words = []
                current_key = key
                current_words.append(word)
            if current_words:
                lines.append(" ".join(current_words))
            text = _compact("\n".join(lines))
            conf = _confidence(data)
            score = _candidate_score(text, conf)
            attempts.append({
                "engine": "tesseract",
                "variant": variant_name,
                "psm": psm,
                "confidence": round(conf, 4),
                "charCount": len(text),
                "durationMs": round((time.time() - started) * 1000),
            })
            if score > best["score"]:
                best = {"text": text, "confidence": conf, "score": score, "variant": variant_name, "psm": psm}
    return {**best, "attempts": attempts}


async def _upstream_turbo(image_bytes: bytes) -> Optional[dict]:
    base = os.getenv("UPSTREAM_TURBOOCR_URL", "").strip().rstrip("/")
    if not base:
        return None
    headers = {"Content-Type": "image/png"}
    key = os.getenv("UPSTREAM_TURBOOCR_API_KEY", "").strip()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    async with httpx.AsyncClient(timeout=UPSTREAM_TIMEOUT) as client:
        response = await client.post(f"{base}/ocr/raw?layout=1", content=image_bytes, headers=headers)
    if response.status_code >= 400:
        return None
    payload = response.json()
    results = payload.get("results") or []
    if results:
        text = _compact("\n".join(str(item.get("text") or "") for item in results))
        confs = [float(item.get("confidence")) for item in results if isinstance(item.get("confidence"), (int, float))]
        confidence = sum(confs) / len(confs) if confs else 0.5
    else:
        text = _compact(str(payload.get("text") or ""))
        confidence = float(payload.get("confidence") or (0.5 if text else 0))
    if len(text) < MIN_CHARS or confidence < MIN_CONFIDENCE:
        return None
    return {"text": text, "confidence": confidence, "provider": "turboocr", "upstream": True}


async def _ocr_bytes(image_bytes: bytes) -> dict:
    upstream = await _upstream_turbo(image_bytes)
    if upstream:
        return {"provider": "turboocr", "text": upstream["text"], "confidence": upstream["confidence"], "attempts": [{"engine": "turboocr", "status": "accepted"}]}

    try:
        image = Image.open(io.BytesIO(image_bytes))
        image.load()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid image: {exc}") from exc
    result = _tesseract_image(image)
    accepted = len(result["text"]) >= MIN_CHARS and result["confidence"] >= MIN_CONFIDENCE
    return {
        "provider": "tesseract",
        "text": result["text"] if accepted else "",
        "confidence": result["confidence"] if accepted else 0.0,
        "accepted": accepted,
        "variant": result["variant"],
        "psm": result["psm"],
        "attempts": result["attempts"],
    }


@app.get("/health")
async def health():
    return {
        "ok": True,
        "service": "vera-ocr-gateway",
        "tesseract": pytesseract.get_tesseract_version().__str__(),
        "turboUpstreamConfigured": bool(os.getenv("UPSTREAM_TURBOOCR_URL", "").strip()),
    }


@app.post("/ocr/raw")
async def ocr_raw(request: Request, authorization: Optional[str] = Header(default=None)):
    _require_auth(authorization)
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Image body is required")
    if len(body) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds configured size limit")
    result = await _ocr_bytes(body)
    if not result.get("accepted", True) and not result.get("text"):
        return {"text": "", "results": [], "provider": result.get("provider"), "attempts": result.get("attempts", [])}
    return {
        "text": result["text"],
        "results": [{"text": result["text"], "confidence": result["confidence"], "provider": result["provider"]}],
        "provider": result["provider"],
        "attempts": result.get("attempts", []),
    }


@app.post("/ocr/pdf")
async def ocr_pdf(
    file: UploadFile = File(...),
    pages: str = Query(default=""),
    dpi: int = Query(default=300, ge=150, le=450),
    authorization: Optional[str] = Header(default=None),
):
    _require_auth(authorization)
    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="PDF is empty")
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds configured size limit")
    try:
        document = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not open PDF: {exc}") from exc

    requested = []
    if pages.strip():
        for raw in pages.split(","):
            try:
                value = int(raw.strip())
            except ValueError:
                continue
            if 1 <= value <= document.page_count:
                requested.append(value)
    if not requested:
        requested = list(range(1, document.page_count + 1))

    output = []
    matrix = fitz.Matrix(dpi / 72.0, dpi / 72.0)
    try:
        for page_number in requested:
            page = document.load_page(page_number - 1)
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            image_bytes = pix.tobytes("png")
            result = await _ocr_bytes(image_bytes)
            output.append({
                "page": page_number,
                "processed": True,
                "blank": False,
                "text": result.get("text", ""),
                "confidence": result.get("confidence", 0.0),
                "provider": result.get("provider", "tesseract"),
                "attempts": result.get("attempts", []),
            })
    finally:
        document.close()
    return {"pageCount": len(requested), "pages": output}
