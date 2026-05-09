import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Search,
  Calendar,
  Activity,
  Timer,
  CarFront,
  Cog,
  Fuel,
  CircleDollarSign,
  PackageX,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { formatServiceTypes } from "@/lib/service-types";
import { canonicalizeDocuments } from "@/lib/generated-records";
import { toDateValue, toLocalDateValue } from "@/lib/date-values";
import { sumBilledInvoicesForDay } from "@/lib/finance";

const typeStyles: Record<string, string> = {
  success: "bg-success",
  warning: "bg-warning",
  info: "bg-primary",
};

const OPEN_STATUSES = ["diagnosis", "diagnosis_approval", "parts", "parts_approval", "repair", "quality_check", "awaiting_approval"];
const APPROVAL_STATUSES = ["diagnosis_approval", "parts_approval", "awaiting_approval"];

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
      const today = toLocalDateValue();
      const [jobsRes, partsRes, stockRes, docsRes] = await Promise.all([
        supabase.from("jobs").select("id,status,plate,customer_name,service_type,service_types,created_at,updated_at,job_no").order("created_at", { ascending: false }),
        supabase.from("parts").select("id,min_stock"),
        supabase.from("part_stock").select("part_id,qty"),
        supabase.from("invoices").select("id, invoice_no, doc_type, amount, amount_paid, date, updated_at, created_at, payment_mode, discount"),
      ]);
      if (!alive) return;

      const jobs = jobsRes.data ?? [];
      const openJobs = jobs.filter((job) => OPEN_STATUSES.includes(job.status));
      const activeJobs = jobs.filter((job) => !["completed", "closed"].includes(job.status));
      const approvalJobs = jobs.filter((job) => APPROVAL_STATUSES.includes(job.status));
      const documents = canonicalizeDocuments(docsRes.data ?? []);

      const todayRevenue = sumBilledInvoicesForDay(documents, today);

      const totals = new Map<string, number>();
      (stockRes.data ?? []).forEach((row: any) => {
        totals.set(row.part_id, (totals.get(row.part_id) ?? 0) + Number(row.qty || 0));
      });
      const lowStock = (partsRes.data ?? []).filter((part: any) => (totals.get(part.id) ?? 0) < Number(part.min_stock || 0)).length;

      setStats({
        inGarage: openJobs.length,
        inProgress: activeJobs.filter((job) => ["diagnosis", "repair", "parts", "parts_approval"].includes(job.status)).length,
        waitingApproval: approvalJobs.length,
        todayRevenue,
        lowStock,
      });

      const todayBookings = jobs.filter((job: any) => toDateValue(job.created_at) === today);
      setBookings(todayBookings.map((job: any) => ({
        id: job.id,
        plate: job.plate ?? "-",
        customer: job.customer_name ?? "-",
        service: ((job as any).service_types?.length || job.service_type)
          ? formatServiceTypes((job as any).service_types, job.service_type)
          : job.status,
        time: new Date(job.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      })));

      const jobActivity = (jobs ?? []).slice(0, 6).map((job: any) => {
        const stamp = new Date(job.updated_at ?? job.created_at);
        return {
          text: `${job.job_no} | ${job.plate ?? "-"} -> ${job.status}`,
          time: stamp.toLocaleString(),
          sortKey: stamp.getTime(),
          type: APPROVAL_STATUSES.includes(job.status) ? "warning" : "info",
        };
      });

      const paymentActivity = documents
        .filter((doc: any) => ["receipt", "deposit_invoice"].includes(String(doc.doc_type ?? "")) && Number(doc.amount_paid || 0) > 0)
        .slice(0, 4)
        .map((doc: any) => {
          const stamp = new Date(doc.updated_at ?? doc.created_at ?? `${doc.date}T00:00:00`);
          return {
            text: `${doc.doc_type === "receipt" ? "Receipt" : "Deposit"} ${doc.invoice_no ?? doc.id?.slice(0, 8) ?? ""} | KSh ${Number(doc.amount_paid || 0).toLocaleString()}`,
            time: stamp.toLocaleString(),
            sortKey: stamp.getTime(),
            type: "success",
          };
        });

      setActivity(
        [...jobActivity, ...paymentActivity]
          .sort((a, b) => b.sortKey - a.sortKey)
          .slice(0, 8)
          .map(({ sortKey: _sortKey, ...row }) => row),
      );
    })();
    return () => {
      alive = false;
    };
  }, []);

  const statCards = [
    { label: "Vehicles in garage", value: stats.inGarage, icon: CarFront },
    { label: "Jobs in progress", value: stats.inProgress, icon: Cog },
    { label: "Waiting approval", value: stats.waitingApproval, icon: Fuel },
    { label: "Today's collections", value: `KSh ${stats.todayRevenue.toLocaleString()}`, icon: CircleDollarSign },
    { label: "Low stock alerts", value: stats.lowStock, icon: PackageX },
  ];

  return (
    <div className="space-y-6">
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

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {statCards.map((card) => (
          <Card key={card.label} className="stat-card bg-gradient-card">
            <div className="flex items-start justify-between">
              <div className="icon-box-lg">
                <card.icon className="h-5 w-5" strokeWidth={2.25} />
              </div>
            </div>
            <p className="mt-3 text-2xl font-bold text-primary">{card.value}</p>
            <p className="text-xs text-muted-foreground">{card.label}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 p-5">
          <div className="mb-4 flex items-center justify-between">
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
            {activity.map((item, index) => (
              <div key={index} className="flex items-start gap-3 border-b py-2 last:border-0">
                <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${typeStyles[item.type]}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{item.text}</p>
                  <p className="text-xs text-muted-foreground">{item.time}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold"><Calendar className="h-4 w-4 text-primary" />Today's check-ins</h2>
              <Badge variant="secondary">{bookings.length}</Badge>
            </div>
            <div className="space-y-2">
              {bookings.length === 0 && (
                <p className="text-sm text-muted-foreground">No check-ins recorded today.</p>
              )}
              {bookings.map((booking) => (
                <div key={booking.id} className="flex items-center justify-between rounded-md p-2 hover:bg-muted/50">
                  <div>
                    <p className="text-sm font-medium">{booking.plate}</p>
                    <p className="text-xs text-muted-foreground">{booking.customer} | {booking.service}</p>
                  </div>
                  <span className="text-xs font-semibold text-primary">{booking.time}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="border-muted p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><Timer className="h-4 w-4 text-muted-foreground" />Status</h2>
            <p className="text-sm text-muted-foreground">
              Today's collections follow the billed amount on final invoices dated today so the dashboard matches billing.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
