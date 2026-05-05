import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

loadEnvFile(path.resolve(process.cwd(), ".env"));
loadEnvFile(path.resolve(process.cwd(), ".env.local"));

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printUsage();
  process.exit(0);
}

const email = options.email ?? "sauti@today.co.ke";
const password = options.password;
const role = options.role ?? "reception";
const displayName = options.name ?? email;
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!password) {
  console.error("Missing --password");
  printUsage();
  process.exit(1);
}

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing SUPABASE url or service-role key. Set VITE_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const { data: created, error: createError } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { display_name: displayName },
});

if (createError) {
  console.error(`Failed to create user: ${createError.message}`);
  process.exit(1);
}

const userId = created.user?.id;

if (!userId) {
  console.error("User was created but no user id was returned.");
  process.exit(1);
}

await new Promise((resolve) => setTimeout(resolve, 250));

const { error: deleteRoleError } = await supabase
  .from("user_roles")
  .delete()
  .eq("user_id", userId);

if (deleteRoleError) {
  console.error(`Failed to clear default roles: ${deleteRoleError.message}`);
  process.exit(1);
}

const { error: insertRoleError } = await supabase
  .from("user_roles")
  .insert({ user_id: userId, role });

if (insertRoleError) {
  console.error(`Failed to assign role: ${insertRoleError.message}`);
  process.exit(1);
}

const { error: profileError } = await supabase.from("profiles").upsert({
  id: userId,
  email,
  display_name: displayName,
});

if (profileError) {
  console.error(`User created, but profile upsert failed: ${profileError.message}`);
  process.exit(1);
}

console.log(`Created ${email} with role ${role}. User id: ${userId}`);

function parseArgs(args) {
  const result = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const value = args[i + 1];

    if (!value || value.startsWith("--")) {
      result[key] = true;
      continue;
    }

    result[key] = value;
    i += 1;
  }

  return result;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function printUsage() {
  console.log(`Usage:
  node scripts/create-user.mjs --password "<password>"
  node scripts/create-user.mjs --email "sauti@today.co.ke" --password "<password>" --role reception --name "Sauti"
`);
}
