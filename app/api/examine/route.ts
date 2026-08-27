import { NextRequest, NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { critique } from "@/lib/critic";
import { extractVera, extractVeraFromPages } from "@/lib/extract";
import { FIXTURES } from "@/lib/fixtures";
import type { PageEvidence, VeraExam } from "@/lib/vera";
import { analyzeWithAzureDocumentIntelligence, azureDocumentIntelligenceConfigured } from "@/lib/document-intelligence";

export const runtime = "nodejs";
export const maxDuration = 60;

async function nativePdfPages(buf: ArrayBuffer): Promise<PageEvidence[]> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  const pageTexts = Array.isArray(text) ? text : [text];
  return pageTexts.map((pageText, index) => ({ page: index + 1, text: pageText || "", source: "native" as const, documentType: "Unclassified" }));
}

function weakNativePage(page: PageEvidence): boolean {
  const compact = page.text.replace(/\s+/g, "");
  return compact.length < 45;
}

async function pdfToEvidence(buf: ArrayBuffer): Promise<{ pages: PageEvidence[]; azureAttempted: boolean }> {
  const native = await nativePdfPages(buf);
  const needOcr = native.length === 0 || native.some(weakNativePage);
  if (!needOcr || !azureDocumentIntelligenceConfigured()) return { pages: native, azureAttempted: false };

  const azure = await analyzeWithAzureDocumentIntelligence(buf);
  const azureByPage = new Map(azure.map((page) => [page.page, page]));
  const total = Math.max(native.length, azure.length);
  const pages: PageEvidence[] = [];
  for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
    const nativePage = native[pageNumber - 1];
    const azurePage = azureByPage.get(pageNumber);
    pages.push(nativePage && !weakNativePage(nativePage) ? nativePage : azurePage || nativePage || { page: pageNumber, text: "", source: "native", documentType: "Unclassified" });
  }
  return { pages, azureAttempted: true };
}

export async function POST(req: NextRequest) {
  try {
    const ctype = req.headers.get("content-type") || "";
    const exams: VeraExam[] = [];
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const files = form.getAll("files");
      const state = String(form.get("state") || "TX").trim().toUpperCase() || "TX";
      const searchType = String(form.get("searchType") || "General Search").trim() || "General Search";
      if (!files.length) return NextResponse.json({ error: "No files uploaded" }, { status: 400 });

      for (const file of files) {
        if (!(file instanceof File)) continue;
        const name = file.name || "upload";
        if (name.toLowerCase().endsWith(".pdf")) {
          const { pages, azureAttempted } = await pdfToEvidence(await file.arrayBuffer());
          if (!pages.some((page) => page.text.trim())) {
            const reason = azureDocumentIntelligenceConfigured()
              ? `No usable text was recovered from ${name}, including OCR.`
              : `No usable text was recovered from ${name}. Configure Azure Document Intelligence for scanned/image PDFs.`;
            return NextResponse.json({ error: reason, needsOcrConfiguration: !azureDocumentIntelligenceConfigured() }, { status: 422 });
          }
          let exam = critique(extractVeraFromPages(pages, { sourceFile: name, state, searchType }));
          if (!azureAttempted && pages.some(weakNativePage) && !azureDocumentIntelligenceConfigured()) {
            exam = { ...exam, manualReviewRequired: true, extractionSummary: `${exam.extractionSummary} Azure OCR is NOT configured; low-text pages require manual verification.` };
          }
          exams.push(exam);
        } else {
          const text = await file.text();
          if (!text.trim()) return NextResponse.json({ error: `Could not read text from ${name}` }, { status: 422 });
          exams.push(critique(extractVera(text, name, { state, searchType })));
        }
      }
    } else {
      const body = (await req.json()) as { fixtureId?: string; text?: string; sourceFile?: string; state?: string; searchType?: string };
      const state = body.state?.trim().toUpperCase() || "TX";
      const searchType = body.searchType?.trim() || "General Search";
      if (body.fixtureId) {
        const fixture = FIXTURES.find((f) => f.id === body.fixtureId);
        if (!fixture) return NextResponse.json({ error: "Unknown fixture" }, { status: 404 });
        exams.push(critique(extractVera(fixture.text, fixture.name, { state, searchType })));
      } else if (body.text?.trim()) {
        exams.push(critique(extractVera(body.text, body.sourceFile || "pasted-text", { state, searchType })));
      } else return NextResponse.json({ error: "Provide files, text, or fixtureId" }, { status: 400 });
    }
    return NextResponse.json({ exam: exams[0], exams, count: exams.length, azureOcrConfigured: azureDocumentIntelligenceConfigured() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Examine failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
