import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { formatGeminiFailure } from "../_shared/gemini-error.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type GeminiKey = { id: string | null; key: string; failureCount: number };
type GeminiKeyRow = { id: string; api_key: string; failure_count: number | null };
type GeminiTextPart = { text?: string };
type GeminiResponse = { candidates?: Array<{ content?: { parts?: GeminiTextPart[] } }> };
type Finding = { severity?: string; system?: string; part?: string; subpart?: string; note?: string; status?: string };
type OBDCode = { code?: string; severity?: string; system?: string; meaning?: string };
type SummaryPart = { name?: string; qty?: number | string; reason?: string; severity?: string };
type SummaryResult = { summary?: string; parts?: SummaryPart[] };

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

  for (const entry of pool) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${entry.key}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const user = await requireUser(req);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json() as {
      vehicle?: string;
      plate?: string;
      reported_problem?: string;
      findings?: Finding[];
      obd_codes?: OBDCode[];
    };
    const {
      vehicle = "",
      plate = "",
      reported_problem = "",
      findings = [],
      obd_codes = [],
    } = body ?? {};

    const prompt = `
Vehicle: ${vehicle} (${plate})
Reported problem: ${reported_problem || "(not provided)"}

Manual inspection findings (issues only):
    ${findings.length === 0 ? "(none)" : findings.map((f, i) =>
  `${i + 1}. [${f.severity ?? "medium"}] ${f.system} -> ${f.part}${f.subpart ? " / " + f.subpart : ""} - ${f.note || f.status}`
).join("\n")}

OBD-II codes:
    ${obd_codes.length === 0 ? "(none)" : obd_codes.map((c) =>
  `- ${c.code} (${c.severity ?? "medium"}, ${c.system ?? ""}): ${c.meaning}`
).join("\n")}

Return STRICT JSON ONLY in this exact shape (no prose before or after):
{
  "summary": "2-4 short paragraphs in plain English. Say what is wrong, why, urgency, and what should be done.",
  "parts": [
    { "name": "Brake pads - front", "qty": 1, "reason": "worn below 2mm", "severity": "high" }
  ]
}

Rules:
- Only suggest parts that directly address the findings or codes.
- Include normal companion consumables when they are clearly required.
- Use plain shop names, not fault codes.
- qty must be an integer.
- severity must be "low", "medium", or "high".
- If nothing needs replacement, return "parts": [].
- Do not add markdown fences or commentary.
`.trim();

    const data = await callGemini({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: { responseMimeType: "application/json" },
    });

    const parsed = parseJson(extractText(data)) as SummaryResult;
    const out = {
      requested_by: user.id,
      summary: typeof parsed?.summary === "string" ? parsed.summary : "",
      parts: Array.isArray(parsed?.parts)
        ? parsed.parts
            .filter((part): part is SummaryPart => !!part && !!part.name)
            .map((part) => ({
              name: String(part.name),
              qty: Number(part.qty || 1),
              reason: String(part.reason || ""),
              severity: ["low", "medium", "high"].includes(part.severity) ? part.severity : "medium",
            }))
        : [],
    };

    return json(out, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(o: unknown, status: number) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
