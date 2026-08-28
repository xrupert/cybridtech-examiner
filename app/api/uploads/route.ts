import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { checkExaminerAccessCode } from "@/lib/examiner-auth";

export async function POST(request: Request): Promise<Response> {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return Response.json({ error: "Large-file storage is not configured. Create a private Vercel Blob store for this project." }, { status: 503 });
    }
    const body = await request.json() as HandleUploadBody;
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        let accessCode = "";
        try {
          accessCode = String((JSON.parse(clientPayload || "{}") as { accessCode?: string }).accessCode || "");
        } catch {
          accessCode = "";
        }
        if (!checkExaminerAccessCode(accessCode)) throw new Error("Unauthorized Examiner upload.");
        return {
          allowedContentTypes: ["application/pdf", "text/plain", "text/markdown"],
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ purpose: "cybridtech-title-examiner" }),
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
