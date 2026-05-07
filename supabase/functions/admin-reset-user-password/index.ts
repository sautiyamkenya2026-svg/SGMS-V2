import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "Please sign in to continue." }, 401);
    const token = auth.slice(7);

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: callerResult, error: callerError } = await authClient.auth.getUser(token);
    if (callerError || !callerResult?.user) return json({ error: "Please sign in to continue." }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: callerRoles } = await admin.from("user_roles").select("role").eq("user_id", callerResult.user.id);
    const roles = (callerRoles ?? []).map((row: any) => row.role);
    if (!roles.includes("super_admin")) {
      return json({ error: "Only super admins can reset user passwords." }, 403);
    }

    const body = await req.json().catch(() => null);
    if (!body) return json({ error: "The request could not be read." }, 400);

    const { user_id, password } = body as { user_id?: string; password?: string };
    if (!user_id || !password) {
      return json({ error: "User ID and the new password are required." }, 400);
    }
    if (password.trim().length < 6) {
      return json({ error: "Password must be at least 6 characters." }, 400);
    }

    const { error } = await admin.auth.admin.updateUserById(user_id, { password: password.trim() });
    if (error) return json({ error: error.message }, 400);

    return json({ ok: true });
  } catch (error: any) {
    return json({ error: error?.message ?? String(error) }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
