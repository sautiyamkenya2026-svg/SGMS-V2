import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  formatAggregateProviderFailure,
  formatProviderFailure,
  type AIProviderName,
} from "./ai-error.ts";

export type AITaskType = "default" | "fast_chat" | "analysis" | "image";
export type AIMessageRole = "system" | "user" | "assistant" | "tool";

export type AIMessagePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url?: { url?: string } };

export type AIToolCall = {
  id: string;
  type: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
};

export type AIChatMessage = {
  role: AIMessageRole;
  content: string | AIMessagePart[];
  tool_calls?: AIToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type AIToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type AIRequest = {
  taskType: AITaskType;
  messages: AIChatMessage[];
  tools?: AIToolDefinition[];
  jsonMode?: "object";
  temperature?: number;
  maxOutputTokens?: number;
};

export type AIResponse = {
  role: "assistant";
  content: string;
  tool_calls?: AIToolCall[];
  provider: AIProviderName;
  modeLabel: string;
};

type AISettingsRow = {
  key: string;
  value: string | null;
};

type AIRuntimeSettings = {
  defaultProvider: AIProviderName;
  chatProvider: AIProviderName;
  analysisProvider: AIProviderName;
  imageProvider: AIProviderName;
  geminiApiVersion: string;
  geminiModel: string;
  groqTextModel: string;
  groqVisionModel: string;
  fallbackKeys: Record<AIProviderName, string>;
};

type AIKeyEntry = {
  id: string | null;
  provider: AIProviderName;
  key: string;
  failureCount: number;
};

type AIKeyRow = {
  id: string;
  api_key: string;
  failure_count: number | null;
};

type ProviderFailure = {
  provider: AIProviderName;
  message: string;
};

type GroqResponseContentPart = {
  text?: string;
};

interface AIProvider {
  readonly name: AIProviderName;
  generate(request: AIRequest, apiKey: string): Promise<AIResponse>;
}

const PROVIDERS: AIProviderName[] = ["groq", "gemini"];
const SETTINGS_KEYS = [
  "ai_default_provider",
  "ai_chat_provider",
  "ai_analysis_provider",
  "ai_image_provider",
  "gemini_api_key",
  "groq_api_key",
] as const;

function normalizeProvider(value: string | null | undefined, fallback: AIProviderName): AIProviderName {
  return value === "groq" || value === "gemini" ? value : fallback;
}

function readEnvOrSetting(
  envName: string,
  settingKey: string,
  settings: Map<string, string>,
  fallback: string,
) {
  const envValue = Deno.env.get(envName)?.trim();
  if (envValue) return envValue;
  const settingValue = settings.get(settingKey)?.trim();
  return settingValue || fallback;
}

function modeLabelForProvider(provider: AIProviderName) {
  return provider === "groq" ? "Fast Mode" : "Smart Mode";
}

async function loadRuntimeSettings(sb: SupabaseClient): Promise<AIRuntimeSettings> {
  const settingsMap = new Map<string, string>();

  try {
    const { data } = await sb
      .from("app_settings")
      .select("key, value")
      .in("key", [...SETTINGS_KEYS]);

    for (const row of (data ?? []) as AISettingsRow[]) {
      if (row.key && typeof row.value === "string") settingsMap.set(row.key, row.value);
    }
  } catch (_) {
    // Env defaults still work if app_settings cannot be read.
  }

  const defaultProvider = normalizeProvider(
    readEnvOrSetting("AI_DEFAULT_PROVIDER", "ai_default_provider", settingsMap, "groq"),
    "groq",
  );

  return {
    defaultProvider,
    chatProvider: normalizeProvider(
      readEnvOrSetting("AI_CHAT_PROVIDER", "ai_chat_provider", settingsMap, defaultProvider),
      defaultProvider,
    ),
    analysisProvider: normalizeProvider(
      readEnvOrSetting("AI_ANALYSIS_PROVIDER", "ai_analysis_provider", settingsMap, "gemini"),
      "gemini",
    ),
    imageProvider: normalizeProvider(
      readEnvOrSetting("AI_IMAGE_PROVIDER", "ai_image_provider", settingsMap, "gemini"),
      "gemini",
    ),
    geminiApiVersion: readEnvOrSetting("GEMINI_API_VERSION", "", settingsMap, "v1beta"),
    geminiModel: readEnvOrSetting("GEMINI_MODEL", "", settingsMap, "gemini-2.5-flash").replace(/^models\//, ""),
    groqTextModel: readEnvOrSetting("GROQ_MODEL", "", settingsMap, "llama-3.1-8b-instant"),
    groqVisionModel: readEnvOrSetting(
      "GROQ_VISION_MODEL",
      "",
      settingsMap,
      "meta-llama/llama-4-scout-17b-16e-instruct",
    ),
    fallbackKeys: {
      gemini: readEnvOrSetting("GEMINI_API_KEY", "gemini_api_key", settingsMap, ""),
      groq: readEnvOrSetting("GROQ_API_KEY", "groq_api_key", settingsMap, ""),
    },
  };
}

async function getProviderKeyPool(
  sb: SupabaseClient,
  provider: AIProviderName,
  fallbackKey: string,
): Promise<AIKeyEntry[]> {
  try {
    const { data } = await sb
      .from("ai_keys")
      .select("id, api_key, failure_count, provider, active, last_used_at")
      .eq("provider", provider)
      .eq("active", true)
      .order("last_used_at", { ascending: true, nullsFirst: true });

    if (data?.length) {
      return (data as AIKeyRow[]).map((row) => ({
        id: row.id,
        provider,
        key: row.api_key,
        failureCount: Number(row.failure_count ?? 0),
      }));
    }
  } catch (_) {
    // Fall through to the legacy single-key fallback.
  }

  return fallbackKey
    ? [{ id: null, provider, key: fallbackKey, failureCount: 0 }]
    : [];
}

function recordKeySuccess(sb: SupabaseClient, entry: AIKeyEntry) {
  if (!entry.id) return;
  sb.from("ai_keys")
    .update({ last_used_at: new Date().toISOString(), failure_count: 0 })
    .eq("id", entry.id)
    .then(() => {});
}

function recordKeyFailure(sb: SupabaseClient, entry: AIKeyEntry) {
  if (!entry.id) return;
  sb.from("ai_keys")
    .update({
      last_used_at: new Date().toISOString(),
      failure_count: entry.failureCount + 1,
    })
    .eq("id", entry.id)
    .then(() => {});
}

function uniqueProviders(providers: AIProviderName[]) {
  return providers.filter((provider, index) => providers.indexOf(provider) === index);
}

function getProviderOrder(taskType: AITaskType, settings: AIRuntimeSettings) {
  const preferredProvider = (() => {
    switch (taskType) {
      case "fast_chat":
        return settings.chatProvider;
      case "analysis":
        return settings.analysisProvider;
      case "image":
        return settings.imageProvider;
      default:
        return settings.defaultProvider;
    }
  })();

  return uniqueProviders([preferredProvider, settings.defaultProvider, ...PROVIDERS]);
}

function normalizeStringContent(content: string | AIMessagePart[]) {
  if (typeof content === "string") return content;
  return content
    .map((part) => part.type === "text" ? part.text : "")
    .join("\n")
    .trim();
}

class GeminiProvider implements AIProvider {
  readonly name = "gemini" as const;

  constructor(private readonly settings: AIRuntimeSettings) {}

  async generate(request: AIRequest, apiKey: string): Promise<AIResponse> {
    const url =
      `https://generativelanguage.googleapis.com/${this.settings.geminiApiVersion}/models/${this.settings.geminiModel}:generateContent`;
    const body: Record<string, unknown> = this.toRequestBody(request);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) throw new Error(await response.text());

    const json = await response.json();
    const candidate = json?.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    let text = "";
    const toolCalls: AIToolCall[] = [];

    for (const part of parts) {
      if (typeof part?.text === "string") text += part.text;
      if (part?.functionCall) {
        toolCalls.push({
          id: `call_${toolCalls.length}_${Date.now()}`,
          type: "function",
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args ?? {}),
          },
        });
      }
    }

    return {
      role: "assistant",
      content: text.trim(),
      tool_calls: toolCalls.length ? toolCalls : undefined,
      provider: this.name,
      modeLabel: modeLabelForProvider(this.name),
    };
  }

  private toRequestBody(request: AIRequest) {
    const systemMessage = request.messages.find((message) => message.role === "system");
    const contents: Array<Record<string, unknown>> = [];

    for (const message of request.messages) {
      if (message.role === "system") continue;

      if (message.role === "tool") {
        contents.push({
          role: "user",
          parts: [{
            functionResponse: {
              name: message.name ?? "tool",
              response: { content: normalizeStringContent(message.content) },
            },
          }],
        });
        continue;
      }

      const role = message.role === "assistant" ? "model" : "user";
      const parts: Array<Record<string, unknown>> = [];

      if (message.tool_calls?.length) {
        for (const toolCall of message.tool_calls) {
          let args = {};
          try {
            args = JSON.parse(toolCall.function?.arguments ?? "{}");
          } catch {
            args = {};
          }
          parts.push({
            functionCall: {
              name: toolCall.function?.name,
              args,
            },
          });
        }
      } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === "text") {
            parts.push({ text: part.text });
            continue;
          }

          const url = part.image_url?.url ?? "";
          const match = url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
          } else if (/^https?:\/\//i.test(url)) {
            parts.push({ text: `Reference image URL: ${url}` });
          }
        }
      } else {
        parts.push({ text: String(message.content ?? "") });
      }

      if (parts.length) contents.push({ role, parts });
    }

    const body: Record<string, unknown> = {
      contents,
    };

    if (systemMessage) {
      body.systemInstruction = {
        parts: [{ text: normalizeStringContent(systemMessage.content) }],
      };
    }

    if (request.tools?.length) {
      body.tools = [{
        functionDeclarations: request.tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        })),
      }];
    }

    if (request.jsonMode === "object") {
      body.generationConfig = { responseMimeType: "application/json" };
    }

    return body;
  }
}

class GroqProvider implements AIProvider {
  readonly name = "groq" as const;

  constructor(private readonly settings: AIRuntimeSettings) {}

  async generate(request: AIRequest, apiKey: string): Promise<AIResponse> {
    const body: Record<string, unknown> = {
      model: request.taskType === "image" ? this.settings.groqVisionModel : this.settings.groqTextModel,
      messages: this.toRequestMessages(request.messages),
    };

    if (request.tools?.length) {
      body.tools = request.tools;
      body.tool_choice = "auto";
    }

    if (request.jsonMode === "object") {
      body.response_format = { type: "json_object" };
    }

    if (typeof request.temperature === "number") {
      body.temperature = request.temperature;
    }

    if (typeof request.maxOutputTokens === "number") {
      body.max_completion_tokens = request.maxOutputTokens;
    }

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) throw new Error(await response.text());

    const json = await response.json();
    const message = json?.choices?.[0]?.message;
    const content = typeof message?.content === "string"
      ? message.content
      : Array.isArray(message?.content)
        ? (message.content as GroqResponseContentPart[])
            .map((part) => typeof part?.text === "string" ? part.text : "")
            .join("")
        : "";

    return {
      role: "assistant",
      content: content.trim(),
      tool_calls: Array.isArray(message?.tool_calls) && message.tool_calls.length
        ? message.tool_calls as AIToolCall[]
        : undefined,
      provider: this.name,
      modeLabel: modeLabelForProvider(this.name),
    };
  }

  private toRequestMessages(messages: AIChatMessage[]) {
    return messages.map((message) => {
      if (message.role === "tool") {
        return {
          role: "tool",
          tool_call_id: message.tool_call_id,
          name: message.name,
          content: normalizeStringContent(message.content),
        };
      }

      const base: Record<string, unknown> = {
        role: message.role,
        content: Array.isArray(message.content)
          ? message.content
          : String(message.content ?? ""),
      };

      if (message.role === "assistant" && message.tool_calls?.length) {
        base.tool_calls = message.tool_calls;
      }

      return base;
    });
  }
}

function createProvider(provider: AIProviderName, settings: AIRuntimeSettings): AIProvider {
  return provider === "groq"
    ? new GroqProvider(settings)
    : new GeminiProvider(settings);
}

export async function generateAIResponse(
  sb: SupabaseClient,
  request: AIRequest,
): Promise<AIResponse> {
  const settings = await loadRuntimeSettings(sb);
  const failures: ProviderFailure[] = [];

  for (const providerName of getProviderOrder(request.taskType, settings)) {
    const keyPool = await getProviderKeyPool(sb, providerName, settings.fallbackKeys[providerName]);
    if (!keyPool.length) {
      failures.push({
        provider: providerName,
        message: `No active ${providerName} API key is configured for this route.`,
      });
      continue;
    }

    const provider = createProvider(providerName, settings);
    let lastRawError = "";

    for (const entry of keyPool) {
      try {
        const response = await provider.generate(request, entry.key);
        recordKeySuccess(sb, entry);
        return response;
      } catch (error) {
        lastRawError = error instanceof Error ? error.message : String(error);
        console.warn(`${providerName} key failed (${entry.id ?? "legacy"}):`, lastRawError);
        recordKeyFailure(sb, entry);
      }
    }

    failures.push({
      provider: providerName,
      message: formatProviderFailure(providerName, lastRawError, keyPool.length),
    });
  }

  throw new Error(formatAggregateProviderFailure(failures));
}
