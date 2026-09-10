import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { checkExaminerAccessCode } from "@/lib/examiner-auth";
import { assertUploadPaths, MAX_UPLOAD_BYTES } from "@/lib/upload-paths";

const ALLOWED_EXTENSIONS = /\.pdf$/i;

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
        if (!ALLOWED_EXTENSIONS.test(pathname)) throw new Error("Cybrid Title accepts PDF title files only.");

        let accessCode = "";
        try {
          accessCode = String((JSON.parse(clientPayload || "{}") as { accessCode?: string }).accessCode || "");
        } catch {
          accessCode = "";
        }
        if (!checkExaminerAccessCode(accessCode)) throw new Error("Unauthorized Cybrid Title upload.");
        assertUploadPaths([pathname]);

        return {
          allowedContentTypes: [
            "application/pdf",
            "application/octet-stream",
          ],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({ purpose: "cybrid-title" }),
        };
      },
      onUploadCompleted: async () => {
        // Source uploads are retained until an explicit retention policy removes them.
      },
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload authorization failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
