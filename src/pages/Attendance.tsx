import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Download,
  Fingerprint,
  KeyRound,
  LogIn,
  LogOut,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { friendlyErrorMessage } from "@/lib/app-error";
import { useAuth } from "@/lib/auth";
import {
  closeReservedDocumentWindow,
  openStoredDocumentUrl,
  reserveDocumentWindow,
  storeGeneratedTextFile,
} from "@/lib/document-storage";
import { toast } from "sonner";

type StaffRoleRow = {
  user_id: string;
  role: string;
};

type AttendanceRow = {
  id: string;
  user_id: string;
  event: string;
  method: string;
  device_label: string | null;
  created_at: string;
};

type StaffProfileRow = {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

type Staff = StaffProfileRow & {
  role: string | null;
  last_event?: AttendanceRow | null;
};

function toLocalDateValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function toLocalMonthValue(date = new Date()) {
  return toLocalDateValue(date).slice(0, 7);
}

function csvEscape(value: string | null | undefined) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export default function Attendance() {
  const { user, hasRole } = useAuth();
  const allowed =
    hasRole("reception") || hasRole("gateman") ||
    hasRole("admin") || hasRole("super_admin") ||
    hasRole("director") || hasRole("manager");

  const [q, setQ] = useState("");
  const [staff, setStaff] = useState<Staff[]>([]);
  const [entries, setEntries] = useState<AttendanceRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState("all");
  const [dayFilter, setDayFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState(toLocalMonthValue());

  const load = async () => {
    setLoading(true);
    const [{ data: profiles }, { data: roles }, { data: log }] = await Promise.all([
      supabase.from("profiles").select("id, display_name, email, avatar_url"),
      supabase.from("user_roles").select("user_id, role"),
      supabase
        .from("staff_attendance")
        .select("id, user_id, event, method, device_label, created_at")
        .order("created_at", { ascending: false })
        .limit(5000),
    ]);

    const typedRoles = (roles ?? []) as StaffRoleRow[];
    const typedLog = (log ?? []) as AttendanceRow[];
    const roleMap = new Map<string, string>();
    typedRoles.forEach((row) => roleMap.set(row.user_id, row.role));
    const hiddenUserIds = new Set(
      typedRoles
        .filter((row) => row.role === "super_admin")
        .map((row) => row.user_id),
    );

    const lastByUser = new Map<string, AttendanceRow>();
    typedLog.forEach((row) => {
      if (!lastByUser.has(row.user_id)) lastByUser.set(row.user_id, row);
    });

    setStaff(
      ((profiles ?? []) as StaffProfileRow[])
        .filter((profile) => !hiddenUserIds.has(profile.id))
        .map((profile) => ({
          ...profile,
          role: roleMap.get(profile.id) ?? null,
          last_event: lastByUser.get(profile.id) ?? null,
        })),
    );
    setEntries(typedLog.filter((entry) => !hiddenUserIds.has(entry.user_id)));
    setLoading(false);
  };

  useEffect(() => {
    if (!allowed) return;
    load();
    const channel = supabase
      .channel("attendance-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "staff_attendance" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [allowed]);

  const filteredStaff = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return staff;
    return staff.filter((member) =>
      member.display_name?.toLowerCase().includes(term) ||
      member.email?.toLowerCase().includes(term) ||
      member.role?.toLowerCase().includes(term),
    );
  }, [staff, q]);

  const filteredEntries = useMemo(() => {
    const term = q.trim().toLowerCase();
    return entries.filter((entry) => {
      const member = staff.find((row) => row.id === entry.user_id);
      const entryDate = entry.created_at.slice(0, 10);

      if (selectedUserId !== "all" && entry.user_id !== selectedUserId) return false;
      if (dayFilter && entryDate !== dayFilter) return false;
      if (!dayFilter && monthFilter && !entryDate.startsWith(monthFilter)) return false;
      if (!term) return true;

      return (
        member?.display_name?.toLowerCase().includes(term) ||
        member?.email?.toLowerCase().includes(term) ||
        member?.role?.toLowerCase().includes(term) ||
        entry.method.toLowerCase().includes(term) ||
        entry.event.toLowerCase().includes(term)
      );
    });
  }, [dayFilter, entries, monthFilter, q, selectedUserId, staff]);

  const summary = useMemo(() => {
    let checkIns = 0;
    let checkOuts = 0;
    const people = new Set<string>();
    filteredEntries.forEach((entry) => {
      people.add(entry.user_id);
      if (entry.event === "check_in") checkIns += 1;
      if (entry.event === "check_out") checkOuts += 1;
    });
    return { checkIns, checkOuts, people: people.size };
  }, [filteredEntries]);

  const tryFingerprint = async () => {
    try {
      if (!("credentials" in navigator) || !window.PublicKeyCredential) return false;
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      await navigator.credentials.get({
        publicKey: { challenge, timeout: 20_000, userVerification: "preferred" },
      });
      return true;
    } catch {
      return false;
    }
  };

  const recordEvent = async (member: Staff, event: "check_in" | "check_out") => {
    setBusy(member.id);
    try {
      const ok = await tryFingerprint();
      const method = ok ? "webauthn" : "manual";
      const { error } = await supabase.from("staff_attendance").insert({
        user_id: member.id,
        event,
        method,
        device_label: navigator.userAgent.slice(0, 120),
      });
      if (error) throw error;
      toast.success(`${member.display_name ?? member.email} ${event === "check_in" ? "checked in" : "checked out"} successfully.`);
      await load();
    } catch (error: unknown) {
      const message = friendlyErrorMessage(error, "Could not record that attendance event.");
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  const clearFilters = () => {
    setSelectedUserId("all");
    setDayFilter("");
    setMonthFilter(toLocalMonthValue());
    setQ("");
  };

  const exportAttendance = async () => {
    if (filteredEntries.length === 0) {
      toast.error("No attendance rows match the current filters.");
      return;
    }

    const lines = [
      ["Date", "Time", "Staff", "Email", "Role", "Event", "Method", "Device"].join(","),
      ...filteredEntries.map((entry) => {
        const member = staff.find((row) => row.id === entry.user_id);
        const date = new Date(entry.created_at);
        return [
          csvEscape(date.toLocaleDateString("en-GB")),
          csvEscape(date.toLocaleTimeString("en-GB")),
          csvEscape(member?.display_name ?? entry.user_id),
          csvEscape(member?.email ?? ""),
          csvEscape(member?.role ?? ""),
          csvEscape(entry.event === "check_in" ? "IN" : "OUT"),
          csvEscape(entry.method),
          csvEscape(entry.device_label ?? ""),
        ].join(",");
      }),
    ];

    const fileName = `attendance-${dayFilter || monthFilter || toLocalDateValue()}.csv`;
    const target = reserveDocumentWindow();
    try {
      const stored = await storeGeneratedTextFile({
        path: `reports/attendance/${fileName}`,
        fileName,
        contents: lines.join("\n"),
        contentType: "text/csv;charset=utf-8;",
      });
      openStoredDocumentUrl(stored.url, target);
      toast.success("Attendance export ready");
    } catch (error: any) {
      closeReservedDocumentWindow(target);
      toast.error(friendlyErrorMessage(error, "Could not prepare that attendance export."));
    }
  };

  if (!allowed) {
    return (
      <div className="mx-auto mt-20 max-w-xl">
        <Card className="space-y-3 p-6 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-destructive" />
          <h2 className="text-lg font-semibold">Restricted</h2>
          <p className="text-sm text-muted-foreground">
            Only reception and the gate operator can open the attendance terminal.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Attendance Terminal</h1>
          <p className="text-sm text-muted-foreground">
            Key staff in and out, then filter and export the attendance sheet by person, day, or month.
          </p>
        </div>
        <Badge variant="secondary" className="gap-1">
          <Fingerprint className="h-3 w-3" /> Operator: {hasRole("super_admin") ? "Operator" : user?.displayName}
        </Badge>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 lg:grid-cols-[1.2fr,220px,180px,180px,auto,auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, email, role, or method..."
              className="pl-9"
            />
          </div>
          <div>
            <Label className="text-xs">Staff member</Label>
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All staff</SelectItem>
                {staff.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.display_name ?? member.email ?? member.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Exact day</Label>
            <Input type="date" value={dayFilter} onChange={(e) => setDayFilter(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Month</Label>
            <Input type="month" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} />
          </div>
          <Button variant="outline" className="self-end" onClick={clearFilters}>
            <RefreshCw className="mr-2 h-4 w-4" /> Reset
          </Button>
          <Button className="self-end bg-gradient-primary" onClick={exportAttendance}>
            <Download className="mr-2 h-4 w-4" /> Download sheet
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase text-muted-foreground">People in filtered sheet</p>
          <p className="mt-1 text-2xl font-bold">{summary.people}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Check-ins</p>
          <p className="mt-1 text-2xl font-bold text-success">{summary.checkIns}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Check-outs</p>
          <p className="mt-1 text-2xl font-bold">{summary.checkOuts}</p>
        </Card>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {filteredStaff.map((member) => {
          const isIn = member.last_event?.event === "check_in";
          return (
            <Card key={member.id} className="flex items-center gap-3 p-3">
              <Avatar className="h-10 w-10">
                {member.avatar_url && <AvatarImage src={member.avatar_url} />}
                <AvatarFallback className="bg-gradient-primary text-xs text-primary-foreground">
                  {(member.display_name ?? member.email ?? "?").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{member.display_name ?? member.email}</p>
                <p className="text-xs capitalize text-muted-foreground">
                  {member.role ?? "—"}
                  {member.last_event && (
                    <>
                      {" · "}
                      <span className={isIn ? "text-success" : "text-muted-foreground"}>
                        {isIn ? "IN" : "OUT"} {formatDistanceToNow(new Date(member.last_event.created_at), { addSuffix: true })}
                      </span>
                    </>
                  )}
                </p>
              </div>
              {isIn ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === member.id}
                  onClick={() => recordEvent(member, "check_out")}
                >
                  <LogOut className="mr-1 h-4 w-4" /> Out
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="bg-gradient-primary"
                  disabled={busy === member.id}
                  onClick={() => recordEvent(member, "check_in")}
                >
                  <LogIn className="mr-1 h-4 w-4" /> In
                </Button>
              )}
            </Card>
          );
        })}
        {!loading && filteredStaff.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground md:col-span-2">
            No staff match the current search.
          </Card>
        )}
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-semibold">
            <KeyRound className="h-4 w-4" /> Attendance sheet
          </h3>
          <span className="text-xs text-muted-foreground">{filteredEntries.length} rows</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[860px] w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="p-3">Date</th>
                <th className="p-3">Staff</th>
                <th className="p-3">Role</th>
                <th className="p-3">Event</th>
                <th className="p-3">Method</th>
                <th className="p-3">Device</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">Loading…</td>
                </tr>
              ) : filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">No attendance rows for these filters.</td>
                </tr>
              ) : filteredEntries.map((entry) => {
                const member = staff.find((row) => row.id === entry.user_id);
                const date = new Date(entry.created_at);
                return (
                  <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="p-3 text-muted-foreground">
                      <div>{date.toLocaleDateString("en-GB")}</div>
                      <div className="text-[11px]">{date.toLocaleTimeString("en-GB")}</div>
                    </td>
                    <td className="p-3">
                      <div className="font-medium">{member?.display_name ?? entry.user_id.slice(0, 8)}</div>
                      <div className="text-xs text-muted-foreground">{member?.email ?? "—"}</div>
                    </td>
                    <td className="p-3 capitalize text-muted-foreground">{member?.role ?? "—"}</td>
                    <td className="p-3">
                      <Badge variant={entry.event === "check_in" ? "default" : "secondary"}>
                        {entry.event === "check_in" ? "IN" : "OUT"}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs uppercase text-muted-foreground">{entry.method}</td>
                    <td className="p-3 text-xs text-muted-foreground">{entry.device_label ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
