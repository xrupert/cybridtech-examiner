import { NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { detectSearchTypeFromText, type PacketExtractionLedger } from "@/lib/document-engine";

export const runtime = "nodejs";

const HASH = "72997b962e42634722982fe3a0cd58e461c45b2bdc8dc836b9fb8a36e6b41cd4";
const CACHE = `cybrid-title/extraction-ledgers-v3/${HASH}.json`;

export async function GET() {
  const result = await get(CACHE, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) {
    return NextResponse.json({ cacheFound: false, packetHash: HASH }, { status: 404 });
  }
  const ledger = await new Response(result.stream).json() as PacketExtractionLedger;
  const openingPages = ledger.pages.filter((page) => page.page <= 8);
  const openingText = openingPages.map((page) => page.text).filter(Boolean).join("\n");
  const detection = detectSearchTypeFromText(openingText);
  return NextResponse.json({
    cacheFound: true,
    packetHash: ledger.packetHash,
    pageCount: ledger.pageCount,
    totalCharacters: ledger.totalCharacters,
    textCoverage: ledger.textCoverage,
    usableTextPages: ledger.usableTextPages,
    lowTextPageCount: ledger.lowTextPages.length,
    nativeTextReady: ledger.nativeTextReady,
    expectedExtractionMode: ledger.nativeTextReady ? "native-text" : "openai-pdf-fallback",
    searchTypeDetection: detection,
    openingPageHints: openingPages.map((page) => ({ page: page.page, charCount: page.charCount, hint: page.documentHint, needsVisualReview: page.needsVisualReview })),
  });
}
