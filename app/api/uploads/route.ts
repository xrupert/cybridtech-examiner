import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { checkExaminerAccessCode } from "@/lib/examiner-auth";

const ALLOWED_EXTENSIONS = /\.(pdf|txt|md)$/i;

export async function POST(request: Request): Promise<Response> {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return Response.json({ error: "Large-file storage is not configured. Connect the private Cybrid Title Blob store to this project." }, { status: 503 });
    }
    const body = await request.json() as HandleUploadBody;
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!ALLOWED_EXTENSIONS.test(pathname)) throw new Error("Cybrid Title accepts PDF, TXT, and MD title files only.");

        let accessCode = "";
        try {
          accessCode = String((JSON.parse(clientPayload || "{}") as { accessCode?: string }).accessCode || "");
        } catch {
          accessCode = "";
        }
        if (!checkExaminerAccessCode(accessCode)) throw new Error("Unauthorized Cybrid Title upload.");

        return {
          allowedContentTypes: [
            "application/pdf",
            "text/plain",
            "text/markdown",
            "application/octet-stream",
          ],
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ purpose: "cybrid-title" }),
        };
      },
      onUploadCompleted: async () => {
        // Processing routes delete temporary private blobs after OpenAI ingestion.
      },
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload authorization failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
