import { assertClientScope } from "@/lib/client-instance";
import { issueUploadPath } from "@/lib/upload-paths";

export async function POST(request: Request) {
  try {
    assertClientScope();
    const body = await request.json();
    return Response.json({ pathname: issueUploadPath(body?.filename) });
  } catch {
    return Response.json({ error: "Could not authorize a PDF upload. Check the filename and client storage configuration." }, { status: 400 });
  }
}
