import { NextRequest, NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { critique } from "@/lib/critic";
import { extractVera } from "@/lib/extract";
import { FIXTURES } from "@/lib/fixtures";
import { VeraExam } from "@/lib/vera";

export const runtime = "nodejs";

async function pdfToText(buf: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

export async function POST(req: NextRequest) {
  try {
    const ctype = req.headers.get("content-type") || "";
    const exams: VeraExam[] = [];
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const files = form.getAll("files");
      if (!files.length) return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
      for (const file of files) {
        if (!(file instanceof File)) continue;
        const name = file.name || "upload";
        const text = name.toLowerCase().endsWith(".pdf")
          ? await pdfToText(await file.arrayBuffer())
          : await file.text();
        if (!text.trim()) return NextResponse.json({ error: `Could not read text from ${name}` }, { status: 422 });
        exams.push(critique(extractVera(text, name)));
      }
    } else {
      const body = (await req.json()) as { fixtureId?: string; text?: string; sourceFile?: string };
      if (body.fixtureId) {
        const fixture = FIXTURES.find((f) => f.id === body.fixtureId);
        if (!fixture) return NextResponse.json({ error: "Unknown fixture" }, { status: 404 });
        exams.push(critique(extractVera(fixture.text, fixture.name)));
      } else if (body.text?.trim()) {
        exams.push(critique(extractVera(body.text, body.sourceFile || "pasted-text")));
      } else {
        return NextResponse.json({ error: "Provide files, text, or fixtureId" }, { status: 400 });
      }
    }
    return NextResponse.json({ exam: exams[0], exams, count: exams.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Examine failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
