import type { PacketExtractionLedger, PreparedPacket } from "./document-engine";
import type { PageOcrProvider } from "./page-ocr";

interface GatewayPage {
  page: number;
  processed?: boolean;
  blank?: boolean;
  text?: string;
  confidence?: number;
  provider?: string;
  attempts?: unknown[];
}

function compact(value: string): string {
  return String(value || "").replace(/\u0000/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function gatewayUrl(): string {
  return String(process.env.VERA_OCR_GATEWAY_URL || "").trim().replace(/\/$/, "");
}

function timeoutMs(): number {
  const value = Number(process.env.VERA_OCR_GATEWAY_TIMEOUT_MS);
  return Number.isFinite(value) ? Math.max(30_000, Math.min(760_000, value)) : 600_000;
}

function provider(value: string | undefined): PageOcrProvider | null {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "turboocr" || normalized === "tesseract" || normalized === "openai-page-vision") return normalized;
  return null;
}

function recalculate(ledger: PacketExtractionLedger): PacketExtractionLedger {
  const blankPages = ledger.pages.filter((page) => page.textSource === "blank").map((page) => page.page);
  const lowTextPages = ledger.pages.filter((page) => page.needsVisualReview).map((page) => page.page);
  const ocrRecoveredPages = ledger.pages.filter((page) => ["turboocr", "tesseract", "openai-page-vision"].includes(page.textSource)).map((page) => page.page);
  const providers = new Set<PageOcrProvider>();
  ledger.pages.forEach((page) => {
    if (page.textSource === "turboocr" || page.textSource === "tesseract" || page.textSource === "openai-page-vision") providers.add(page.textSource);
  });
  const totalCharacters = ledger.pages.reduce((sum, page) => sum + page.charCount, 0);
  const effectiveTextPages = Math.max(0, ledger.pageCount - blankPages.length);
  const usableTextPages = ledger.pages.filter((page) => page.textSource !== "blank" && !page.needsVisualReview).length;
  const textCoverage = effectiveTextPages ? usableTextPages / effectiveTextPages : 1;
  const recovered = new Set(ocrRecoveredPages);
  const ocrSkippedPages = ledger.ocrSkippedPages.filter((page) => !recovered.has(page));
  return {
    ...ledger,
    totalCharacters,
    textCoverage,
    usableTextPages,
    effectiveTextPages,
    lowTextPages,
    ocrRecoveredPages,
    ocrSkippedPages,
    blankPages,
    ocrProvidersUsed: [...providers],
    pageTextReady: totalCharacters >= 2000 && textCoverage >= 0.9 && lowTextPages.length === 0,
  };
}

/**
 * Escalates only pages that survived local/page-provider recovery unresolved.
 * The OCR service runs outside Vercel so large scanned packets do not spend the
 * app's compute budget rendering and Tesseracting hundreds of pages in-process.
 */
export async function recoverPreparedPacketRemotely(buffer: ArrayBuffer, prepared: PreparedPacket): Promise<PreparedPacket> {
  const base = gatewayUrl();
  if (!base || !prepared.ledger.pageCount) return prepared;
  const requested = [...new Set([...prepared.ledger.lowTextPages, ...prepared.ledger.ocrSkippedPages])].sort((a, b) => a - b);
  if (!requested.length) return prepared;

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "application/pdf" }), prepared.ledger.sourceFile || "packet.pdf");
  const headers: Record<string, string> = {};
  const key = String(process.env.VERA_OCR_GATEWAY_API_KEY || "").trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  const query = new URLSearchParams({ pages: requested.join(","), dpi: String(process.env.VERA_OCR_GATEWAY_DPI || "300") });

  const started = Date.now();
  try {
    const response = await fetch(`${base}/ocr/pdf?${query}`, {
      method: "POST",
      headers,
      body: form,
      signal: AbortSignal.timeout(timeoutMs()),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn("CYBRID_TITLE_REMOTE_OCR_FAILED", JSON.stringify({ status: response.status, pages: requested.length, body: body.slice(0, 500) }));
      return prepared;
    }
    const payload = await response.json() as { pages?: GatewayPage[] };
    const byPage = new Map((payload.pages || []).map((page) => [Number(page.page), page]));
    const pages = prepared.ledger.pages.map((page) => {
      const recovered = byPage.get(page.page);
      if (!recovered) return page;
      if (recovered.blank) {
        return { ...page, text: "", charCount: 0, textSource: "blank" as const, confidence: 1, needsVisualReview: false, documentHint: "Blank / separator page" };
      }
      const text = compact(recovered.text || "");
      const source = provider(recovered.provider);
      const confidence = Math.max(0, Math.min(1, Number(recovered.confidence) || 0));
      if (!text || !source) return page;
      return {
        ...page,
        text,
        charCount: text.length,
        textSource: source,
        confidence,
        needsVisualReview: false,
        ocrAttempts: [...page.ocrAttempts, { provider: source, status: "success" as const, confidence, charCount: text.length, durationMs: 0, reason: "Recovered by external Vera OCR gateway." }],
      };
    });
    const ledger = recalculate({ ...prepared.ledger, pages });
    console.info("CYBRID_TITLE_REMOTE_OCR_COMPLETE", JSON.stringify({
      packetHash: prepared.packetHash,
      requestedPages: requested.length,
      recoveredPages: ledger.ocrRecoveredPages.filter((page) => requested.includes(page)).length,
      unresolvedPages: ledger.lowTextPages.length,
      ms: Date.now() - started,
    }));
    return { ...prepared, ledger };
  } catch (error) {
    console.warn("CYBRID_TITLE_REMOTE_OCR_ERROR", JSON.stringify({ pages: requested.length, message: error instanceof Error ? error.message : "unknown" }));
    return prepared;
  }
}
