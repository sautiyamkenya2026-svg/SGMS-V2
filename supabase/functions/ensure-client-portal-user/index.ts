import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STAFF_ROLES = [
  "reception",
  "mechanic",
  "storekeeper",
  "gateman",
  "manager",
  "director",
  "admin",
  "super_admin",
] as const;

function normalizePlate(value = "") {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function clientPortalEmail(plate: string) {
  return `${normalizePlate(plate).toLowerCase()}@client.goldenauto.local`;
}

function clientPortalPassword(phone: string | null | undefined, plate: string) {
  const compactPhone = String(phone ?? "").trim().replace(/\s+/g, "");
  return (compactPhone || normalizePlate(plate)).slice(0, 72);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return json({ error: "Please sign in to continue." }, 401);
    }

    const token = auth.slice(7);
    const publicClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: callerResult, error: callerError } = await publicClient.auth.getUser(token);
    if (callerError || !callerResult?.user) {
      return json({ error: "Please sign in to continue." }, 401);
    }

    const { data: callerRoles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerResult.user.id);
    const roles = (callerRoles ?? []).map((row: any) => row.role);
    const isStaff = roles.some((role: string) => STAFF_ROLES.includes(role as typeof STAFF_ROLES[number]));
    if (!isStaff) {
      return json({ error: "You do not have sufficient clearance to sync client portal users." }, 403);
    }

    const body = await req.json().catch(() => null);
    if (!body) return json({ error: "The request could not be read." }, 400);

    const {
      plate,
      phone,
      client_id,
      vehicle_id,
      customer_name,
    } = body as {
      plate?: string;
      phone?: string | null;
      client_id?: string | null;
      vehicle_id?: string | null;
      customer_name?: string | null;
    };

    const normalizedPlate = normalizePlate(plate ?? "");
    if (!normalizedPlate) {
      return json({ error: "Plate is required." }, 400);
    }

    const password = clientPortalPassword(phone, normalizedPlate);
    if (password.length < 6) {
      return json({ error: "A valid client phone number is required to create portal access." }, 400);
    }

    const email = clientPortalEmail(normalizedPlate);
    const displayName = String(customer_name ?? normalizedPlate).trim() || normalizedPlate;

    const { data: existingAccount } = await admin
      .from("client_portal_accounts")
      .select("user_id")
      .eq("plate", normalizedPlate)
      .maybeSingle();

    let userId = existingAccount?.user_id ?? null;

    if (!userId) {
      const { data: existingProfile } = await admin
        .from("profiles")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      userId = existingProfile?.id ?? null;
    }

    if (!userId) {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: displayName,
          portal_plate: normalizedPlate,
          client_portal: true,
          phone: phone ?? null,
        },
      });
      if (createError || !created.user?.id) {
        return json({ error: createError?.message ?? "Could not create the client login." }, 400);
      }
      userId = created.user.id;
    } else {
      const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
        email,
        password,
        user_metadata: {
          display_name: displayName,
          portal_plate: normalizedPlate,
          client_portal: true,
          phone: phone ?? null,
        },
      });
      if (updateError) {
        return json({ error: updateError.message }, 400);
      }
    }

    await admin.from("user_roles").delete().eq("user_id", userId);
    const { error: roleError } = await admin
      .from("user_roles")
      .insert({ user_id: userId, role: "client" });
    if (roleError) return json({ error: roleError.message }, 500);

    const { error: profileError } = await admin.from("profiles").upsert({
      id: userId,
      email,
      display_name: displayName,
      phone: phone ?? null,
      notes: `Client portal account for ${normalizedPlate}`,
    });
    if (profileError) return json({ error: profileError.message }, 500);

    const { error: accountError } = await admin.from("client_portal_accounts").upsert({
      user_id: userId,
      client_id: client_id ?? null,
      vehicle_id: vehicle_id ?? null,
      plate: normalizedPlate,
      phone: phone ?? null,
    });
    if (accountError) return json({ error: accountError.message }, 500);

    return json({
      ok: true,
      user_id: userId,
      username: normalizedPlate,
      email,
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
