import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePlate(value = "") {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeClientPhone(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("254") && digits.length === 12) return `0${digits.slice(3)}`;
  if ((digits.startsWith("7") || digits.startsWith("1")) && digits.length === 9) return `0${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return digits;
  return digits;
}

function clientPortalEmail(plate: string) {
  return `${normalizePlate(plate).toLowerCase()}@client.goldenauto.local`;
}

function clientPortalPassword(phone: string | null | undefined, plate: string) {
  const normalizedPhone = normalizeClientPhone(phone);
  return (normalizedPhone || normalizePlate(plate)).slice(0, 72);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => null) as { plate?: string; phone?: string | null } | null;
    const normalizedPlate = normalizePlate(body?.plate ?? "");
    const normalizedPhone = normalizeClientPhone(body?.phone);
    if (!normalizedPlate || normalizedPhone.length < 6) {
      return json({ error: "Invalid credentials." }, 401);
    }

    const { data: existingAccount } = await admin
      .from("client_portal_accounts")
      .select("user_id, client_id, vehicle_id, plate, phone")
      .eq("plate", normalizedPlate)
      .maybeSingle();

    const accountPhone = normalizeClientPhone(existingAccount?.phone);
    if (existingAccount?.user_id && accountPhone && accountPhone === normalizedPhone) {
      const email = clientPortalEmail(normalizedPlate);
      const password = clientPortalPassword(accountPhone, normalizedPlate);
      await admin.auth.admin.updateUserById(existingAccount.user_id, {
        email,
        password,
        user_metadata: {
          display_name: normalizedPlate,
          portal_plate: normalizedPlate,
          client_portal: true,
          phone: existingAccount.phone ?? normalizedPhone,
        },
      });
      return json({ ok: true, email, password });
    }

    const { data: matchingJobs, error: jobError } = await admin
      .from("jobs")
      .select("id, plate, client_id, vehicle_id, customer_name, customer_phone, started_at")
      .order("started_at", { ascending: false })
      .limit(50);
    if (jobError) return json({ error: "Invalid credentials." }, 401);

    const matchedJob = (matchingJobs ?? []).find((job: any) =>
      normalizePlate(job.plate) === normalizedPlate
      && normalizeClientPhone(job.customer_phone) === normalizedPhone
    );

    if (!matchedJob) {
      return json({ error: "Invalid credentials." }, 401);
    }

    const email = clientPortalEmail(normalizedPlate);
    const password = clientPortalPassword(normalizedPhone, normalizedPlate);
    const displayName = String(matchedJob.customer_name ?? normalizedPlate).trim() || normalizedPlate;

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
          phone: matchedJob.customer_phone ?? normalizedPhone,
        },
      });
      if (createError || !created.user?.id) return json({ error: "Invalid credentials." }, 401);
      userId = created.user.id;
    } else {
      const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
        email,
        password,
        user_metadata: {
          display_name: displayName,
          portal_plate: normalizedPlate,
          client_portal: true,
          phone: matchedJob.customer_phone ?? normalizedPhone,
        },
      });
      if (updateError) return json({ error: "Invalid credentials." }, 401);
    }

    await admin.from("user_roles").delete().eq("user_id", userId);
    const { error: roleError } = await admin
      .from("user_roles")
      .insert({ user_id: userId, role: "client" });
    if (roleError) return json({ error: "Invalid credentials." }, 401);

    await admin.from("profiles").upsert({
      id: userId,
      email,
      display_name: displayName,
      phone: matchedJob.customer_phone ?? normalizedPhone,
      notes: `Client portal account for ${normalizedPlate}`,
    });

    await admin.from("client_portal_accounts").upsert({
      user_id: userId,
      client_id: matchedJob.client_id ?? existingAccount?.client_id ?? null,
      vehicle_id: matchedJob.vehicle_id ?? existingAccount?.vehicle_id ?? null,
      plate: normalizedPlate,
      phone: matchedJob.customer_phone ?? normalizedPhone,
    });

    return json({ ok: true, email, password });
  } catch {
    return json({ error: "Invalid credentials." }, 401);
  }
});
