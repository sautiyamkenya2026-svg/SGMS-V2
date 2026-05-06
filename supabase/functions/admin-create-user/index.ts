// Admin/Super-admin: create a new staff user with a chosen role.
// Uses service-role to insert directly so the role is applied atomically and
// the calling user's session is not disturbed (unlike client signUp).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ROLES = ["reception","mechanic","storekeeper","gateman","manager","director","admin","super_admin"] as const;
type Role = typeof ROLES[number];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "Please sign in to continue." }, 401);
    const token = auth.slice(7);

    const sbAuth = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: u, error: ue } = await sbAuth.auth.getUser(token);
    if (ue || !u?.user) return json({ error: "Please sign in to continue." }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: callerRoles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
    const roles = (callerRoles ?? []).map((r:any)=>r.role);
    const isSuper = roles.includes("super_admin");
    const isAdmin = isSuper || roles.includes("admin");
    if (!isAdmin) return json({ error: "You do not have sufficient clearance to create users." }, 403);

    const body = await req.json().catch(()=>null);
    if (!body) return json({ error: "The request could not be read." }, 400);
    const { email, password, display_name, role } = body as { email?:string; password?:string; display_name?:string; role?:Role };
    if (!email || !password || !role) return json({ error: "Email, password, and role are required." }, 400);
    if (!ROLES.includes(role)) return json({ error: "That role is not supported." }, 400);
    if ((role === "super_admin" || role === "director") && !isSuper) {
      return json({ error: "You do not have sufficient clearance to create that account type." }, 403);
    }

    // create the auth user (auto-confirmed so they can sign in immediately)
    const { data: created, error: ce } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { display_name: display_name ?? email },
    });
    if (ce) return json({ error: ce.message }, 400);
    const newId = created.user!.id;

    // wait briefly for the handle_new_user trigger to run, then enforce the chosen role
    await new Promise(r=>setTimeout(r, 200));
    await admin.from("user_roles").delete().eq("user_id", newId);
    const { error: re } = await admin.from("user_roles").insert({ user_id: newId, role });
    if (re) return json({ error: re.message }, 500);

    // upsert profile (in case the trigger didn't fire fast enough)
    await admin.from("profiles").upsert({ id: newId, email, display_name: display_name ?? email });

    return json({ ok: true, user_id: newId });
  } catch (e:any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

function json(b:any, status=200){
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" }});
}
