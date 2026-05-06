import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { generateAIResponse, type AIMessagePart } from "../_shared/ai-router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, accept-profile, content-profile, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type PettyCashAIResult = {
  direction?: string;
  payee?: string;
  contact?: string;
  amount?: number | string;
  transaction_cost?: number | string;
  payment_reference?: string;
  transaction_date?: string;
  transaction_time?: string;
  payment_mode?: string;
  summary?: string;
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
      return json({ error: "Upload a screenshot/photo or paste the message text first." }, 400);
    }

    const prompt = [
      "You are a finance assistant reading Kenyan M-PESA, bank, or payment proof messages.",
      "Analyze the uploaded screenshot/image and any pasted message text.",
      "Return strict JSON only in this exact shape:",
      "{",
      '  "direction": "sent",',
      '  "payee": "",',
      '  "contact": "",',
      '  "amount": 0,',
      '  "transaction_cost": 0,',
      '  "payment_reference": "",',
      '  "transaction_date": "",',
      '  "transaction_time": "",',
      '  "payment_mode": "mpesa",',
      '  "summary": "",',
      '  "confidence": 0',
      "}",
      "Rules:",
      '- direction must be "sent", "received", or "unknown".',
      '- payment_mode should be "mpesa", "bank", "cash", "card", "cheque", or "unknown".',
      "- Extract the counterparty name and phone if visible.",
      "- amount and transaction_cost must be numbers without currency symbols.",
      "- transaction_date must be YYYY-MM-DD when visible; otherwise empty.",
      "- transaction_time should be HH:MM or HH:MM AM/PM when visible; otherwise empty.",
      "- payment_reference should be the transaction code/reference if visible.",
      "- summary should be one short plain-English sentence about what was detected.",
      "- confidence must be between 0 and 1.",
      "- Do not add markdown fences or commentary.",
      text.trim() ? `Pasted message text:\n${text.trim()}` : "",
    ].filter(Boolean).join("\n");

    const ai = await generateAIResponse(adminClient(), {
      taskType: images.length > 0 ? "image" : "analysis",
      messages: [{
        role: "user",
        content: [{ type: "text", text: prompt }, ...toImageParts(images)],
      }],
      jsonMode: "object",
    });

    const parsed = parseJson(ai.content) as PettyCashAIResult;
    const paymentMode = ["mpesa", "bank", "cash", "card", "cheque"].includes(String(parsed?.payment_mode || "").toLowerCase())
      ? String(parsed?.payment_mode).toLowerCase()
      : "unknown";
    const direction = ["sent", "received", "unknown"].includes(String(parsed?.direction || "").toLowerCase())
      ? String(parsed?.direction).toLowerCase()
      : "unknown";

    return json({
      requested_by: user.id,
      direction,
      payee: typeof parsed?.payee === "string" ? parsed.payee : "",
      contact: typeof parsed?.contact === "string" ? parsed.contact : "",
      amount: Math.max(0, Number(parsed?.amount || 0)),
      transaction_cost: Math.max(0, Number(parsed?.transaction_cost || 0)),
      payment_reference: typeof parsed?.payment_reference === "string" ? parsed.payment_reference : "",
      transaction_date: typeof parsed?.transaction_date === "string" ? parsed.transaction_date : "",
      transaction_time: typeof parsed?.transaction_time === "string" ? parsed.transaction_time : "",
      payment_mode: paymentMode,
      summary: typeof parsed?.summary === "string" ? parsed.summary : "",
      confidence: Math.max(0, Math.min(1, Number(parsed?.confidence || 0))),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
