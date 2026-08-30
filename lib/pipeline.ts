export const PIPELINE_STAGES = [
  "INGEST",
  "EXTRACT",
  "CLASSIFY",
  "NORMALIZE",
  "CHECK",
  "GROUND",
  "RENDER",
  "RECORD",
  "COMPLETE",
  "FAILED",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface PipelineTransition {
  from: PipelineStage | "START";
  to: PipelineStage;
  at: string;
  detail?: string;
}

export interface PipelineState {
  stage: PipelineStage | "START";
  transitions: PipelineTransition[];
  failed: boolean;
  failureReason?: string;
}

const NEXT: Record<PipelineStage | "START", readonly PipelineStage[]> = {
  START: ["INGEST", "FAILED"],
  INGEST: ["EXTRACT", "FAILED"],
  EXTRACT: ["CLASSIFY", "FAILED"],
  CLASSIFY: ["NORMALIZE", "FAILED"],
  NORMALIZE: ["CHECK", "FAILED"],
  CHECK: ["GROUND", "FAILED"],
  GROUND: ["RENDER", "FAILED"],
  RENDER: ["RECORD", "FAILED"],
  RECORD: ["COMPLETE", "FAILED"],
  COMPLETE: [],
  FAILED: [],
};

export function createPipelineState(): PipelineState {
  return { stage: "START", transitions: [], failed: false };
}

export function canTransition(from: PipelineStage | "START", to: PipelineStage): boolean {
  return NEXT[from].includes(to);
}

export function advancePipeline(state: PipelineState, to: PipelineStage, detail?: string): PipelineState {
  if (!canTransition(state.stage, to)) throw new Error(`Illegal Cybrid Title pipeline transition: ${state.stage} -> ${to}`);
  const transition: PipelineTransition = { from: state.stage, to, at: new Date().toISOString(), detail };
  return {
    stage: to,
    transitions: [...state.transitions, transition],
    failed: to === "FAILED",
    failureReason: to === "FAILED" ? detail || "Pipeline failed" : state.failureReason,
  };
}

export function assertCanonicalPipeline(state: PipelineState): void {
  if (state.stage !== "COMPLETE") throw new Error(`Pipeline did not complete; stopped at ${state.stage}.`);
  const stages = state.transitions.map((transition) => transition.to);
  const expected: PipelineStage[] = ["INGEST", "EXTRACT", "CLASSIFY", "NORMALIZE", "CHECK", "GROUND", "RENDER", "RECORD", "COMPLETE"];
  if (stages.length !== expected.length || stages.some((stage, index) => stage !== expected[index])) {
    throw new Error(`Pipeline violated canonical order. Expected ${expected.join(" -> ")}; received ${stages.join(" -> ")}.`);
  }
}

export const PIPELINE_CONTRACT = "INGEST -> EXTRACT -> CLASSIFY -> NORMALIZE -> CHECK -> GROUND -> RENDER -> RECORD -> COMPLETE";
