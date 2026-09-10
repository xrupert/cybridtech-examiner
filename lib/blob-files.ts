import { del, get } from "@vercel/blob";
import { assertUploadPaths, MAX_UPLOAD_BYTES } from "./upload-paths";

export async function filesFromPrivateBlobs(pathnames: string[]): Promise<File[]> {
  assertUploadPaths(pathnames);
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Large-file storage is not configured.");
  const files: File[] = [];
  for (const pathname of pathnames) {
    const result = await get(pathname, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) throw new Error(`Could not read uploaded file: ${pathname}`);
    if (result.blob.size > MAX_UPLOAD_BYTES) throw new Error("INVALID_UPLOAD: PDF exceeds the size limit.");
    const bytes = await new Response(result.stream).arrayBuffer();
    const name = result.blob.pathname.split("/").pop() || "title-document.pdf";
    files.push(new File([bytes], name, { type: result.blob.contentType || "application/octet-stream" }));
  }
  return files;
}

export async function deletePrivateBlobs(pathnames: string[]): Promise<void> {
  if (!pathnames.length || !process.env.BLOB_READ_WRITE_TOKEN) return;
  assertUploadPaths(pathnames);
  try {
    await del(pathnames);
  } catch {
    // Temporary upload cleanup failure should not erase a completed title review.
  }
}
