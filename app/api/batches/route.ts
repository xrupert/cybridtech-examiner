import { NextRequest, NextResponse } from "next/server";
import { checkExaminerAccess } from "@/lib/examiner-auth";
import { createBatchManifest, loadBatchManifest, updateBatchItem, type BatchItemStatus } from "@/lib/batch-manifest";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const access = checkExaminerAccess(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const batchId = request.nextUrl.searchParams.get("batchId")?.trim() || "";
  if (!batchId) return NextResponse.json({ error: "batchId is required." }, { status: 400 });
  const manifest = await loadBatchManifest(batchId);
  return manifest ? NextResponse.json(manifest) : NextResponse.json({ error: "Batch not found." }, { status: 404 });
}

export async function POST(request: NextRequest) {
  try {
    const access = checkExaminerAccess(request);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const body = await request.json() as { clientName?: string; sourceFiles?: string[]; exportProfileId?: string };
    if (!Array.isArray(body.sourceFiles) || !body.sourceFiles.length) return NextResponse.json({ error: "sourceFiles are required." }, { status: 400 });
    return NextResponse.json(await createBatchManifest(body.clientName || "Ncala", body.sourceFiles, body.exportProfileId || "ncala-demo-v1"));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create batch." }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const access = checkExaminerAccess(request);
    if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
    const body = await request.json() as { batchId?: string; itemId?: string; status?: BatchItemStatus; reviewId?: string; packetHash?: string; error?: string };
    if (!body.batchId || !body.itemId || !body.status) return NextResponse.json({ error: "batchId, itemId, and status are required." }, { status: 400 });
    return NextResponse.json(await updateBatchItem(body.batchId, body.itemId, {
      status: body.status,
      reviewId: body.reviewId,
      packetHash: body.packetHash,
      error: body.error,
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update batch." }, { status: 400 });
  }
}
