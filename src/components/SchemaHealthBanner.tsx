import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, X } from "lucide-react";

// Tables the app cannot run without. We only probe a tiny subset to keep
// startup fast — if these are missing, almost certainly the bootstrap
// script was never applied.
const CRITICAL: string[] = [
  "profiles",
  "user_roles",
  "jobs",
  "clients",
  "vehicles",
  "parts",
  "part_stock",
  "job_line_items",
  "job_mechanics",
  "app_settings",
  "notifications",
  "staff_attendance",
  "attendance_exceptions",
  "staff_payroll_rates",
  "webauthn_credentials",
  "tronix_messages",
];

export function SchemaHealthBanner() {
  const [missing, setMissing] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        CRITICAL.map(async (t) => {
          const { error } = await supabase.from(t as any).select("*", { count: "exact", head: true });
          // PostgREST returns 42P01 / "relation ... does not exist" when missing
          if (error && /does not exist|42P01|relation/i.test(error.message)) return t;
          return null;
        }),
      );
      if (!cancelled) setMissing(results.filter((x): x is string => typeof x === "string"));
    })();
    return () => { cancelled = true; };
  }, []);

  if (dismissed || missing.length === 0) return null;

  return (
    <div className="border-b border-destructive/40 bg-destructive/10 text-destructive-foreground">
      <div className="flex items-start gap-3 px-4 py-3">
        <AlertTriangle className="h-5 w-5 mt-0.5 text-destructive shrink-0" />
        <div className="flex-1 text-sm">
          <p className="font-semibold text-destructive">Database is not fully set up.</p>
          <p className="text-xs text-foreground/80">
            Missing tables: <span className="font-mono">{missing.join(", ")}</span>.
            Open <span className="font-mono">supabase/_bootstrap_full_schema.sql</span> in this project,
            paste it into the Supabase SQL editor and run it once. After that, redeploy the edge
            functions and set your Gemini key if the AI tools are still offline.
          </p>
        </div>
        <button onClick={() => setDismissed(true)} className="p-1 rounded hover:bg-destructive/20" aria-label="Dismiss">
          <X className="h-4 w-4 text-destructive" />
        </button>
      </div>
    </div>
  );
}
