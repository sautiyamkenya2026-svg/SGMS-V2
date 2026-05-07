import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function normalizePlate(value = "") {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function clientPortalEmail(plate: string) {
  return `${normalizePlate(plate).toLowerCase()}@client.goldenauto.local`;
}

function normalizeClientPhone(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("254") && digits.length === 12) return `0${digits.slice(3)}`;
  if ((digits.startsWith("7") || digits.startsWith("1")) && digits.length === 9) return `0${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return digits;
  return digits;
}

function clientPortalPassword(phone: string | null | undefined, plate: string) {
  const normalizedPhone = normalizeClientPhone(phone);
  return (normalizedPhone || normalizePlate(plate)).slice(0, 72);
}

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
      return json({ error: "Only super admins can sync client portal passwords." }, 403);
    }

    const { data: accounts, error: accountsError } = await admin
      .from("client_portal_accounts")
      .select("user_id, plate, phone");
    if (accountsError) return json({ error: accountsError.message }, 500);

    let updated = 0;
    let skipped = 0;
    const failures: Array<{ plate: string; error: string }> = [];

    for (const account of accounts ?? []) {
      const plate = normalizePlate(account.plate ?? "");
      const password = clientPortalPassword(account.phone, plate);

      if (!plate || password.length < 6) {
        skipped += 1;
        continue;
      }

      const { error } = await admin.auth.admin.updateUserById(account.user_id, {
        email: clientPortalEmail(plate),
        password,
        user_metadata: {
          portal_plate: plate,
          client_portal: true,
          phone: account.phone ?? null,
        },
      });

      if (error) {
        failures.push({ plate, error: error.message });
      } else {
        updated += 1;
      }
    }

    return json({
      ok: failures.length === 0,
      updated,
      skipped,
      failures,
    });
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
