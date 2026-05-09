import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TrendingUp, Users, Package, Star, Send, FileSearch, Search, Loader2, CarFront,
  Wallet, FileText as FileTextIcon, Wrench, History as HistoryIcon, Palette, DollarSign,
} from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { toDateValue, toLocalDateValue } from "@/lib/date-values";
import { canonicalizeDocuments, canonicalizeGeneratedMovements } from "@/lib/generated-records";
import {
  getBillingDocumentDay,
  isCollectedPaymentDocument,
  sumBilledInvoices,
  sumOutstandingInvoices,
  sumRecordedPayments,
  sumRecordedPaymentsForDay,
} from "@/lib/finance";

interface JobLookup {
  job: any;
  previous: any[];
  parts: any[];
  petty: any[];
  invoices: any[];
  toolAssignments: any[];
  inspections: any[];
  gatePasses: any[];
  jobMechanics: any[];
}

const fmt = (n: number) => `KSh ${Math.round(n).toLocaleString()}`;
const dayKey = (iso: string) => toDateValue(iso);
const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  mpesa: "M-PESA",
  bank: "Bank transfer",
  card: "Card",
  cheque: "Cheque",
  unspecified: "Unspecified",
};
const PAYMENT_MODE_ORDER = ["cash", "mpesa", "bank", "card", "cheque", "unspecified"] as const;
const normalizePaymentMode = (value: string | null | undefined) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || "unspecified";
};
const paymentModeLabel = (value: string | null | undefined) =>
  PAYMENT_MODE_LABELS[normalizePaymentMode(value)] ?? "Unspecified";

export default function Reports() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">Owner intelligence center · Job-360, financials, mechanics, parts</p>
      </div>

      <Tabs defaultValue="job360">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-transparent p-0 sm:flex sm:flex-wrap">
          <TabsTrigger value="job360">Job 360°</TabsTrigger>
          <TabsTrigger value="financial">Financial</TabsTrigger>
          <TabsTrigger value="mechanics">Mechanics</TabsTrigger>
          <TabsTrigger value="parts">Parts</TabsTrigger>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="job360" className="mt-4"><Job360 /></TabsContent>
        <TabsContent value="financial" className="mt-4 space-y-4"><FinancialTab /></TabsContent>
        <TabsContent value="mechanics" className="mt-4"><MechanicsTab /></TabsContent>
        <TabsContent value="parts" className="mt-4"><PartsTab /></TabsContent>
        <TabsContent value="customers" className="mt-4"><CustomersTab /></TabsContent>
        <TabsContent value="audit" className="mt-4"><AuditTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function FinancialTab() {
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [petty, setPetty] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const sinceIso = new Date(Date.now() - 21 * 24 * 3600 * 1000).toISOString();
      const sinceDay = toDateValue(sinceIso);
      const [{ data: docRows }, { data: mv }, { data: pc }] = await Promise.all([
        supabase.from("invoices").select("id, job_id, plate, invoice_no, doc_type, amount, amount_paid, payment_mode, date, updated_at, created_at, discount").limit(1000),
        supabase.from("stock_movements").select("id, reference, created_at, qty, buy_price, sell_price, unit_price, type").gte("created_at", sinceIso).eq("type", "sale"),
        supabase.from("petty_cash_entries").select("date, amount, transaction_cost, type").gte("date", sinceDay),
      ]);
      setDocuments(canonicalizeDocuments(docRows ?? []));
      setMovements(canonicalizeGeneratedMovements(mv ?? []));
      setPetty(pc ?? []);
      setLoading(false);
    })();
  }, []);

  const { chart, totals } = useMemo(() => {
    const map = new Map<string, { day: string; parts: number; billed: number; collected: number }>();
    const paymentModeMap = new Map<string, { key: string; label: string; amount: number; count: number }>();
    const collectionBuckets = new Map<string, { amount: number; paymentMode: string | null | undefined; priority: number }>();
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = toLocalDateValue(new Date(Date.now() - i * 24 * 3600 * 1000));
      days.push(d);
      map.set(d, { day: d.slice(5), parts: 0, billed: 0, collected: 0 });
    }
    let partsRevenue = 0;
    let partsCost = 0;
    let pettyOut = 0;
    let billed7d = 0;
    let collected7d = 0;
    for (const m of movements) {
      const d = dayKey(m.created_at);
      const row = map.get(d);
      if (!row) continue;
      const sell = Number(m.sell_price ?? m.unit_price ?? 0) * Number(m.qty ?? 0);
      const cost = Number(m.buy_price ?? 0) * Number(m.qty ?? 0);
      row.parts += sell;
      partsRevenue += sell;
      partsCost += cost;
    }
    for (const doc of documents) {
      if (!isCollectedPaymentDocument(doc) && !(doc.doc_type === "invoice" && Number(doc.amount_paid || 0) > 0)) continue;
      const bucketKey = String(doc.job_id ?? doc.invoice_no ?? doc.id ?? "");
      if (!bucketKey) continue;
      const candidateAmount = doc.doc_type === "receipt"
        ? Math.max(Number(doc.amount_paid || 0), Number(doc.amount || 0))
        : Number(doc.amount_paid || 0);
      if (candidateAmount <= 0) continue;
      const priority = doc.doc_type === "receipt" ? 3 : doc.doc_type === "invoice" ? 2 : 1;
      const existing = collectionBuckets.get(bucketKey);
      if (!existing || priority > existing.priority || (priority === existing.priority && candidateAmount >= existing.amount)) {
        collectionBuckets.set(bucketKey, {
          amount: candidateAmount,
          paymentMode: doc.payment_mode,
          priority,
        });
      }
    }
    collectionBuckets.forEach((bucket) => {
      const key = normalizePaymentMode(bucket.paymentMode);
      const current = paymentModeMap.get(key) ?? {
        key,
        label: paymentModeLabel(bucket.paymentMode),
        amount: 0,
        count: 0,
      };
      current.amount += bucket.amount;
      current.count += 1;
      paymentModeMap.set(key, current);
    });
    for (const d of days) {
      const row = map.get(d);
      if (!row) continue;
      row.billed = sumBilledInvoices(documents.filter((doc) => getBillingDocumentDay(doc) === d));
      row.collected = sumRecordedPaymentsForDay(documents, d);
      billed7d += row.billed;
      collected7d += row.collected;
    }
    for (const p of petty) {
      if (p.type === "payment") pettyOut += Number(p.amount ?? 0) + Number(p.transaction_cost ?? 0);
    }
    const finalInvoices = documents.filter((doc) => doc.doc_type === "invoice");
    const chart = days.map(d => map.get(d)!);
    const paymentModes = PAYMENT_MODE_ORDER.map((key) => {
      const current = paymentModeMap.get(key);
      return current ?? { key, label: PAYMENT_MODE_LABELS[key], amount: 0, count: 0 };
    });
    return {
      chart,
      totals: {
        invoiceCount: finalInvoices.length,
        billed: sumBilledInvoices(documents),
        billed7d,
        collected: sumRecordedPayments(documents),
        collected7d,
        outstanding: sumOutstandingInvoices(documents),
        partsRevenue,
        partsCost,
        pettyOut,
        paymentModes,
      },
    };
  }, [documents, movements, petty]);

  if (loading) return <p className="text-center text-muted-foreground py-8">Loading financials…</p>;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="stat-card">
          <p className="text-xs text-muted-foreground">Final invoices</p>
          <p className="mt-1 text-3xl font-bold">{totals.invoiceCount}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Matches the billing register.</p>
        </Card>
        <Card className="stat-card">
          <p className="text-xs text-muted-foreground">Billed work</p>
          <p className="mt-1 text-3xl font-bold">{fmt(totals.billed)}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-success"><TrendingUp className="h-3 w-3" />Last 7d: {fmt(totals.billed7d)}</p>
        </Card>
        <Card className="stat-card">
          <p className="text-xs text-muted-foreground">Payments recorded</p>
          <p className="mt-1 text-3xl font-bold">{fmt(totals.collected)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Last 7d: {fmt(totals.collected7d)}</p>
        </Card>
        <Card className="stat-card">
          <p className="text-xs text-muted-foreground">Open invoice balance</p>
          <p className="mt-1 text-3xl font-bold">{fmt(totals.outstanding)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Unpaid amount still sitting on invoices.</p>
        </Card>
        <Card className="stat-card">
          <p className="text-xs text-muted-foreground">Petty cash out</p>
          <p className="text-3xl font-bold mt-1">{fmt(totals.pettyOut)}</p>
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="font-semibold mb-4">Revenue · Last 7 days</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <Legend />
              <Bar dataKey="parts" fill="hsl(var(--primary))" />
              <Bar dataKey="billed" fill="hsl(var(--accent))" />
              <Bar dataKey="collected" fill="hsl(var(--success))" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold">Collections by method</h3>
            <p className="text-xs text-muted-foreground">Cash, M-PESA, bank, card, cheque, and unspecified totals from recorded receipts and deposits.</p>
          </div>
          <Badge variant="outline">{totals.paymentModes.length} method{totals.paymentModes.length === 1 ? "" : "s"}</Badge>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {totals.paymentModes.map((mode) => (
            <div key={mode.key} className="rounded-md border bg-muted/20 p-4">
              <p className="text-xs uppercase text-muted-foreground">{mode.label}</p>
              <p className="mt-1 text-2xl font-bold">{fmt(mode.amount)}</p>
              <p className="text-[11px] text-muted-foreground">{mode.count} payment entr{mode.count === 1 ? "y" : "ies"}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <p className="text-xs text-muted-foreground">Parts margin (7d)</p>
          <p className="mt-1 text-2xl font-bold">{fmt(totals.partsRevenue - totals.partsCost)}</p>
          <p className="text-[11px] text-muted-foreground">{fmt(totals.partsRevenue)} minus {fmt(totals.partsCost)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs text-muted-foreground">Petty cash out (7d)</p>
          <p className="mt-1 text-2xl font-bold">{fmt(totals.pettyOut)}</p>
        </Card>
      </div>
    </div>
  );
}

function MechanicsTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();
  useEffect(() => {
    (async () => {
      const [{ data: jobs }, { data: assignments }, { data: mechanics }] = await Promise.all([
        supabase.from("jobs").select("id, mechanic, plate, status, started_at, completed_at, feedback_rating"),
        supabase.from("job_mechanics").select("job_id, mechanic_id"),
        supabase.from("mechanics").select("id, name"),
      ]);
      const mechanicNames = new Map<string, string>((mechanics ?? []).map((m: any) => [m.id, m.name]));
      const jobMap = new Map<string, any>((jobs ?? []).map((j: any) => [j.id, j]));
      const map = new Map<string, { name: string; jobs: number; completed: number; ratingSum: number; ratingN: number; durations: number[]; plates: Set<string> }>();

      for (const assignment of assignments ?? []) {
        const job = jobMap.get((assignment as any).job_id);
        if (!job) continue;
        const name = mechanicNames.get((assignment as any).mechanic_id) ?? ((job.mechanic ?? "Unassigned").trim() || "Unassigned");
        const row = map.get(name) ?? { name, jobs: 0, completed: 0, ratingSum: 0, ratingN: 0, durations: [], plates: new Set<string>() };
        row.jobs++;
        row.plates.add(job.plate);
        if (job.completed_at) {
          row.completed++;
          const dur = (new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 3600000;
          if (dur > 0 && dur < 24 * 30) row.durations.push(dur);
        }
        if (job.feedback_rating) { row.ratingSum += job.feedback_rating; row.ratingN++; }
        map.set(name, row);
        jobMap.delete(job.id);
      }

      for (const job of jobMap.values()) {
        const name = ((job.mechanic ?? "Unassigned").trim()) || "Unassigned";
        const row = map.get(name) ?? { name, jobs: 0, completed: 0, ratingSum: 0, ratingN: 0, durations: [], plates: new Set<string>() };
        row.jobs++;
        row.plates.add(job.plate);
        if (job.completed_at) {
          row.completed++;
          const dur = (new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 3600000;
          if (dur > 0 && dur < 24 * 30) row.durations.push(dur);
        }
        if (job.feedback_rating) { row.ratingSum += job.feedback_rating; row.ratingN++; }
        map.set(name, row);
      }
      setRows(Array.from(map.values()).map(r => {
        const avg = r.durations.length ? r.durations.reduce((a, b) => a + b, 0) / r.durations.length : 0;
        return {
          name: r.name,
          jobs: r.jobs,
          completed: r.completed,
          avgTime: avg ? `${avg.toFixed(1)}h` : "—",
          comebacks: r.jobs - r.plates.size,
          rating: r.ratingN ? (r.ratingSum / r.ratingN).toFixed(1) : "—",
        };
      }).sort((a, b) => b.jobs - a.jobs));
      setLoading(false);
    })();
  }, []);
  if (loading) return <p className="text-center text-muted-foreground py-8">Loading…</p>;
  return (
    <Card>
      <div className={isMobile ? "overflow-x-auto px-2" : "overflow-x-auto"}>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground">
            <th className="p-3">Mechanic</th><th className="p-3 text-right">Jobs</th>
            <th className="p-3 text-right">Completed</th><th className="p-3 text-right">Avg time</th>
            <th className="p-3 text-right">Comebacks</th><th className="p-3 text-right">Rating</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No mechanic data yet.</td></tr>
              : rows.map(m => (
              <tr key={m.name} className="border-b last:border-0 hover:bg-muted/40">
                <td className="p-3 font-medium flex items-center gap-2"><Users className="h-4 w-4 text-muted-foreground" />{m.name}</td>
                <td className="p-3 text-right font-bold">{m.jobs}</td>
                <td className="p-3 text-right">{m.completed}</td>
                <td className="p-3 text-right">{m.avgTime}</td>
                <td className="p-3 text-right">{m.comebacks > 2 ? <Badge variant="destructive">{m.comebacks}</Badge> : m.comebacks}</td>
                <td className="p-3 text-right flex items-center justify-end gap-1"><Star className="h-3 w-3 fill-warning text-warning" />{m.rating}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PartsTab() {
  const [fast, setFast] = useState<any[]>([]);
  const [suspicious, setSuspicious] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const { data } = await supabase.from("stock_movements")
        .select("id, reference, part_id, qty, type, job_id, parts(name, sku)")
        .gte("created_at", since);
      const movementRows = canonicalizeGeneratedMovements((data ?? []) as any[]);
      const map = new Map<string, { name: string; sku: string; sold: number }>();
      const susp: any[] = [];
      for (const m of movementRows as any[]) {
        if (m.type === "sale") {
          const k = m.part_id;
          const cur = map.get(k) ?? { name: m.parts?.name ?? "—", sku: m.parts?.sku ?? "", sold: 0 };
          cur.sold += Number(m.qty ?? 0);
          map.set(k, cur);
          if (!m.job_id) susp.push({ name: m.parts?.name ?? "—", qty: m.qty });
        }
      }
      setFast(Array.from(map.values()).sort((a, b) => b.sold - a.sold).slice(0, 8));
      setSuspicious(susp.slice(0, 10));
      setLoading(false);
    })();
  }, []);
  if (loading) return <p className="text-center text-muted-foreground py-8">Loading…</p>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2"><Package className="h-4 w-4 text-primary" />Fast moving parts (30d)</h3>
        {fast.length === 0 ? <p className="text-sm text-muted-foreground">No sales in last 30 days.</p>
          : fast.map((p, i) => (
          <div key={i} className="flex justify-between text-sm py-2 border-b last:border-0">
            <span>{p.name} <span className="text-xs text-muted-foreground font-mono">{p.sku}</span></span>
            <span className="font-bold">{p.sold} sold</span>
          </div>
        ))}
      </Card>
      <Card className="p-5 border-warning/40 bg-warning/5">
        <h3 className="font-semibold mb-3">Suspicious usage — sales without a job</h3>
        {suspicious.length === 0
          ? <p className="text-sm">All sales in the last 30 days are tied to a job. Clean book ✅</p>
          : <ul className="text-sm space-y-1">{suspicious.map((s, i) => <li key={i}>⚠ {s.name} × {s.qty}</li>)}</ul>}
      </Card>
    </div>
  );
}

function CustomersTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [leadRows, setLeadRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const { data: jobs } = await supabase.from("jobs")
        .select("plate, customer_name, customer_phone, completed_at, created_at, lead_source, lead_source_detail")
        .order("created_at", { ascending: false })
        .limit(500);
      const seen = new Set<string>();
      const out: any[] = [];
      const now = Date.now();
      for (const j of jobs ?? []) {
        if (seen.has(j.plate)) continue;
        seen.add(j.plate);
        const last = j.completed_at ?? j.created_at;
        const days = Math.floor((now - new Date(last).getTime()) / 86400000);
        if (days >= 80) out.push({ ...j, days });
      }
      setRows(out.slice(0, 15));
      setLeadRows((jobs ?? []).slice(0, 30));
      setLoading(false);
    })();
  }, []);
  if (loading) return <p className="text-center text-muted-foreground py-8">Loading…</p>;
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="font-semibold mb-4">How clients came to us</h3>
        <div className="grid gap-3 md:grid-cols-3">
          {Object.entries(leadRows.reduce((acc: Record<string, number>, row: any) => {
            const key = row.lead_source ?? "unknown";
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
          }, {})).length === 0 ? (
            <p className="text-sm text-muted-foreground">No lead-source data yet.</p>
          ) : (
            Object.entries(leadRows.reduce((acc: Record<string, number>, row: any) => {
              const key = row.lead_source ?? "unknown";
              acc[key] = (acc[key] ?? 0) + 1;
              return acc;
            }, {})).map(([source, count]) => (
              <div key={source} className="rounded-md bg-muted/40 p-3">
                <p className="text-xs uppercase text-muted-foreground">{source.replaceAll("_", " ")}</p>
                <p className="mt-1 text-2xl font-bold">{count}</p>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold mb-4">Recent customer sources</h3>
        {leadRows.length === 0 ? <p className="text-sm text-muted-foreground">No recent leads yet.</p>
          : <div className="space-y-2">
            {leadRows.slice(0, 12).map(lead => (
              <div key={`${lead.plate}-${lead.created_at}`} className="flex flex-col gap-2 rounded-md bg-muted/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span>{lead.plate} Â· {lead.customer_name ?? "â€”"} {lead.customer_phone ? `Â· ${lead.customer_phone}` : ""}</span>
                <Badge variant="secondary">{(lead.lead_source ?? "unknown").replaceAll("_", " ")}</Badge>
              </div>
            ))}
          </div>}
      </Card>

      <Card className="p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="font-semibold">Vehicles due for service (last visit &gt; 80 days)</h3>
        <Button size="sm" variant="outline" disabled title="SMS gateway not yet configured"><Send className="h-4 w-4 mr-2" />Send SMS reminders</Button>
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No customers due for reminders yet.</p>
        : <div className="space-y-2">
          {rows.map(v => (
            <div key={v.plate} className="flex flex-col gap-2 rounded-md bg-muted/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span>{v.plate} · {v.customer_name ?? "—"} {v.customer_phone ? `· ${v.customer_phone}` : ""}</span>
              <Badge variant="secondary">{v.days} days ago</Badge>
            </div>
          ))}
        </div>}
      </Card>
    </div>
  );
}

function AuditTab() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const [{ data: jobs }, { data: mv }, { data: gp }, { data: inv }] = await Promise.all([
        supabase.from("jobs").select("job_no, plate, status, created_at").order("created_at", { ascending: false }).limit(20),
        supabase.from("stock_movements").select("id, reference, type, qty, created_at, parts(name)").order("created_at", { ascending: false }).limit(50),
        supabase.from("gate_passes").select("pass_no, issued_at").order("issued_at", { ascending: false }).limit(10),
        supabase.from("invoices").select("id, job_id, invoice_no, doc_type, amount, created_at, updated_at").order("created_at", { ascending: false }).limit(50),
      ]);
      const events: any[] = [];
      (jobs ?? []).forEach((j: any) => events.push({ time: j.created_at, action: `Job ${j.job_no} (${j.plate}) — ${j.status}`, user: "Jobs" }));
      canonicalizeGeneratedMovements(mv ?? []).forEach((m: any) => events.push({ time: m.created_at, action: `Stock ${m.type}: ${m.parts?.name ?? "—"} × ${m.qty}`, user: "Inventory" }));
      (gp ?? []).forEach((g: any) => events.push({ time: g.issued_at, action: `Gate pass ${g.pass_no} issued`, user: "Gate" }));
      canonicalizeDocuments(inv ?? []).forEach((i: any) => events.push({ time: i.created_at, action: `${i.doc_type ?? "invoice"} ${i.invoice_no ?? ""} — KSh ${Number(i.amount).toLocaleString()}`, user: "Billing" }));
      events.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      setItems(events.slice(0, 50));
      setLoading(false);
    })();
  }, []);
  if (loading) return <p className="text-center text-muted-foreground py-8">Loading…</p>;
  return (
    <Card>
      <div className="p-4 border-b flex items-center gap-2"><FileSearch className="h-4 w-4 text-primary" /><h3 className="font-semibold">Activity audit (latest 50)</h3></div>
      <div className="divide-y">
        {items.length === 0 ? <p className="p-6 text-center text-muted-foreground text-sm">No activity yet.</p>
          : items.map((a, i) => (
          <div key={i} className="flex flex-col gap-1 p-3 text-sm hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="font-medium">{a.action}</p><p className="text-xs text-muted-foreground">{a.user}</p></div>
            <span className="text-xs text-muted-foreground font-mono">{new Date(a.time).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Job360() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<JobLookup | null>(null);
  const [loading, setLoading] = useState(false);

  const search = async () => {
    const q = query.trim().toUpperCase();
    if (!q) { toast.error("Type a job number (JOB-0001) or plate"); return; }
    setLoading(true);
    setData(null);
    const isJobNo = /^JOB[- ]?\d+/i.test(q);
    let job: any = null;
    if (isJobNo) {
      const norm = q.replace(/\s/g, "").replace(/^JOB-?/i, "JOB-");
      const { data } = await supabase.from("jobs").select("*").eq("job_no", norm).maybeSingle();
      job = data;
    }
    if (!job) {
      const { data } = await supabase.from("jobs").select("*").eq("plate", q)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      job = data;
    }
    if (!job) { toast.error("No job or plate matched"); setLoading(false); return; }

    const [
      { data: previous },
      { data: parts },
      { data: petty },
      { data: invoices },
      { data: toolAssignments },
      { data: inspections },
      { data: gatePasses },
      { data: jobMechanics },
      { data: mechanics },
    ] = await Promise.all([
      supabase.from("jobs").select("id, job_no, complaint, completed_at, created_at, status").eq("plate", job.plate).neq("id", job.id).order("created_at", { ascending: false }),
      supabase.from("stock_movements").select("*, parts(name, sku)").eq("job_id", job.id),
      supabase.from("petty_cash_entries").select("*").eq("job_id", job.id),
      supabase.from("invoices").select("*").eq("job_id", job.id),
      supabase.from("tool_assignments").select("*, tools(name, code), mechanics(name)").eq("job_id", job.id),
      supabase.from("inspections").select("id, manual_done, obd_done, status, created_at").eq("job_id", job.id),
      supabase.from("gate_passes").select("*").eq("job_id", job.id),
      supabase.from("job_mechanics").select("job_id, mechanic_id").eq("job_id", job.id),
      supabase.from("mechanics").select("id, name"),
    ]);

    setData({
      job,
      previous: previous ?? [],
      parts: canonicalizeGeneratedMovements(parts ?? []),
      petty: petty ?? [],
      invoices: canonicalizeDocuments(invoices ?? []),
      toolAssignments: toolAssignments ?? [],
      inspections: inspections ?? [],
      gatePasses: gatePasses ?? [],
      jobMechanics: (jobMechanics ?? []).map((assignment: any) => ({
        ...assignment,
        name: (mechanics ?? []).find((m: any) => m.id === assignment.mechanic_id)?.name ?? null,
      })),
    });
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <Label>Look up a job number or vehicle plate</Label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="JOB-0042  or  KCA 123A"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && search()}
              className="pl-9"
            />
          </div>
          <Button onClick={search} disabled={loading} className="w-full bg-gradient-primary sm:w-auto">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Pulls everything: timeline, mechanics, parts, petty cash, tools taken, inspections, invoices, gate pass and history of previous visits.
        </p>
      </Card>

      {data && <JobReport report={data} />}
    </div>
  );
}

function JobReport({ report }: { report: JobLookup }) {
  const { job, previous, parts, petty, invoices, toolAssignments, inspections, gatePasses, jobMechanics } = report;

  const partsCost = parts.reduce((s, m) => s + (Number(m.buy_price ?? m.unit_price ?? 0) * Number(m.qty ?? 0)), 0);
  const partsRevenue = parts.reduce((s, m) => s + (Number(m.sell_price ?? m.unit_price ?? 0) * Number(m.qty ?? 0)), 0);
  const pettyTotal = petty.reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const invoiced = Number(job.invoice_amount || sumBilledInvoices(invoices));
  const paid = Number(job.receipt_amount || sumRecordedPayments(invoices));
  const jobTotal = Number(job.invoice_amount || job.quotation_amount || job.estimate || 0);
  const profit = jobTotal - partsCost - pettyTotal;
  const mechanicLabel = jobMechanics.length > 0
    ? jobMechanics.map((assignment: any) => assignment.name).filter(Boolean).join(", ")
    : job.mechanic ?? "Unassigned";

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-mono font-bold text-primary">{job.job_no}</p>
            <h2 className="text-2xl font-bold flex items-center gap-2"><CarFront className="h-5 w-5" />{job.plate}</h2>
            <p className="text-sm text-muted-foreground">{job.vehicle_label ?? "—"} · {job.customer_name ?? "—"} · {job.customer_phone ?? "—"}</p>
            {job.paint_color_code && <Badge className="mt-2"><Palette className="h-3 w-3 mr-1" />{job.paint_color_code}</Badge>}
          </div>
          <div className="text-right">
            <Badge variant="outline" className="capitalize">{job.status}</Badge>
            <p className="text-xs text-muted-foreground mt-2">In: {new Date(job.started_at).toLocaleString()}</p>
            {job.completed_at && <p className="text-xs text-muted-foreground">Done: {new Date(job.completed_at).toLocaleString()}</p>}
          </div>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card className="p-4"><p className="text-xs text-muted-foreground">Job total</p><p className="text-xl font-bold">KSh {jobTotal.toLocaleString()}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Parts cost</p><p className="text-xl font-bold">KSh {partsCost.toLocaleString()}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Parts billed</p><p className="text-xl font-bold">KSh {partsRevenue.toLocaleString()}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Petty cash</p><p className="text-xl font-bold">KSh {pettyTotal.toLocaleString()}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Profit (est)</p><p className={`text-xl font-bold ${profit >= 0 ? "text-success" : "text-destructive"}`}>KSh {profit.toLocaleString()}</p></Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-3"><Wrench className="h-4 w-4 text-primary" />People & Timeline</h3>
          <ul className="space-y-2 text-sm">
            <li>📥 <strong>Check-in:</strong> {new Date(job.started_at).toLocaleString()}</li>
            <li>🔧 <strong>Mechanic:</strong> {mechanicLabel}</li>
            {inspections.length > 0 && <li>🩺 <strong>Inspections:</strong> {inspections.length} ({inspections.filter(i => i.status === "finished").length} finished)</li>}
            {toolAssignments.length > 0 && (
              <li>🛠️ <strong>Tools taken:</strong>
                <ul className="ml-4 mt-1">
                  {toolAssignments.map(t => (
                    <li key={t.id} className="text-xs">{t.tools?.name} → {t.mechanics?.name} {t.returned_at ? "(returned)" : "(still out)"}</li>
                  ))}
                </ul>
              </li>
            )}
            {job.completed_at && <li>✅ <strong>Completed:</strong> {new Date(job.completed_at).toLocaleString()}</li>}
            {gatePasses[0] && <li>🚪 <strong>Gate pass:</strong> {gatePasses[0].pass_no} on {new Date(gatePasses[0].issued_at).toLocaleString()}</li>}
            {job.customer_feedback && <li>💬 <strong>Feedback:</strong> {job.customer_feedback}</li>}
          </ul>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-3"><HistoryIcon className="h-4 w-4 text-primary" />Vehicle history ({previous.length})</h3>
          {previous.length === 0 ? (
            <p className="text-sm text-muted-foreground">First visit for this plate.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {previous.map(p => (
                <li key={p.id} className="flex flex-col gap-1 rounded bg-muted/40 p-2 sm:flex-row sm:items-center sm:justify-between">
                  <span><strong className="font-mono text-primary">{p.job_no}</strong> · {p.complaint ?? "—"}</span>
                  <span className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="font-semibold flex items-center gap-2 mb-3"><Package className="h-4 w-4 text-primary" />Parts ordered / used ({parts.length})</h3>
        {parts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No parts linked to this job.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="min-w-[640px] w-full text-sm">
            <thead><tr className="border-b text-xs uppercase text-muted-foreground"><th className="text-left p-2">Part</th><th className="text-right p-2">Qty</th><th className="text-right p-2">Buy</th><th className="text-right p-2">Sell</th><th className="text-right p-2">Type</th></tr></thead>
            <tbody>
              {parts.map((m, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="p-2">{m.parts?.name ?? "—"} <span className="text-xs text-muted-foreground">{m.parts?.sku ?? ""}</span></td>
                  <td className="p-2 text-right">{m.qty}</td>
                  <td className="p-2 text-right">{m.buy_price ? `KSh ${Number(m.buy_price).toLocaleString()}` : "—"}</td>
                  <td className="p-2 text-right">{m.sell_price ? `KSh ${Number(m.sell_price).toLocaleString()}` : "—"}</td>
                  <td className="p-2 text-right text-xs font-mono">{m.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-3"><FileTextIcon className="h-4 w-4 text-primary" />Invoices / Quotations / Receipts ({invoices.length})</h3>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {invoices.map(i => (
                <li key={i.id} className="flex flex-col gap-1 rounded bg-muted/40 p-2 sm:flex-row sm:items-center sm:justify-between">
                  {(i.amount_paid || i.payment_reference) ? (
                    <span className="text-xs text-muted-foreground sm:order-3 sm:w-full">
                      Paid via {paymentModeLabel(i.payment_mode)}
                      {i.payment_reference ? ` · ${i.payment_reference}` : ""}
                    </span>
                  ) : null}
                  <span>{i.doc_type ?? "invoice"} · {i.invoice_no ?? i.id.slice(0, 8)}</span>
                  <span>KSh {Number(i.amount).toLocaleString()} · paid {Number(i.amount_paid).toLocaleString()}</span>
                </li>
              ))}
              <li className="pt-2 border-t flex justify-between font-bold"><span>Totals</span><span>KSh {invoiced.toLocaleString()} / paid {paid.toLocaleString()}</span></li>
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-3"><Wallet className="h-4 w-4 text-primary" />Petty cash on this job ({petty.length})</h3>
          {petty.length === 0 ? (
            <p className="text-sm text-muted-foreground">No petty cash linked.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {petty.map(e => (
                <li key={e.id} className="flex flex-col gap-1 rounded bg-muted/40 p-2 sm:flex-row sm:items-center sm:justify-between">
                  {(e.payment_mode || e.payment_reference) ? (
                    <span className="text-xs text-muted-foreground sm:order-3 sm:w-full">
                      {paymentModeLabel(e.payment_mode)}
                      {e.payment_reference ? ` · ${e.payment_reference}` : ""}
                    </span>
                  ) : null}
                  <span>{e.payee ?? e.details ?? e.type}</span>
                  <span>KSh {Number(e.amount).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className={`p-5 ${profit >= 0 ? "border-success/50 bg-success/5" : "border-destructive/50 bg-destructive/5"}`}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2"><DollarSign className="h-4 w-4" />Bottom line</h3>
          <p className={`text-2xl font-bold ${profit >= 0 ? "text-success" : "text-destructive"}`}>KSh {profit.toLocaleString()}</p>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          (Invoiced {invoiced ? `KSh ${invoiced.toLocaleString()}` : `Estimate KSh ${Number(job.estimate).toLocaleString()}`}) − Parts cost − Petty cash
        </p>
      </Card>
    </div>
  );
}
