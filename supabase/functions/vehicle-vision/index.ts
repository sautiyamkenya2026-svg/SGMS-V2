import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { getGeminiGenerateContentUrl, getGeminiHeaders } from "../_shared/gemini-config.ts";
import { formatGeminiFailure } from "../_shared/gemini-error.ts";

type GeminiKey = { id: string | null; key: string; failureCount: number };
type GeminiKeyRow = { id: string; api_key: string; failure_count: number | null };
type GeminiTextPart = { text?: string };
type GeminiResponse = { candidates?: Array<{ content?: { parts?: GeminiTextPart[] } }> };
type VehicleVisionProblem = { area?: string; problem?: string; severity?: string };
type VehicleVisionResult = {
  make?: string;
  model?: string;
  year_guess?: string;
  color?: string;
  plate?: string;
  confidence?: number | string;
  visible_problems?: VehicleVisionProblem[];
};

function authClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
  );
}

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function requireUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const { data, error } = await authClient().auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function getGeminiKeyPool(): Promise<GeminiKey[]> {
  const sb = adminClient();
  try {
    const { data } = await sb.from("ai_keys")
      .select("id, api_key, failure_count, provider, active, last_used_at")
      .eq("provider", "gemini")
      .eq("active", true)
      .order("last_used_at", { ascending: true, nullsFirst: true });
    if (data?.length) {
      return data.map((row: GeminiKeyRow) => ({
        id: row.id,
        key: row.api_key,
        failureCount: Number(row.failure_count ?? 0),
      }));
    }
  } catch (error) {
    void error;
  }

  let key = "";
  try {
    const { data } = await sb.from("app_settings")
      .select("value")
      .eq("key", "gemini_api_key")
      .maybeSingle();
    key = data?.value ?? "";
  } catch (error) {
    void error;
  }

  if (!key) key = Deno.env.get("GEMINI_API_KEY") ?? "";
  return key ? [{ id: null, key, failureCount: 0 }] : [];
}

async function callGemini(body: Record<string, unknown>) {
  const pool = await getGeminiKeyPool();
  if (!pool.length) throw new Error("Gemini API key not configured");

  const sb = adminClient();
  let lastError = "";
  const url = getGeminiGenerateContentUrl();

  for (const entry of pool) {
    const resp = await fetch(url, {
      method: "POST",
      headers: getGeminiHeaders(entry.key),
      body: JSON.stringify(body),
    });

    if (resp.ok) {
      if (entry.id) {
        sb.from("ai_keys")
          .update({ last_used_at: new Date().toISOString(), failure_count: 0 })
          .eq("id", entry.id)
          .then(() => {});
      }
      return await resp.json();
    }

    lastError = await resp.text();
    if (entry.id) {
      sb.from("ai_keys")
        .update({
          last_used_at: new Date().toISOString(),
          failure_count: entry.failureCount + 1,
        })
        .eq("id", entry.id)
        .then(() => {});
    }
  }

  throw new Error(formatGeminiFailure(lastError, pool.length));
}

function toImageParts(images: string[]): Array<Record<string, unknown>> {
  return images.slice(0, 4).flatMap((url) => {
    const dataUrl = url.match(/^data:([^;]+);base64,(.+)$/);
    if (dataUrl) {
      return [{ inlineData: { mimeType: dataUrl[1], data: dataUrl[2] } }];
    }
    if (/^https?:\/\//i.test(url)) {
      return [{ text: `Reference image URL: ${url}` }];
    }
    return [];
  });
}

function extractText(json: GeminiResponse) {
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((part) => typeof part?.text === "string" ? part.text : "")
    .join("")
    .trim();
}

function parseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch (_) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Model did not return valid JSON");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const user = await requireUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { images } = await req.json() as { images: string[] };
    if (!Array.isArray(images) || images.length === 0) {
      return new Response(JSON.stringify({ error: "images[] required (data URLs or http URLs)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = [
      "You are an automotive intake assistant for a Mazda-friendly garage in Kenya.",
      "Look at the vehicle photos and return strict JSON only in this exact shape:",
      "{",
      '  "make": "",',
      '  "model": "",',
      '  "year_guess": "",',
      '  "color": "",',
      '  "plate": "",',
      '  "confidence": 0,',
      '  "visible_problems": [',
      '    { "area": "", "problem": "", "severity": "minor" }',
      "  ]",
      "}",
      "Rules:",
      "- Be conservative.",
      "- If you cannot read the plate or you are unsure of make/model/year, use an empty string.",
      "- Only list clearly visible issues such as dents, scratches, broken lights, flat tyres, leaks, missing trim, cracked glass, or rust.",
      '- severity must be "minor", "moderate", or "major".',
      "- confidence must be a number between 0 and 1.",
      "- Do not add markdown fences or commentary.",
    ].join("\n");

    const json = await callGemini({
      contents: [{
        role: "user",
        parts: [{ text: prompt }, ...toImageParts(images)],
      }],
      generationConfig: { responseMimeType: "application/json" },
    });

    const parsed = parseJson(extractText(json)) as VehicleVisionResult;
    const out = {
      make: typeof parsed?.make === "string" ? parsed.make : "",
      model: typeof parsed?.model === "string" ? parsed.model : "",
      year_guess: typeof parsed?.year_guess === "string" ? parsed.year_guess : "",
      color: typeof parsed?.color === "string" ? parsed.color : "",
      plate: typeof parsed?.plate === "string" ? parsed.plate : "",
      confidence: Number.isFinite(Number(parsed?.confidence)) ? Number(parsed.confidence) : 0,
      visible_problems: Array.isArray(parsed?.visible_problems)
        ? parsed.visible_problems
            .filter((item): item is VehicleVisionProblem => !!item && typeof item === "object")
            .map((item) => ({
              area: typeof item.area === "string" ? item.area : "",
              problem: typeof item.problem === "string" ? item.problem : "",
              severity: ["minor", "moderate", "major"].includes(item.severity) ? item.severity : "minor",
            }))
        : [],
      requested_by: user.id,
    };

    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("vehicle-vision error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
