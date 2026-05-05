import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { generateAIResponse, type AIMessagePart } from "../_shared/ai-router.ts";

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

function toImageParts(images: string[]): AIMessagePart[] {
  return images.slice(0, 4).flatMap((url) => {
    if (/^(data:|https?:\/\/)/i.test(url)) {
      return [{ type: "image_url", image_url: { url } }];
    }
    return [{ type: "text", text: `Reference image URL: ${url}` }];
  });
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

    const ai = await generateAIResponse(adminClient(), {
      taskType: "image",
      messages: [{
        role: "user",
        content: [{ type: "text", text: prompt }, ...toImageParts(images)],
      }],
      jsonMode: "object",
    });

    const parsed = parseJson(ai.content) as VehicleVisionResult;
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
