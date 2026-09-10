import type { ExtractionMode, PacketExtractionLedger, PreparedPacket } from "./document-engine";

function packetText(ledger: PacketExtractionLedger): string {
  return ledger.pages.map((page) => {
    const marker = `=== PDF PAGE ${page.page} | ${page.documentHint} | TEXT SOURCE ${page.textSource} ===`;
    if (page.textSource === "blank") return `${marker}\n[BLANK OR SEPARATOR PAGE]`;
    if (!page.text?.trim()) return `${marker}\n[UNREADABLE PAGE ${page.page} — MANUAL REVIEW REQUIRED; DO NOT INFER CONTENT]`;
    return `${marker}\n${page.text}`;
  }).join("\n\n");
}

function partialMode(ledger: PacketExtractionLedger): ExtractionMode {
  if (!ledger.pageCount) return "openai-pdf-fallback";
  if (ledger.initialLowTextPages.length || ledger.ocrRecoveredPages.length || ledger.lowTextPages.length || ledger.ocrSkippedPages.length) {
    return "hybrid-page-ocr";
  }
  return "native-text";
}

/**
 * The core invariant for title packets: an unreadable physical page never erases
 * readable neighboring pages and never forces the whole packet through an opaque
 * all-or-nothing fallback.  If the PDF itself opens, every page stays represented.
 */
export function preservePartialPacketEvidence(prepared: PreparedPacket): PreparedPacket {
  if (!prepared.ledger.pageCount) return prepared;
  return {
    ...prepared,
    extractionMode: partialMode(prepared.ledger),
    pageDelimitedText: packetText(prepared.ledger),
  };
}
