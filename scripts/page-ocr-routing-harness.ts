import assert from "node:assert/strict";
import { parseOcrProviderOrder, parseTesseractTsv, shouldAcceptOcrResult } from "../lib/page-ocr";

function withEnv(name: string, value: string | undefined, fn: () => void): void {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try { fn(); } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

assert.deepEqual(
  parseOcrProviderOrder("turboocr,tesseract,openai-page-vision"),
  ["turboocr", "tesseract", "openai-page-vision"],
  "default provider chain must preserve the intended bounded escalation order",
);

assert.deepEqual(
  parseOcrProviderOrder("tesseract,garbage,tesseract,openai-page-vision"),
  ["tesseract", "openai-page-vision"],
  "provider parsing must discard unknown values and duplicates",
);

const sampleTsv = [
  "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
  "5\t1\t1\t1\t1\t1\t10\t10\t100\t20\t96.0\tInstrument",
  "5\t1\t1\t1\t1\t2\t120\t10\t80\t20\t94.0\tNumber",
  "5\t1\t1\t1\t2\t1\t10\t40\t120\t20\t92.0\t2026-001234",
].join("\n");
const parsed = parseTesseractTsv(sampleTsv);
assert.equal(parsed.text, "Instrument Number\n2026-001234", "TSV parsing must preserve Tesseract line grouping");
assert.ok(parsed.confidence > 0.93 && parsed.confidence < 0.95, "TSV confidence must be normalized to 0..1");

withEnv("CYBRID_PAGE_OCR_MIN_CHARS", "20", () => {
  withEnv("CYBRID_PAGE_OCR_MIN_CONFIDENCE", "0.50", () => {
    assert.equal(shouldAcceptOcrResult({ text: "Instrument Number 2026-001234", confidence: 0.91 }), true);
    assert.equal(shouldAcceptOcrResult({ text: "tiny", confidence: 0.99 }), false, "short OCR fragments must not be accepted as reliable page recovery");
    assert.equal(shouldAcceptOcrResult({ text: "Instrument Number 2026-001234", confidence: 0.20 }), false, "low-confidence OCR must continue to the next provider");
  });
});

console.log("page-ocr-routing-harness: PASS");
