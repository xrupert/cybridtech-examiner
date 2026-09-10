import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { clientBlobPrefix } from "./client-instance";

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

function signature(value: string): string {
  const key = process.env.BLOB_READ_WRITE_TOKEN;
  if (!key) throw new Error("Upload storage is not configured.");
  return createHmac("sha256", key).update(`vera-upload-v1:${value}`).digest("hex");
}

export function issueUploadPath(filename: string): string {
  if (typeof filename !== "string" || !/\.pdf$/i.test(filename)) throw new Error("A PDF filename is required.");
  const name = filename.replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100) || "packet";
  const unsigned = `${clientBlobPrefix("uploads")}/${randomUUID()}/${name}.pdf`;
  return `${unsigned.slice(0, -4)}-${signature(unsigned)}.pdf`;
}

export function assertUploadPaths(values: unknown): asserts values is string[] {
  if (!Array.isArray(values) || values.length !== 1) throw new Error("INVALID_UPLOAD: exactly one authorized PDF upload is required.");
  const pathname = values[0];
  const prefix = `${clientBlobPrefix("uploads")}/`;
  if (typeof pathname !== "string" || !pathname.startsWith(prefix)) throw new Error("INVALID_UPLOAD: upload belongs to a different scope.");
  const match = pathname.slice(prefix.length).match(/^([a-f0-9-]{36})\/([a-zA-Z0-9_-]{1,100})-([a-f0-9]{64})\.pdf$/);
  if (!match) throw new Error("INVALID_UPLOAD: invalid upload identifier.");
  const unsigned = `${prefix}${match[1]}/${match[2]}.pdf`;
  if (!timingSafeEqual(Buffer.from(match[3], "hex"), Buffer.from(signature(unsigned), "hex"))) {
    throw new Error("INVALID_UPLOAD: upload authorization is invalid.");
  }
}
