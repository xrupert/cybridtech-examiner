import { randomUUID } from "node:crypto";
import { get, put } from "@vercel/blob";

export type BatchItemStatus = "QUEUED" | "PROCESSING" | "COMPLETE" | "ERROR";

export interface BatchManifestItem {
  itemId: string;
  sourceFile: string;
  status: BatchItemStatus;
  reviewId?: string;
  packetHash?: string;
  error?: string;
  updatedAt: string;
}

export interface BatchManifest {
  version: 1;
  batchId: string;
  clientName: string;
  exportProfileId: string;
  createdAt: string;
  updatedAt: string;
  items: BatchManifestItem[];
}

const PREFIX = "cybrid-title/batches-v1";

function path(batchId: string): string {
  return `${PREFIX}/${encodeURIComponent(batchId)}.json`;
}

async function persist(manifest: BatchManifest): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  await put(path(manifest.batchId), JSON.stringify(manifest), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

export async function createBatchManifest(clientName: string, sourceFiles: string[], exportProfileId = "ncala-demo-v1"): Promise<BatchManifest> {
  const now = new Date().toISOString();
  const manifest: BatchManifest = {
    version: 1,
    batchId: randomUUID(),
    clientName: clientName.trim() || "Client",
    exportProfileId,
    createdAt: now,
    updatedAt: now,
    items: sourceFiles.map((sourceFile) => ({ itemId: randomUUID(), sourceFile, status: "QUEUED", updatedAt: now })),
  };
  await persist(manifest);
  return manifest;
}

export async function loadBatchManifest(batchId: string): Promise<BatchManifest | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const result = await get(path(batchId), { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const parsed = await new Response(result.stream).json() as BatchManifest;
    return parsed?.version === 1 && parsed.batchId === batchId ? parsed : null;
  } catch {
    return null;
  }
}

export async function updateBatchItem(batchId: string, itemId: string, patch: Partial<Omit<BatchManifestItem, "itemId" | "sourceFile">>): Promise<BatchManifest> {
  const manifest = await loadBatchManifest(batchId);
  if (!manifest) throw new Error("Batch manifest was not found.");
  const now = new Date().toISOString();
  const items = manifest.items.map((item) => item.itemId === itemId ? { ...item, ...patch, updatedAt: now } : item);
  if (!items.some((item) => item.itemId === itemId)) throw new Error("Batch item was not found.");
  const next = { ...manifest, items, updatedAt: now };
  await persist(next);
  return next;
}
