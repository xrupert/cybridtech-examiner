import { database, databaseConfigured, transaction } from "./database";
import { clientInstanceConfig } from "./client-instance";
import { clientBlobPrefix } from "./client-instance";
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



function path(batchId: string): string {
  return `${clientBlobPrefix("batches-v1")}/${encodeURIComponent(batchId)}.json`;
}

async function persist(manifest: BatchManifest): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  await put(path(manifest.batchId), JSON.stringify(manifest), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
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
  if (databaseConfigured()) {
    await database().query("INSERT INTO vera_batches(client_id,id,manifest) VALUES($1,$2,$3)", [clientInstanceConfig().clientId, manifest.batchId, manifest]);
  } else {
    if (process.env.VERA_COMPLIANCE_MODE === "1") throw new Error("Durable batch storage is required.");
    await persist(manifest);
  }
  return manifest;
}

export async function loadBatchManifest(batchId: string): Promise<BatchManifest | null> {
  if (databaseConfigured()) {
    const result = await database().query("SELECT manifest FROM vera_batches WHERE client_id=$1 AND id=$2", [clientInstanceConfig().clientId, batchId]);
    return result.rows[0]?.manifest || null;
  }
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
  if (databaseConfigured()) return transaction(async (db) => {
    const scope = clientInstanceConfig().clientId;
    const result = await db.query("SELECT manifest FROM vera_batches WHERE client_id=$1 AND id=$2 FOR UPDATE", [scope, batchId]);
    const manifest = result.rows[0]?.manifest as BatchManifest | undefined;
    if (!manifest || !manifest.items.some((item) => item.itemId === itemId)) throw new Error("Batch item was not found.");
    const now = new Date().toISOString();
    const next = { ...manifest, updatedAt: now, items: manifest.items.map((item) => item.itemId === itemId ? { ...item, ...patch, updatedAt: now } : item) };
    await db.query("UPDATE vera_batches SET manifest=$3 WHERE client_id=$1 AND id=$2", [scope, batchId, next]);
    return next;
  });
  if (process.env.VERA_COMPLIANCE_MODE === "1") throw new Error("Durable batch storage is required.");
  const manifest = await loadBatchManifest(batchId);
  if (!manifest) throw new Error("Batch manifest was not found.");
  const now = new Date().toISOString();
  const items = manifest.items.map((item) => item.itemId === itemId ? { ...item, ...patch, updatedAt: now } : item);
  if (!items.some((item) => item.itemId === itemId)) throw new Error("Batch item was not found.");
  const next = { ...manifest, items, updatedAt: now };
  await persist(next);
  return next;
}
