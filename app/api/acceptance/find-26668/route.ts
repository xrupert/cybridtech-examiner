import { NextResponse } from "next/server";
import { list } from "@vercel/blob";

export const runtime = "nodejs";

export async function GET() {
  const matches: Array<{ pathname: string; size: number; uploadedAt: string }> = [];
  let cursor: string | undefined;
  do {
    const result = await list({ prefix: "cybrid-title/", cursor, limit: 1000 });
    for (const blob of result.blobs) {
      if (/26668/i.test(blob.pathname)) {
        matches.push({ pathname: blob.pathname, size: blob.size, uploadedAt: blob.uploadedAt.toISOString() });
      }
    }
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);
  return NextResponse.json({ count: matches.length, matches });
}
