import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { generateAIResponse, type AIMessagePart } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, accept-profile, content-profile, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type StockIntakeResult = {
  name?: string;
  sku?: string;
  category?: string;
  qty?: number | string;
  unit_cost?: number | string;
  unit_price?: number | string;
  min_stock?: number | string;
  notes?: string;
  confidence?: number | string;
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

function toImageParts(images: string[]) {
  return images.slice(0, 4).flatMap<AIMessagePart>((url) => {
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const user = await requireUser(req);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { images = [], text = "" } = await req.json() as { images?: string[]; text?: string };
    if ((!Array.isArray(images) || images.length === 0) && !String(text || "").trim()) {
      return json({ error: "Upload an image or add some notes first." }, 400);
    }

    const prompt = [
      "You are an inventory intake assistant for a Kenyan automotive workshop.",
      "Look at the uploaded stock photo, receipt, package, shelf label, or typed notes.",
      "Return strict JSON only in this exact shape:",
      "{",
      '  "name": "",',
      '  "sku": "",',
      '  "category": "",',
      '  "qty": 0,',
      '  "unit_cost": 0,',
      '  "unit_price": 0,',
      '  "min_stock": 0,',
      '  "notes": "",',
      '  "confidence": 0',
      "}",
      "Rules:",
      "- Focus on one stock row only: the main product or the clearest single line item.",
      "- If the source is a receipt with many items, choose the most prominent item and mention that in notes.",
      "- Use integers for qty and min_stock.",
      "- Use numbers for unit_cost and unit_price without currency symbols.",
      "- If a value is not visible, return 0 for numbers and an empty string for text.",
      "- Do not invent a SKU if none is shown.",
      "- confidence must be between 0 and 1.",
      "- Do not add markdown fences or commentary.",
      text.trim() ? `User notes:\n${text.trim()}` : "",
    ].filter(Boolean).join("\n");

    const ai = await generateAIResponse(adminClient(), {
      taskType: images.length > 0 ? "image" : "analysis",
      messages: [{
        role: "user",
        content: [{ type: "text", text: prompt }, ...toImageParts(images)],
      }],
      jsonMode: "object",
    });

    const parsed = parseJson(ai.content) as StockIntakeResult;
    return json({
      requested_by: user.id,
      name: typeof parsed?.name === "string" ? parsed.name : "",
      sku: typeof parsed?.sku === "string" ? parsed.sku : "",
      category: typeof parsed?.category === "string" ? parsed.category : "",
      qty: Math.max(0, Math.round(Number(parsed?.qty || 0))),
      unit_cost: Math.max(0, Number(parsed?.unit_cost || 0)),
      unit_price: Math.max(0, Number(parsed?.unit_price || 0)),
      min_stock: Math.max(0, Math.round(Number(parsed?.min_stock || 0))),
      notes: typeof parsed?.notes === "string" ? parsed.notes : "",
      confidence: Math.max(0, Math.min(1, Number(parsed?.confidence || 0))),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
