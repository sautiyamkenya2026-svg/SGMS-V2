import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Calendar, Activity, UserX, Timer, CarFront, Cog, Fuel, CircleDollarSign, PackageX } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { formatServiceTypes } from "@/lib/service-types";

const typeStyles: Record<string, string> = {
  success: "bg-success",
  warning: "bg-warning",
  info: "bg-primary",
};

const OPEN_STATUSES = ["diagnosis","diagnosis_approval","parts","parts_approval","repair","quality_check","awaiting_approval"];
const APPROVAL_STATUSES = ["diagnosis_approval","parts_approval","awaiting_approval"];

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    inGarage: 0,
    inProgress: 0,
    waitingApproval: 0,
    todayRevenue: 0,
    lowStock: 0,
  });
  const [bookings, setBookings] = useState<{ id: string; plate: string; customer: string; service: string; time: string }[]>([]);
  const [activity, setActivity] = useState<{ text: string; time: string; type: string }[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const today = new Date().toISOString().slice(0,10);
      const [jobsRes, partsRes, stockRes, invRes, recentRes] = await Promise.all([
        supabase.from("jobs").select("id,status,plate,customer_name,service_type,service_types,created_at,job_no").order("created_at", { ascending: false }),
        supabase.from("parts").select("id,min_stock"),
        supabase.from("part_stock").select("part_id,qty"),
        supabase.from("invoices").select("amount,date").eq("date", today),
        supabase.from("jobs").select("job_no,plate,status,created_at").order("created_at", { ascending: false }).limit(8),
      ]);
      if (!alive) return;
      const jobs = jobsRes.data ?? [];
      const open = jobs.filter(j => OPEN_STATUSES.includes(j.status));
      const approval = jobs.filter(j => APPROVAL_STATUSES.includes(j.status));
      const todayRev = (invRes.data ?? []).reduce((s, r: any) => s + Number(r.amount || 0), 0);

      // low stock
      const totals = new Map<string, number>();
      (stockRes.data ?? []).forEach((r: any) => totals.set(r.part_id, (totals.get(r.part_id) ?? 0) + Number(r.qty || 0)));
      const low = (partsRes.data ?? []).filter((p: any) => (totals.get(p.id) ?? 0) < Number(p.min_stock || 0)).length;

      setStats({
        inGarage: open.length,
        inProgress: jobs.filter(j => j.status === "repair" || j.status === "diagnosis").length,
        waitingApproval: approval.length,
        todayRevenue: todayRev,
        lowStock: low,
      });

      const todayBookings = jobs.filter((j: any) => (j.created_at ?? "").slice(0, 10) === today);
      setBookings(todayBookings.map((j: any) => ({
        id: j.id,
        plate: j.plate ?? "—",
        customer: j.customer_name ?? "—",
        service: ((j as any).service_types?.length || j.service_type)
          ? formatServiceTypes((j as any).service_types, j.service_type)
          : j.status,
        time: new Date(j.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      })));

      setActivity((recentRes.data ?? []).map((j: any) => ({
        text: `${j.job_no} · ${j.plate ?? "—"} → ${j.status}`,
        time: new Date(j.created_at).toLocaleString(),
        type: APPROVAL_STATUSES.includes(j.status) ? "warning" : "info",
      })));
    })();
    return () => { alive = false; };
  }, []);

  const statCards = [
    { label: "Vehicles in garage", value: stats.inGarage, icon: CarFront },
    { label: "Jobs in progress", value: stats.inProgress, icon: Cog },
    { label: "Waiting approval", value: stats.waitingApproval, icon: Fuel },
    { label: "Today's revenue", value: `KSh ${stats.todayRevenue.toLocaleString()}`, icon: CircleDollarSign },
    { label: "Low stock alerts", value: stats.lowStock, icon: PackageX },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-primary">Control Room</h1>
          <p className="text-sm text-muted-foreground">Live overview of today's garage operations</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm"><Search className="h-4 w-4 mr-2" />Search vehicle</Button>
          <Button variant="outline" size="sm"><Calendar className="h-4 w-4 mr-2" />Bookings</Button>
          <Button size="sm" onClick={() => navigate("/jobs")} className="bg-gradient-primary shadow-md">
            <Plus className="h-4 w-4 mr-2" />New Job Card
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {statCards.map(s => (
          <Card key={s.label} className="stat-card bg-gradient-card">
            <div className="flex items-start justify-between">
              <div className="icon-box-lg">
                <s.icon className="h-5 w-5" strokeWidth={2.25} />
              </div>
            </div>
            <p className="mt-3 text-2xl font-bold text-primary">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Activity feed */}
        <Card className="lg:col-span-2 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Live Activity</h2>
              <span className="flex h-2 w-2 rounded-full bg-success animate-pulse-soft" />
            </div>
            <Badge variant="secondary">Real-time</Badge>
          </div>
          <div className="space-y-3">
            {activity.length === 0 && (
              <p className="text-sm text-muted-foreground">No recent activity yet.</p>
            )}
            {activity.map((a, i) => (
              <div key={i} className="flex items-start gap-3 py-2 border-b last:border-0">
                <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${typeStyles[a.type]}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{a.text}</p>
                  <p className="text-xs text-muted-foreground">{a.time}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Right rail */}
        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold flex items-center gap-2"><Calendar className="h-4 w-4 text-primary" />Today's bookings</h2>
              <Badge variant="secondary">{bookings.length}</Badge>
            </div>
            <div className="space-y-2">
              {bookings.length === 0 && (
                <p className="text-sm text-muted-foreground">No active jobs.</p>
              )}
              {bookings.map(b => (
                <div key={b.id} className="flex items-center justify-between rounded-md p-2 hover:bg-muted/50">
                  <div>
                    <p className="text-sm font-medium">{b.plate}</p>
                    <p className="text-xs text-muted-foreground">{b.customer} · {b.service}</p>
                  </div>
                  <span className="text-xs font-semibold text-primary">{b.time}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5 border-muted">
            <h2 className="font-semibold flex items-center gap-2 mb-3"><Timer className="h-4 w-4 text-muted-foreground" />Status</h2>
            <p className="text-sm text-muted-foreground">Live metrics will populate as jobs move through the workflow.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
