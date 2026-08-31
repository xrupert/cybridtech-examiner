import { NextResponse } from "next/server";
import { get } from "@vercel/blob";

export const runtime = "nodejs";

const PATHNAME = "cybrid-title/demo/1788112890571-0-2025-26668_Search-Package-5ctdXfSQA9JREWlhCcnRjOq1qXtmlM.pdf";

export async function GET() {
  try {
    const result = await get(PATHNAME, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return NextResponse.json({ exists: false, pathname: PATHNAME }, { status: 404 });
    }
    const bytes = await new Response(result.stream).arrayBuffer();
    return NextResponse.json({ exists: true, pathname: PATHNAME, byteLength: bytes.byteLength });
  } catch (error) {
    return NextResponse.json({ exists: false, pathname: PATHNAME, error: error instanceof Error ? error.message : "unknown" }, { status: 404 });
  }
}
