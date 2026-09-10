import { get, put } from "@vercel/blob";
import type { PacketExtractionLedger } from "./document-engine";
import type { TitleReviewResult } from "./title-domain";
import type { TitleEvidenceLedger } from "./title-extraction-model";
import { buildTitleEvidenceGraph, type TitleEvidenceGraph } from "./title-evidence-graph";
import { clientBlobPrefix } from "./client-instance";

export interface ReviewDossier {
  version: 1 | 2;
  reviewId: string;
  packetHash: string;
  sourceFile: string;
  createdAt: string;
  review: TitleReviewResult;
  evidenceLedger: TitleEvidenceLedger;
  pageLedger: PacketExtractionLedger;
  graph?: TitleEvidenceGraph;
}

function dossierPath(reviewId: string): string {
  return `${clientBlobPrefix("review-dossiers-v1")}/${encodeURIComponent(reviewId)}.json`;
}

export async function saveReviewDossier(args: {
  review: TitleReviewResult;
  evidenceLedger: TitleEvidenceLedger;
  pageLedger: PacketExtractionLedger;
}): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  const dossier: ReviewDossier = {
    version: 2,
    reviewId: args.review.record.reviewId,
    packetHash: args.review.record.packetHash,
    sourceFile: args.review.record.sourceFile,
    createdAt: new Date().toISOString(),
    review: args.review,
    evidenceLedger: args.evidenceLedger,
    pageLedger: args.pageLedger,
    graph: buildTitleEvidenceGraph(args.review, args.evidenceLedger),
  };
  await put(dossierPath(dossier.reviewId), JSON.stringify(dossier), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function loadReviewDossier(reviewId: string): Promise<ReviewDossier | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN || !reviewId) return null;
  try {
    const result = await get(dossierPath(reviewId), { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const parsed = await new Response(result.stream).json() as ReviewDossier;
    if ((parsed?.version !== 1 && parsed?.version !== 2) || parsed.reviewId !== reviewId) return null;
    if (!parsed.graph) parsed.graph = buildTitleEvidenceGraph(parsed.review, parsed.evidenceLedger);
    return parsed;
  } catch {
    return null;
  }
}
