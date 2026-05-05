const DEFAULT_GEMINI_API_VERSION = "v1beta";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

function normalizedEnv(name: string, fallback: string) {
  const value = Deno.env.get(name)?.trim();
  return value ? value : fallback;
}

export function getGeminiGenerateContentUrl() {
  const version = normalizedEnv("GEMINI_API_VERSION", DEFAULT_GEMINI_API_VERSION);
  const model = normalizedEnv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).replace(/^models\//, "");
  return `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent`;
}

export function getGeminiHeaders(apiKey: string) {
  return {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
  };
}
