export type AIProviderName = "gemini" | "groq";

type GeminiErrorEnvelope = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<Record<string, unknown>>;
  };
};

type GroqErrorEnvelope = {
  error?: {
    message?: string;
    type?: string;
    code?: string | number;
  };
};

type ProviderFailure = {
  provider: AIProviderName;
  message: string;
};

function tryParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function extractRetryDelay(details: Array<Record<string, unknown>>) {
  const retryInfo = details.find((detail) =>
    String(detail?.["@type"] ?? "").includes("RetryInfo")
  );

  const rawDelay = retryInfo?.retryDelay;
  return typeof rawDelay === "string" && rawDelay.trim() ? rawDelay.trim() : null;
}

function hasGeminiQuotaMarker(raw: string, details: Array<Record<string, unknown>>) {
  const serializedDetails = JSON.stringify(details);
  return (
    /quota|rate limit|resource_exhausted/i.test(raw) ||
    /GenerateRequestsPerDayPerProjectPerModel-FreeTier/i.test(serializedDetails) ||
    /GenerateContentInputTokensPerModelPerMinute-FreeTier/i.test(serializedDetails) ||
    /GenerateRequestsPerMinutePerProjectPerModel-FreeTier/i.test(serializedDetails)
  );
}

export function formatGeminiFailure(rawError: string, attemptedKeys: number) {
  const parsed = tryParseJson<GeminiErrorEnvelope>(rawError);
  const err = parsed?.error;
  const message = typeof err?.message === "string" && err.message.trim()
    ? err.message.trim()
    : rawError.trim();
  const details = Array.isArray(err?.details) ? err.details : [];
  const retryDelay = extractRetryDelay(details);
  const isQuotaError =
    err?.code === 429 ||
    err?.status === "RESOURCE_EXHAUSTED" ||
    hasGeminiQuotaMarker(message || rawError, details);

  if (isQuotaError) {
    if (retryDelay) {
      return `The AI assistant is briefly busy. Retry after about ${retryDelay}.`;
    }

    return "The AI assistant is briefly busy right now. Please retry in a moment.";
  }

  if (err?.code === 401 || err?.code === 403 || /api key|permission/i.test(message)) {
    return "The AI assistant is not available right now.";
  }

  return message || "The AI assistant could not complete that request.";
}

export function formatGroqFailure(rawError: string, attemptedKeys: number) {
  const parsed = tryParseJson<GroqErrorEnvelope>(rawError);
  const err = parsed?.error;
  const message = typeof err?.message === "string" && err.message.trim()
    ? err.message.trim()
    : rawError.trim();
  const normalized = `${message} ${rawError}`.toLowerCase();
  if (/429|rate limit|quota|resource exhausted|too many requests/.test(normalized)) {
    return "The AI assistant is briefly busy right now. Please retry in a moment.";
  }

  if (/401|403|api key|unauthorized|forbidden|invalid api key/.test(normalized)) {
    return "The AI assistant is not available right now.";
  }

  return message || "The AI assistant could not complete that request.";
}

export function formatProviderFailure(provider: AIProviderName, rawError: string, attemptedKeys: number) {
  return provider === "groq"
    ? formatGroqFailure(rawError, attemptedKeys)
    : formatGeminiFailure(rawError, attemptedKeys);
}

export function formatAggregateProviderFailure(failures: ProviderFailure[]) {
  if (failures.length === 0) return "The AI assistant is not available right now.";
  if (failures.length === 1) return failures[0].message;
  return "The AI assistant is not available right now. Please try again shortly.";
}
