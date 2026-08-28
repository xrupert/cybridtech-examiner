export type OpenAIProviderFailure = {
  status: number;
  code: string;
  error: string;
  retryable: boolean;
};

export function classifyOpenAIProviderFailure(message: string): OpenAIProviderFailure | null {
  const normalized = message.toLowerCase();
  const is429 = normalized.includes("openai request failed (429)") || normalized.includes("\"status\":429") || normalized.includes("status 429");
  const quotaExhausted = normalized.includes("insufficient_quota") || normalized.includes("credit_balance_exhausted") || normalized.includes("no credits remaining");

  if (quotaExhausted) {
    return {
      status: 503,
      code: "OPENAI_CREDITS_EXHAUSTED",
      error: "OpenAI API credits are exhausted. The title packet was not reviewed. Add API credits, then retry the review.",
      retryable: true,
    };
  }

  if (is429) {
    return {
      status: 503,
      code: "OPENAI_RATE_LIMITED",
      error: "OpenAI temporarily rate-limited the review. Wait a moment, then retry the same packet.",
      retryable: true,
    };
  }

  return null;
}
