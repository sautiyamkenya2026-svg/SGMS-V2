// Attendance page — only Reception and Gateman (and admins) can use it.
// Lets the operator search for a staff member, then key them IN or OUT.
// Optional fingerprint verification on this device; otherwise method = 'pin'/'manual'.
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Fingerprint, KeyRound, LogIn, LogOut, ShieldAlert, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

type Staff = {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: string | null;
  last_event?: { event: string; created_at: string; method: string } | null;
};

export default function Attendance() {
  const { user, hasRole } = useAuth();
  const allowed =
    hasRole("reception") || hasRole("gateman") ||
    hasRole("admin") || hasRole("super_admin") ||
    hasRole("director") || hasRole("manager");

  const [q, setQ] = useState("");
  const [staff, setStaff] = useState<Staff[]>([]);
  const [todayLog, setTodayLog] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const [{ data: profiles }, { data: roles }, { data: log }] = await Promise.all([
      supabase.from("profiles").select("id, display_name, email, avatar_url"),
      supabase.from("user_roles").select("user_id, role"),
      supabase
        .from("staff_attendance")
        .select("id, user_id, event, method, created_at")
        .gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
        .order("created_at", { ascending: false }),
    ]);
    const roleMap = new Map<string, string>();
    (roles ?? []).forEach((r: any) => roleMap.set(r.user_id, r.role));
    const lastByUser = new Map<string, any>();
    (log ?? []).forEach((l: any) => {
      if (!lastByUser.has(l.user_id)) lastByUser.set(l.user_id, l);
    });
    setStaff(
      (profiles ?? []).map((p: any) => ({
        ...p,
        role: roleMap.get(p.id) ?? null,
        last_event: lastByUser.get(p.id) ?? null,
      }))
    );
    setTodayLog(log ?? []);
  };

  useEffect(() => {
    if (!allowed) return;
    load();
    const ch = supabase
      .channel("attendance-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "staff_attendance" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [allowed]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return staff;
    return staff.filter(
      (s) =>
        s.display_name?.toLowerCase().includes(term) ||
        s.email?.toLowerCase().includes(term) ||
        s.role?.toLowerCase().includes(term)
    );
  }, [staff, q]);

  const tryFingerprint = async () => {
    try {
      if (!("credentials" in navigator) || !window.PublicKeyCredential) return false;
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      await navigator.credentials.get({
        publicKey: { challenge, timeout: 20000, userVerification: "preferred" } as any,
      });
      return true;
    } catch {
      return false;
    }
  };

  const recordEvent = async (s: Staff, event: "check_in" | "check_out") => {
    setBusy(s.id);
    try {
      const ok = await tryFingerprint();
      const method = ok ? "webauthn" : "manual";
      const { error } = await supabase.from("staff_attendance").insert({
        user_id: s.id,
        event,
        method,
        device_label: navigator.userAgent.slice(0, 120),
      });
      if (error) throw error;
      toast.success(`${s.display_name ?? s.email} ${event === "check_in" ? "checked in" : "checked out"} ✓`);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    } finally {
      setBusy(null);
    }
  };

  if (!allowed) {
    return (
      <div className="max-w-xl mx-auto mt-20">
        <Card className="p-6 text-center space-y-3">
          <ShieldAlert className="h-10 w-10 mx-auto text-destructive" />
          <h2 className="text-lg font-semibold">Restricted</h2>
          <p className="text-sm text-muted-foreground">
            Only reception and the gate operator can open the attendance terminal.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Attendance Terminal</h1>
          <p className="text-sm text-muted-foreground">
            Key staff in and out. Fingerprint is optional — manual entry is logged.
          </p>
        </div>
        <Badge variant="secondary" className="gap-1">
          <Fingerprint className="h-3 w-3" /> Operator: {user?.displayName}
        </Badge>
      </div>

      <Card className="p-3">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email or role…"
            className="pl-9"
          />
        </div>
      </Card>

      <div className="grid gap-2 md:grid-cols-2">
        {filtered.map((s) => {
          const isIn = s.last_event?.event === "check_in";
          return (
            <Card key={s.id} className="p-3 flex items-center gap-3">
              <Avatar className="h-10 w-10">
                {s.avatar_url && <AvatarImage src={s.avatar_url} />}
                <AvatarFallback className="bg-gradient-primary text-primary-foreground text-xs">
                  {(s.display_name ?? s.email ?? "?").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{s.display_name ?? s.email}</p>
                <p className="text-xs text-muted-foreground capitalize">
                  {s.role ?? "—"}
                  {s.last_event && (
                    <>
                      {" · "}
                      <span className={isIn ? "text-success" : "text-muted-foreground"}>
                        {isIn ? "IN" : "OUT"} {formatDistanceToNow(new Date(s.last_event.created_at), { addSuffix: true })}
                      </span>
                    </>
                  )}
                </p>
              </div>
              {isIn ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === s.id}
                  onClick={() => recordEvent(s, "check_out")}
                >
                  <LogOut className="h-4 w-4 mr-1" /> Out
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="bg-gradient-primary"
                  disabled={busy === s.id}
                  onClick={() => recordEvent(s, "check_in")}
                >
                  <LogIn className="h-4 w-4 mr-1" /> In
                </Button>
              )}
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground md:col-span-2">No staff match.</Card>
        )}
      </div>

      <Card className="p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Today's events
          </h3>
          <span className="text-xs text-muted-foreground">{todayLog.length} entries</span>
        </div>
        <div className="space-y-1 max-h-64 overflow-auto text-sm">
          {todayLog.map((l) => {
            const s = staff.find((x) => x.id === l.user_id);
            return (
              <div key={l.id} className="flex items-center justify-between border-b py-1 last:border-0">
                <span>
                  <Badge variant={l.event === "check_in" ? "default" : "secondary"} className="mr-2">
                    {l.event === "check_in" ? "IN" : "OUT"}
                  </Badge>
                  {s?.display_name ?? l.user_id.slice(0, 8)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {l.method} · {new Date(l.created_at).toLocaleTimeString()}
                </span>
              </div>
            );
          })}
          {todayLog.length === 0 && <p className="text-muted-foreground text-center py-4">No events yet today.</p>}
        </div>
      </Card>
    </div>
  );
}
