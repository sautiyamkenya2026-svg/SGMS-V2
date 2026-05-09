import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getMonthBounds,
  listMonthDays,
  toDateValue,
  toLocalDateValue,
  toLocalMonthValue,
} from "@/lib/date-values";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { friendlyErrorMessage } from "@/lib/app-error";
import { CheckCircle2, CircleHelp, Coins, Save, UserRoundCheck, Wallet } from "lucide-react";
import { toast } from "sonner";

type StaffRoleRow = {
  user_id: string;
  role: string;
};

type StaffProfileRow = {
  id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
};

type AttendanceRow = {
  id: string;
  user_id: string;
  event: string;
  created_at: string;
  recorded_by_name: string | null;
  recorded_by_role: string | null;
};

type AttendanceExceptionRow = {
  id: string;
  user_id: string;
  day: string;
  reason: string;
};

type PayrollRateRow = {
  id: string;
  user_id: string;
  month: string;
  monthly_salary: number;
};

type PettyCashAdvanceRow = {
  id: string;
  staff_user_id: string | null;
  amount: number;
  date: string;
};

type StaffMember = StaffProfileRow & {
  roles: string[];
  primaryRole: string | null;
};

type DayStatus = "present" | "excused" | "unknown" | "future";

type StaffDayRow = {
  day: string;
  status: DayStatus;
  entries: AttendanceRow[];
  exception: AttendanceExceptionRow | null;
  operatorSummary: string;
};

type StaffSummary = {
  staff: StaffMember;
  monthlySalary: number;
  dailyRate: number;
  presentDays: number;
  excusedDays: number;
  unknownDays: number;
  payableDays: number;
  advancePaid: number;
  payableAmount: number;
  netPay: number;
  dayRows: StaffDayRow[];
};

const fmtMoney = (amount: number) => `KSh ${Math.round(amount).toLocaleString()}`;

export default function Payroll() {
  const { user } = useAuth();
  const [monthFilter, setMonthFilter] = useState(toLocalMonthValue());
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [exceptions, setExceptions] = useState<AttendanceExceptionRow[]>([]);
  const [rates, setRates] = useState<PayrollRateRow[]>([]);
  const [pettyCashAdvances, setPettyCashAdvances] = useState<PettyCashAdvanceRow[]>([]);
  const [salaryDrafts, setSalaryDrafts] = useState<Record<string, string>>({});
  const [reasonDrafts, setReasonDrafts] = useState<Record<string, string>>({});
  const [selectedUserId, setSelectedUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingSalaryUserId, setSavingSalaryUserId] = useState<string | null>(null);
  const [savingReasonKey, setSavingReasonKey] = useState<string | null>(null);

  const { start, end, daysInMonth } = useMemo(() => getMonthBounds(monthFilter), [monthFilter]);
  const today = toLocalDateValue();
  const monthDays = useMemo(() => listMonthDays(monthFilter), [monthFilter]);

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: profiles }, { data: roles }, { data: log }, { data: excuseRows }, { data: rateRows }, { data: pettyRows }] = await Promise.all([
        supabase.from("profiles").select("id, display_name, email, phone").order("display_name"),
        supabase.from("user_roles").select("user_id, role"),
        supabase
          .from("staff_attendance")
          .select("id, user_id, event, created_at, recorded_by_name, recorded_by_role")
          .gte("created_at", start)
          .lte("created_at", `${end}T23:59:59`)
          .order("created_at", { ascending: true }),
        supabase
          .from("attendance_exceptions")
          .select("id, user_id, day, reason")
          .gte("day", start)
          .lte("day", end)
          .order("day", { ascending: true }),
        supabase
          .from("staff_payroll_rates")
          .select("id, user_id, month, monthly_salary")
          .eq("month", start),
        supabase
          .from("petty_cash_entries")
          .select("id, staff_user_id, amount, date")
          .eq("type", "payment")
          .gte("date", start)
          .lte("date", end)
          .not("staff_user_id", "is", null),
      ]);

      const typedRoles = (roles ?? []) as StaffRoleRow[];
      const roleMap = new Map<string, string[]>();
      typedRoles.forEach((row) => {
        roleMap.set(row.user_id, [...(roleMap.get(row.user_id) ?? []), row.role]);
      });

      const nextStaff = ((profiles ?? []) as StaffProfileRow[])
        .map((profile) => ({
          ...profile,
          roles: roleMap.get(profile.id) ?? [],
          primaryRole: roleMap.get(profile.id)?.[0] ?? null,
        }))
        .filter((profile) => profile.roles.length > 0 && !profile.roles.includes("client"));

      setStaff(nextStaff);
      setAttendance((log ?? []) as AttendanceRow[]);
      setExceptions((excuseRows ?? []) as AttendanceExceptionRow[]);
      setRates((rateRows ?? []) as PayrollRateRow[]);
      setPettyCashAdvances((pettyRows ?? []) as PettyCashAdvanceRow[]);
      setSalaryDrafts(
        Object.fromEntries(
          nextStaff.map((member) => {
            const rate = (rateRows ?? []).find((row: any) => row.user_id === member.id);
            return [member.id, String(Number(rate?.monthly_salary ?? 0) || "")];
          }),
        ),
      );
      setReasonDrafts(
        Object.fromEntries(
          ((excuseRows ?? []) as AttendanceExceptionRow[]).map((row) => [`${row.user_id}:${row.day}`, row.reason]),
        ),
      );
      setSelectedUserId((current) => {
        if (current && nextStaff.some((member) => member.id === current)) return current;
        return nextStaff[0]?.id ?? "";
      });
    } catch (error) {
      toast.error(friendlyErrorMessage(error, "Could not load payroll data."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [monthFilter]);

  const summaries = useMemo<StaffSummary[]>(() => {
    const entriesByUser = new Map<string, AttendanceRow[]>();
    attendance.forEach((row) => {
      entriesByUser.set(row.user_id, [...(entriesByUser.get(row.user_id) ?? []), row]);
    });

    const exceptionsByUserDay = new Map<string, AttendanceExceptionRow>();
    exceptions.forEach((row) => {
      exceptionsByUserDay.set(`${row.user_id}:${row.day}`, row);
    });

    const advancesByUser = new Map<string, number>();
    pettyCashAdvances.forEach((row) => {
      if (!row.staff_user_id) return;
      advancesByUser.set(row.staff_user_id, (advancesByUser.get(row.staff_user_id) ?? 0) + Number(row.amount || 0));
    });

    return staff.map((member) => {
      const memberEntries = entriesByUser.get(member.id) ?? [];
      const entriesByDay = new Map<string, AttendanceRow[]>();
      memberEntries.forEach((row) => {
        const key = toDateValue(row.created_at);
        entriesByDay.set(key, [...(entriesByDay.get(key) ?? []), row]);
      });

      const rate = rates.find((row) => row.user_id === member.id);
      const monthlySalary = Number(rate?.monthly_salary ?? 0);
      const dailyRate = daysInMonth > 0 ? monthlySalary / daysInMonth : 0;
      const advancePaid = advancesByUser.get(member.id) ?? 0;

      let presentDays = 0;
      let excusedDays = 0;
      let unknownDays = 0;

      const dayRows = monthDays.map((day) => {
        const dayEntries = entriesByDay.get(day) ?? [];
        const exception = exceptionsByUserDay.get(`${member.id}:${day}`) ?? null;
        const operators = Array.from(
          new Set(
            dayEntries.map((entry) =>
              `${entry.recorded_by_name ?? "Unknown"} (${entry.recorded_by_role ?? "unknown"})`,
            ),
          ),
        );
        const operatorSummary = operators.join(", ");

        let status: DayStatus = "future";
        const isFutureDay = day > today;
        if (!isFutureDay) {
          if (dayEntries.length > 0) {
            status = "present";
            presentDays += 1;
          } else if (exception) {
            status = "excused";
            excusedDays += 1;
          } else {
            status = "unknown";
            unknownDays += 1;
          }
        }

        return {
          day,
          status,
          entries: dayEntries,
          exception,
          operatorSummary,
        };
      });

      const payableDays = presentDays + excusedDays;
      const payableAmount = payableDays * dailyRate;
      return {
        staff: member,
        monthlySalary,
        dailyRate,
        presentDays,
        excusedDays,
        unknownDays,
        payableDays,
        advancePaid,
        payableAmount,
        netPay: Math.max(0, payableAmount - advancePaid),
        dayRows,
      };
    });
  }, [attendance, daysInMonth, exceptions, monthDays, pettyCashAdvances, rates, staff, today]);

  const selectedSummary = summaries.find((row) => row.staff.id === selectedUserId) ?? null;

  const totals = useMemo(() => {
    return summaries.reduce(
      (acc, row) => ({
        totalPayroll: acc.totalPayroll + row.payableAmount,
        totalAdvances: acc.totalAdvances + row.advancePaid,
        netPayroll: acc.netPayroll + row.netPay,
        presentDays: acc.presentDays + row.presentDays,
        excusedDays: acc.excusedDays + row.excusedDays,
        unknownDays: acc.unknownDays + row.unknownDays,
      }),
      { totalPayroll: 0, totalAdvances: 0, netPayroll: 0, presentDays: 0, excusedDays: 0, unknownDays: 0 },
    );
  }, [summaries]);

  const saveSalary = async (userId: string) => {
    setSavingSalaryUserId(userId);
    try {
      const raw = salaryDrafts[userId] ?? "";
      const monthlySalary = Math.max(0, Number(raw || 0));
      const payload = {
        user_id: userId,
        month: start,
        monthly_salary: monthlySalary,
        updated_by: user?.id ?? null,
        created_by: user?.id ?? null,
      };

      const { data, error } = await supabase
        .from("staff_payroll_rates")
        .upsert(payload, { onConflict: "user_id,month" })
        .select("id, user_id, month, monthly_salary")
        .single();
      if (error) throw error;

      setRates((current) => {
        const filtered = current.filter((row) => !(row.user_id === userId && row.month === start));
        return data ? [...filtered, data as PayrollRateRow] : filtered;
      });
      setSalaryDrafts((current) => ({ ...current, [userId]: monthlySalary ? String(monthlySalary) : "" }));
      toast.success("Monthly salary saved");
    } catch (error) {
      toast.error(friendlyErrorMessage(error, "Could not save that salary."));
    } finally {
      setSavingSalaryUserId(null);
    }
  };

  const saveReason = async (userId: string, day: string) => {
    const key = `${userId}:${day}`;
    const reason = (reasonDrafts[key] ?? "").trim();
    setSavingReasonKey(key);
    try {
      const existing = exceptions.find((row) => row.user_id === userId && row.day === day);

      if (!reason) {
        if (existing) {
          const { error } = await supabase.from("attendance_exceptions").delete().eq("id", existing.id);
          if (error) throw error;
          setExceptions((current) => current.filter((row) => row.id !== existing.id));
        }
        setReasonDrafts((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
        toast.success("Absence reason cleared");
        return;
      }

      const { data, error } = await supabase
        .from("attendance_exceptions")
        .upsert(
          {
            user_id: userId,
            day,
            reason,
            created_by: user?.id ?? null,
            updated_by: user?.id ?? null,
          },
          { onConflict: "user_id,day" },
        )
        .select("id, user_id, day, reason")
        .single();
      if (error) throw error;

      setExceptions((current) => {
        const filtered = current.filter((row) => !(row.user_id === userId && row.day === day));
        return data ? [...filtered, data as AttendanceExceptionRow] : filtered;
      });
      setReasonDrafts((current) => ({ ...current, [key]: reason }));
      toast.success("Absence reason saved");
    } catch (error) {
      toast.error(friendlyErrorMessage(error, "Could not save that absence reason."));
    } finally {
      setSavingReasonKey(null);
    }
  };

  const statusBadge = (status: DayStatus) => {
    if (status === "present") return <Badge className="bg-success text-success-foreground">Present</Badge>;
    if (status === "excused") return <Badge className="bg-primary text-primary-foreground">Excused</Badge>;
    if (status === "future") return <Badge variant="outline">Pending</Badge>;
    return <Badge variant="destructive">Unknown</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payroll</h1>
          <p className="text-sm text-muted-foreground">
            Monthly pay is converted into a daily rate, then reduced automatically when attendance is missing.
          </p>
        </div>
        <Badge variant="secondary" className="gap-1">
          <Wallet className="h-3 w-3" /> Month: {monthFilter}
        </Badge>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-[220px,260px,1fr]">
          <div>
            <Label className="text-xs">Payroll month</Label>
            <Input type="month" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Staff detail view</Label>
            <select
              value={selectedUserId}
              onChange={(event) => setSelectedUserId(event.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.display_name ?? member.email ?? member.id}
                </option>
              ))}
            </select>
          </div>
          <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
            Unknown days stay unpaid until an office reason is added. Any saved reason marks that day as excused and restores the pay for it.
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Gross payroll</p>
          <p className="mt-1 text-2xl font-bold">{fmtMoney(totals.totalPayroll)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Already paid</p>
          <p className="mt-1 text-2xl font-bold text-primary">{fmtMoney(totals.totalAdvances)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Net payroll due</p>
          <p className="mt-1 text-2xl font-bold text-success">{fmtMoney(totals.netPayroll)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Unknown unpaid days</p>
          <p className="mt-1 text-2xl font-bold text-destructive">{totals.unknownDays}</p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b p-4">
          <h2 className="font-semibold">Monthly salary setup</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="p-3">Staff</th>
                <th className="p-3">Role</th>
                <th className="p-3">Monthly pay</th>
                <th className="p-3">Daily rate</th>
                <th className="p-3 text-right">Present</th>
                <th className="p-3 text-right">Excused</th>
                <th className="p-3 text-right">Unknown</th>
                <th className="p-3">Gross pay</th>
                <th className="p-3">Already paid</th>
                <th className="p-3">Net pay</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-muted-foreground">Loading...</td>
                </tr>
              ) : summaries.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-muted-foreground">No staff available for payroll.</td>
                </tr>
              ) : summaries.map((summary) => (
                <tr
                  key={summary.staff.id}
                  className={`border-b last:border-0 hover:bg-muted/40 ${selectedUserId === summary.staff.id ? "bg-muted/30" : ""}`}
                >
                  <td className="p-3">
                    <div className="font-medium">{summary.staff.display_name ?? summary.staff.email ?? summary.staff.id}</div>
                    <div className="text-xs text-muted-foreground">{summary.staff.email ?? "-"}</div>
                  </td>
                  <td className="p-3 capitalize text-muted-foreground">{summary.staff.roles.join(", ") || "-"}</td>
                  <td className="p-3">
                    <Input
                      type="number"
                      min="0"
                      value={salaryDrafts[summary.staff.id] ?? ""}
                      onChange={(event) => setSalaryDrafts((current) => ({ ...current, [summary.staff.id]: event.target.value }))}
                      placeholder="0"
                    />
                  </td>
                  <td className="p-3 font-medium">{fmtMoney(summary.dailyRate)}</td>
                  <td className="p-3 text-right text-success">{summary.presentDays}</td>
                  <td className="p-3 text-right text-primary">{summary.excusedDays}</td>
                  <td className="p-3 text-right text-destructive">{summary.unknownDays}</td>
                  <td className="p-3 font-bold">{fmtMoney(summary.payableAmount)}</td>
                  <td className="p-3 font-medium text-primary">{fmtMoney(summary.advancePaid)}</td>
                  <td className="p-3 font-bold text-success">{fmtMoney(summary.netPay)}</td>
                  <td className="p-3 text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setSelectedUserId(summary.staff.id)}>
                        Open month
                      </Button>
                      <Button
                        size="sm"
                        className="bg-gradient-primary"
                        disabled={savingSalaryUserId === summary.staff.id}
                        onClick={() => saveSalary(summary.staff.id)}
                      >
                        <Save className="mr-1 h-3.5 w-3.5" /> Save
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {selectedSummary && (
        <Card className="overflow-hidden">
          <div className="border-b p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">
                  {selectedSummary.staff.display_name ?? selectedSummary.staff.email ?? selectedSummary.staff.id}
                </h2>
                <p className="text-sm text-muted-foreground capitalize">
                  {selectedSummary.staff.roles.join(", ") || selectedSummary.staff.primaryRole || "-"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline" className="gap-1">
                  <Coins className="h-3 w-3" /> Daily rate: {fmtMoney(selectedSummary.dailyRate)}
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <UserRoundCheck className="h-3 w-3" /> Payable days: {selectedSummary.payableDays}
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <Wallet className="h-3 w-3" /> Gross: {fmtMoney(selectedSummary.payableAmount)}
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <Coins className="h-3 w-3" /> Already paid: {fmtMoney(selectedSummary.advancePaid)}
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <Wallet className="h-3 w-3" /> Net: {fmtMoney(selectedSummary.netPay)}
                </Badge>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[1100px] w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="p-3">Day</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Attendance</th>
                  <th className="p-3">Recorded by</th>
                  <th className="p-3">Office reason</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {selectedSummary.dayRows.map((row) => {
                  const key = `${selectedSummary.staff.id}:${row.day}`;
                  const draftReason = reasonDrafts[key] ?? row.exception?.reason ?? "";
                  const attendanceSummary = row.entries.length === 0
                    ? "-"
                    : row.entries.map((entry) => {
                        const stamp = new Date(entry.created_at).toLocaleTimeString("en-GB");
                        return `${entry.event === "check_in" ? "IN" : "OUT"} ${stamp}`;
                      }).join(", ");

                  return (
                    <tr key={row.day} className="border-b last:border-0 align-top">
                      <td className="p-3">
                        <div className="font-medium">{row.day}</div>
                        <div className="text-xs text-muted-foreground">{new Date(`${row.day}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short" })}</div>
                      </td>
                      <td className="p-3">{statusBadge(row.status)}</td>
                      <td className="p-3 text-muted-foreground">{attendanceSummary}</td>
                      <td className="p-3 text-muted-foreground">{row.operatorSummary || "-"}</td>
                      <td className="p-3">
                        {row.status === "future" ? (
                          <span className="text-muted-foreground">Future day</span>
                        ) : row.status === "present" ? (
                          <div className="flex items-center gap-2 text-success">
                            <CheckCircle2 className="h-4 w-4" /> Attendance recorded
                          </div>
                        ) : (
                          <Input
                            value={draftReason}
                            onChange={(event) =>
                              setReasonDrafts((current) => ({ ...current, [key]: event.target.value }))
                            }
                            placeholder="Office reason to excuse this day"
                          />
                        )}
                      </td>
                      <td className="p-3 text-right">
                        {row.status === "future" || row.status === "present" ? (
                          <Badge variant="outline" className="gap-1">
                            <CircleHelp className="h-3 w-3" /> View only
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={savingReasonKey === key}
                            onClick={() => saveReason(selectedSummary.staff.id, row.day)}
                          >
                            <Save className="mr-1 h-3.5 w-3.5" />
                            {draftReason.trim() ? "Save reason" : "Clear"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
