import type { PageEvidence } from "./vera";

const API_VERSION = "2024-11-30";

function average(values: number[]): number | undefined {
  if (!values.length) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function azureDocumentIntelligenceConfigured(): boolean {
  return Boolean(process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT && process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY);
}

export async function analyzeWithAzureDocumentIntelligence(buffer: ArrayBuffer): Promise<PageEvidence[]> {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT?.replace(/\/$/, "");
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
  if (!endpoint || !key) throw new Error("Azure Document Intelligence is not configured.");

  const analyzeUrl = `${endpoint}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=${API_VERSION}`;
  const start = await fetch(analyzeUrl, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/octet-stream" },
    body: Buffer.from(buffer),
  });
  if (!start.ok) throw new Error(`Azure Document Intelligence analyze request failed (${start.status}).`);
  const operationLocation = start.headers.get("operation-location");
  if (!operationLocation) throw new Error("Azure Document Intelligence did not return an operation location.");

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt < 5 ? 750 : 1250));
    const poll = await fetch(operationLocation, { headers: { "Ocp-Apim-Subscription-Key": key } });
    if (!poll.ok) throw new Error(`Azure Document Intelligence polling failed (${poll.status}).`);
    const result = await poll.json() as {
      status?: string;
      error?: { message?: string };
      analyzeResult?: { pages?: Array<{ pageNumber?: number; lines?: Array<{ content?: string }>; words?: Array<{ confidence?: number }> }> };
    };
    if (result.status === "failed") throw new Error(result.error?.message || "Azure Document Intelligence analysis failed.");
    if (result.status !== "succeeded") continue;

    return (result.analyzeResult?.pages || []).map((page, index) => {
      const confidence = average((page.words || []).map((word) => word.confidence).filter((value): value is number => typeof value === "number"));
      return {
        page: page.pageNumber || index + 1,
        text: (page.lines || []).map((line) => line.content || "").filter(Boolean).join("\n"),
        source: "azure-ocr" as const,
        confidence,
        documentType: "Unclassified",
      };
    });
  }
  throw new Error("Azure Document Intelligence timed out before returning analysis.");
}
