type GeminiErrorEnvelope = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<Record<string, unknown>>;
  };
};

function tryParseJson(raw: string): GeminiErrorEnvelope | null {
  try {
    return JSON.parse(raw) as GeminiErrorEnvelope;
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

function hasQuotaMarker(raw: string, details: Array<Record<string, unknown>>) {
  const serializedDetails = JSON.stringify(details);
  return (
    /quota|rate limit|resource_exhausted/i.test(raw) ||
    /GenerateRequestsPerDayPerProjectPerModel-FreeTier/i.test(serializedDetails) ||
    /GenerateContentInputTokensPerModelPerMinute-FreeTier/i.test(serializedDetails) ||
    /GenerateRequestsPerMinutePerProjectPerModel-FreeTier/i.test(serializedDetails)
  );
}

export function formatGeminiFailure(rawError: string, attemptedKeys: number) {
  const parsed = tryParseJson(rawError);
  const err = parsed?.error;
  const message = typeof err?.message === "string" && err.message.trim()
    ? err.message.trim()
    : rawError.trim();
  const details = Array.isArray(err?.details) ? err.details : [];
  const retryDelay = extractRetryDelay(details);
  const isQuotaError =
    err?.code === 429 ||
    err?.status === "RESOURCE_EXHAUSTED" ||
    hasQuotaMarker(message || rawError, details);

  if (isQuotaError) {
    const keyLabel = attemptedKeys > 1 ? "all configured AI keys" : "the configured AI key";
    const hasDailyOrZeroQuota =
      /GenerateRequestsPerDayPerProjectPerModel-FreeTier/i.test(JSON.stringify(details)) ||
      /limit:\s*0/i.test(rawError);

    if (hasDailyOrZeroQuota) {
      return [
        `Gemini quota exhausted for ${keyLabel}.`,
        "This Google AI project currently has no usable free-tier quota.",
        "Add a billed Gemini key or a key from a different Google AI project in Users > AI Keys.",
        "If several keys belong to the same Google project, rotating them will not help because they share quota.",
      ].join(" ");
    }

    if (retryDelay) {
      return [
        `Gemini rate limit hit for ${keyLabel}.`,
        `Retry after about ${retryDelay}.`,
        "If this keeps happening, add another active key from a different Google AI project.",
      ].join(" ");
    }

    return [
      `Gemini quota exhausted for ${keyLabel}.`,
      "Wait a bit and retry, or switch to another active key from a different Google AI project.",
    ].join(" ");
  }

  if (err?.code === 401 || err?.code === 403 || /api key|permission/i.test(message)) {
    return "Gemini API key is invalid, disabled, or not allowed for this API.";
  }

  return message || "Gemini request failed.";
}
