export type FailureClass =
  | "NATIVE_EXTRACTION_INSUFFICIENT"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_TRANSIENT"
  | "CLASSIFICATION_AMBIGUOUS"
  | "GROUNDING_UNSUPPORTED"
  | "BATCH_ITEM_FAILED"
  | "INVALID_INPUT";

export type RecoveryAction =
  | "FALLBACK_TO_VISION"
  | "RETRY_PROVIDER"
  | "REQUIRE_HUMAN_PROFILE"
  | "REDUCE_TO_CANNOT_CONFIRM"
  | "ISOLATE_AND_CONTINUE_BATCH"
  | "STOP";

export interface LoopDecision {
  action: RecoveryAction;
  retry: boolean;
  maxAttempts: number;
  reason: string;
}

const POLICY: Record<FailureClass, LoopDecision> = {
  NATIVE_EXTRACTION_INSUFFICIENT: {
    action: "FALLBACK_TO_VISION",
    retry: false,
    maxAttempts: 1,
    reason: "Native extraction is a capability check, not a reason to loop. Use the scan/vision path once.",
  },
  PROVIDER_RATE_LIMIT: {
    action: "RETRY_PROVIDER",
    retry: true,
    maxAttempts: 2,
    reason: "Retry a bounded number of times using provider backoff; never spin indefinitely.",
  },
  PROVIDER_TRANSIENT: {
    action: "RETRY_PROVIDER",
    retry: true,
    maxAttempts: 2,
    reason: "One bounded provider retry is allowed for transient 5xx/network failures.",
  },
  CLASSIFICATION_AMBIGUOUS: {
    action: "REQUIRE_HUMAN_PROFILE",
    retry: false,
    maxAttempts: 1,
    reason: "Ambiguous state/order/target-lien classification must fail closed to examiner selection rather than self-guessing.",
  },
  GROUNDING_UNSUPPORTED: {
    action: "REDUCE_TO_CANNOT_CONFIRM",
    retry: false,
    maxAttempts: 1,
    reason: "An unsupported conclusion is reduced to Cannot Confirm; repeated model calls are not evidence.",
  },
  BATCH_ITEM_FAILED: {
    action: "ISOLATE_AND_CONTINUE_BATCH",
    retry: false,
    maxAttempts: 1,
    reason: "One bad title packet must not terminate the rest of a batch.",
  },
  INVALID_INPUT: {
    action: "STOP",
    retry: false,
    maxAttempts: 1,
    reason: "Invalid input requires correction rather than automated retry.",
  },
};

export function loopDecision(failure: FailureClass): LoopDecision {
  return POLICY[failure];
}

export function mayRetry(failure: FailureClass, completedAttempts: number): boolean {
  const decision = loopDecision(failure);
  return decision.retry && completedAttempts < decision.maxAttempts;
}

export const LOOP_CONTRACT = [
  "No unbounded retries",
  "A repeated model answer is not new evidence",
  "Extraction insufficiency changes extraction method instead of looping",
  "Classification ambiguity routes to a human",
  "Unsupported grounding reduces to Cannot Confirm",
  "Batch failures are isolated per packet",
] as const;
