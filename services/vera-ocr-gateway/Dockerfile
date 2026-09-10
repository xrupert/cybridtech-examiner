FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TESSERACT_LANG=eng

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       tesseract-ocr \
       tesseract-ocr-eng \
       libglib2.0-0 \
       libgl1 \
       curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY services/vera-ocr-gateway/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt
COPY services/vera-ocr-gateway/app ./app

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 CMD curl -fsS http://127.0.0.1:${PORT:-8080}/health || exit 1

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers ${WEB_CONCURRENCY:-1}"]
