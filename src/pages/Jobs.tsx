import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Plus, Wrench, Package, CheckCircle2, ArrowLeft, Clock, User, FileText, Sparkles,
  Stethoscope, ClipboardList, Receipt, FileSignature, ShieldCheck, History, Palette, DollarSign,
  ShieldAlert, Loader2, Send, Trash2, AlertTriangle, Lock, Link2, Copy, Star, QrCode, MessageCircle, KeyRound, Mail,
} from "lucide-react";
import QRCode from "qrcode";
import { CameraInput } from "@/components/CameraInput";
import { RequestPartDialog } from "@/components/RequestPartDialog";
import { InspectionWizard } from "@/components/InspectionWizard";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { readEdgeFunctionErrorMessage } from "@/lib/edge-function-error";
import { getInspectionSystemLabel, isServiceCategory } from "@/lib/inspection-tree";
import {
  generateInvoicePDF, generateQuotationPDF, generateReceiptPDF,
  generateJobCardPDF, generateGatePassPDF,
} from "@/lib/pdf-templates";

type JobStatus = "diagnosis" | "diagnosed" | "diagnosis_approval" | "parts" | "parts_approval" | "repair" | "awaiting_approval" | "completed" | "closed";

const ALL_STATUSES: JobStatus[] = [
  "diagnosis","diagnosed","diagnosis_approval","parts","parts_approval","repair","awaiting_approval","completed","closed",
];

// Logical next-step transitions. Forward-only by default; backward allowed only with override.
const NEXT_STATUSES: Record<JobStatus, JobStatus[]> = {
  diagnosis:           ["diagnosed"],
  diagnosed:           ["diagnosis_approval", "parts"],
  diagnosis_approval:  ["parts"],
  parts:               ["parts_approval", "repair"],
  parts_approval:      ["repair"],
  repair:              ["awaiting_approval", "completed"],
  awaiting_approval:   ["completed"],
  completed:           ["closed"],
  closed:              [],
};

const STATUS_LABEL: Record<JobStatus, string> = {
  diagnosis: "Awaiting Diagnosis",
  diagnosed: "Diagnosed",
  diagnosis_approval: "Client Diagnosis Approval",
  parts: "Awaiting Parts",
  parts_approval: "Approve Parts for Fitting",
  repair: "In Repair",
  awaiting_approval: "Awaiting Client Approval",
  completed: "Completed",
  closed: "Closed",
};

interface Job {
  id: string;
  job_no: string;
  plate: string;
  customer_name: string | null;
  customer_phone: string | null;
  vehicle_label: string | null;
  complaint: string | null;
  reported_problem: string | null;
  work_performed: string | null;
  mechanic: string | null;
  estimate: number;
  status: JobStatus;
  service_type: string | null;
  paint_color_code: string | null;
  previous_job_id: string | null;
  customer_feedback: string | null;
  gate_pass_issued: boolean;
  started_at: string;
  completed_at: string | null;
  paid_at: string | null;
  notes: string | null;
  has_insurance: boolean;
  insurance_company: string | null;
  insurance_policy_no: string | null;
  ai_diagnostic_summary: string | null;
  recommended_parts: Array<{ name: string; qty: number; reason: string; severity: string; requested?: boolean }>;
  financial_summary: string | null;
  quotation_amount: number;
  invoice_amount: number;
  receipt_amount: number;
  discount_amount: number;
  discount_reason: string | null;
  assigned_mechanic_id: string | null;
  client_feedback_token: string | null;
  client_approved_at: string | null;
  client_rating: number | null;
  feedback_rating: number | null;
}

const columns: { key: JobStatus; label: string; color: string }[] = [
  { key: "diagnosis",  label: "Awaiting Diagnosis",    color: "bg-status-diag" },
  { key: "diagnosed",  label: "Diagnosed",             color: "bg-status-diagnosed" },
  { key: "diagnosis_approval", label: "Client Diagnosis Approval", color: "bg-status-approval" },
  { key: "parts",      label: "Awaiting Parts",        color: "bg-status-parts" },
  { key: "parts_approval", label: "Approve Parts for Fitting", color: "bg-status-approval" },
  { key: "repair",     label: "In Repair",             color: "bg-status-repair" },
  { key: "awaiting_approval", label: "Awaiting Client Approval", color: "bg-status-approval" },
  { key: "completed",  label: "Completed",             color: "bg-status-done" },
];

const elapsed = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3.6e6);
  if (h < 1) return `${Math.floor(ms / 6e4)}m`;
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

const NON_MECHANIC_ROLES = ["admin", "super_admin", "director", "manager", "reception", "storekeeper"] as const;

const isMechanicOnlyUser = (roles: string[] = []) =>
  roles.includes("mechanic") && !roles.some((role) => NON_MECHANIC_ROLES.includes(role as any));

const calculateLineSubtotal = (rows: Array<{ qty?: number; unit_price?: number }>) =>
  rows.reduce((sum, row) => sum + Number(row.qty || 0) * Number(row.unit_price || 0), 0);

const calculateLineTotal = (rows: Array<{ qty?: number; unit_price?: number }>, discount: number) =>
  Math.max(0, calculateLineSubtotal(rows) - Number(discount || 0));

const getJobChargeAmount = (job: Partial<Job>) =>
  Math.max(
    0,
    Number(job.invoice_amount ?? 0),
    Number(job.quotation_amount ?? 0),
    Number(job.estimate ?? 0),
  );

const getJobPaidAmount = (job: Partial<Job>) => Math.max(0, Number(job.receipt_amount ?? 0));

const isJobSettled = (job: Partial<Job>) => {
  const total = getJobChargeAmount(job);
  return job.status === "closed" || (total > 0 && getJobPaidAmount(job) >= total);
};

type GatePassRow = { id: string; pass_no: string; issued_at: string };

async function ensureGatePass(jobId: string) {
  const { data: existing, error: existingError } = await supabase
    .from("gate_passes")
    .select("id, pass_no, issued_at")
    .eq("job_id", jobId)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing as GatePassRow;

  const { data, error } = await supabase
    .from("gate_passes")
    .insert({ job_id: jobId })
    .select("id, pass_no, issued_at")
    .single();
  if (error) throw error;
  return data as GatePassRow;
}

async function downloadGatePass(job: Job, passNo: string, amountPaid: number) {
  await generateGatePassPDF({
    pass_no: passNo,
    job_no: job.job_no,
    plate: job.plate,
    vehicle: job.vehicle_label ?? "",
    customer_name: job.customer_name ?? "",
    customer_phone: job.customer_phone ?? "",
    amount_paid: amountPaid,
    total: getJobChargeAmount(job),
    technicians: job.mechanic ?? "",
    issued_by: "Reception",
    date: new Date().toLocaleString(),
  });
}

export default function Jobs() {
  const { user, loading: authLoading } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [openJob, setOpenJob] = useState<Job | null>(null);
  const [tab, setTab] = useState("active");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (authLoading) return;
    setLoading(true);
    const mechanicOnly = isMechanicOnlyUser(user?.roles ?? []);
    if (mechanicOnly) {
      const { data: mechanic, error: mechanicError } = await supabase
        .from("mechanics")
        .select("id")
        .ilike("name", user?.displayName ?? "")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (mechanicError) {
        toast.error(mechanicError.message);
        setJobs([]);
        setLoading(false);
        return;
      }
      if (!mechanic?.id) {
        setJobs([]);
        setLoading(false);
        return;
      }

      const [{ data: directJobs, error: directError }, { data: assignments, error: assignmentError }] = await Promise.all([
        supabase.from("jobs").select("*").eq("assigned_mechanic_id", mechanic.id),
        supabase.from("job_mechanics").select("job_id").eq("mechanic_id", mechanic.id),
      ]);
      if (directError || assignmentError) {
        toast.error(directError?.message ?? assignmentError?.message ?? "Could not load jobs");
        setJobs([]);
        setLoading(false);
        return;
      }

      const ids = Array.from(
        new Set([
          ...(directJobs ?? []).map((row: any) => row.id),
          ...((assignments ?? []) as Array<{ job_id: string }>).map((row) => row.job_id),
        ]),
      );
      if (ids.length === 0) {
        setJobs([]);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .in("id", ids)
        .order("created_at", { ascending: false });
      if (error) toast.error(error.message);
      else setJobs((data ?? []) as unknown as Job[]);
    } else {
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) toast.error(error.message);
      else setJobs((data ?? []) as unknown as Job[]);
    }
    setLoading(false);
  };
  useEffect(() => {
    if (!authLoading) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id, user?.displayName, (user?.roles ?? []).join("|")]);

  const updateStatus = async (id: string, status: JobStatus) => {
    const patch: any = { status };
    if (status === "completed") patch.completed_at = new Date().toISOString();
    if (status === "closed") patch.closed_at = new Date().toISOString();
    const { error } = await supabase.from("jobs").update(patch).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(`Moved to ${status}`); load(); }
  };

  if (openJob) return (
    <JobWorkspace
      jobId={openJob.id}
      onBack={() => { setOpenJob(null); load(); }}
      onMoveStatus={(s) => updateStatus(openJob.id, s)}
    />
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Jobs</h1>
        <p className="text-sm text-muted-foreground">Every car gets a job number — and that number ties everything together</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="checkin">Check-In</TabsTrigger>
          <TabsTrigger value="active">Active Jobs</TabsTrigger>
          <TabsTrigger value="billing">Completed / Gate Pass</TabsTrigger>
        </TabsList>

        <TabsContent value="checkin" className="mt-4">
          <CheckInForm onCreated={() => { setTab("active"); load(); }} userId={user?.id} />
        </TabsContent>

        <TabsContent value="active" className="mt-4">
          {loading ? (
            <p className="text-center text-muted-foreground py-8">Loading…</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
              {columns.map(col => {
                const items = jobs.filter(j => j.status === col.key);
                return (
                  <div key={col.key} className="flex flex-col rounded-xl bg-muted/30 p-3">
                    <div className="flex items-center justify-between mb-3 px-1">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${col.color}`} />
                        <h3 className="text-sm font-semibold">{col.label}</h3>
                      </div>
                      <Badge variant="secondary" className="h-5 text-[10px]">{items.length}</Badge>
                    </div>
                    <div className="space-y-2 min-h-[100px]">
                      {items.map(j => (
                        <Card
                          key={j.id}
                          className="p-3 hover:shadow-md hover:border-primary/40 transition-all bg-card cursor-pointer"
                          onClick={() => setOpenJob(j)}
                        >
                          <div className="flex items-start justify-between mb-1">
                            <span className="text-xs font-mono text-primary font-bold">{j.job_no}</span>
                            <Badge variant="outline" className="text-[10px] h-4">{elapsed(j.started_at)}</Badge>
                          </div>
                          <p className="font-bold text-sm">{j.plate}</p>
                          <p className="text-xs text-muted-foreground truncate">{j.vehicle_label ?? "—"}</p>
                          <div className="mt-2 pt-2 border-t flex items-center justify-between text-[11px]">
                            <span className="flex items-center gap-1 text-muted-foreground"><User className="h-3 w-3" />{j.mechanic ?? "Unassigned"}</span>
                            {j.previous_job_id && (
                              <span className="flex items-center gap-1 text-amber-600" title="Re-admitted vehicle"><History className="h-3 w-3" /></span>
                            )}
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="billing" className="mt-4">
          <Card>
            <div className="p-4 border-b">
              <h3 className="font-semibold">Completed jobs ready for billing & gate pass</h3>
            </div>
            <div className="divide-y">
              {jobs.filter(j => j.status === "completed" || j.status === "closed").map(j => (
                <BillingRow key={j.id} job={j} onOpen={() => setOpenJob(j)} onChange={load} />
              ))}
              {jobs.filter(j => j.status === "completed" || j.status === "closed").length === 0 && (
                <p className="p-6 text-center text-muted-foreground text-sm">No completed jobs yet.</p>
              )}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BillingRow({ job, onOpen, onChange }: { job: Job; onOpen: () => void; onChange: () => void }) {
  const totalDue = getJobChargeAmount(job);
  const amountPaid = getJobPaidAmount(job);
  const settled = isJobSettled(job);

  const issueGatePass = async () => {
    if (!settled) {
      toast.error("Record full payment before issuing the gate pass");
      return;
    }
    try {
      const gatePass = await ensureGatePass(job.id);
      await supabase.from("jobs").update({
        gate_pass_issued: true,
        status: "closed",
        closed_at: new Date().toISOString(),
      }).eq("id", job.id);
      await downloadGatePass(job, gatePass.pass_no, amountPaid || totalDue);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not issue gate pass");
      return;
    }
    toast.success("Gate pass issued — drive safely!");
    onChange();
  };

  return (
    <div className="flex items-center justify-between p-4 hover:bg-muted/40">
      <div className="flex items-center gap-4 cursor-pointer flex-1" onClick={onOpen}>
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-success/10 text-success">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div>
          <p className="font-semibold">{job.plate} <span className="text-xs font-mono text-primary ml-1">{job.job_no}</span></p>
          <p className="text-xs text-muted-foreground">{job.customer_name ?? "—"} · {job.vehicle_label ?? "—"}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-bold text-sm">KSh {Number(totalDue).toLocaleString()}</span>
        {job.gate_pass_issued ? (
          <>
            <Badge className="bg-success">Gate pass issued</Badge>
            <Button size="sm" variant="outline" onClick={issueGatePass}>
              <ShieldCheck className="h-3 w-3 mr-1" />Reprint
            </Button>
          </>
        ) : !settled ? (
          <Badge variant="outline">Awaiting payment</Badge>
        ) : (
          <Button size="sm" className="bg-gradient-primary" onClick={issueGatePass}>
            <ShieldCheck className="h-3 w-3 mr-1" />Issue gate pass
          </Button>
        )}
      </div>
    </div>
  );
}

function CheckInForm({ onCreated, userId }: { onCreated: () => void; userId?: string }) {
  const [plate, setPlate] = useState("");
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [assignedMechIds, setAssignedMechIds] = useState<string[]>([]);
  const [mechRoster, setMechRoster] = useState<Array<{ id: string; name: string; specialties: string[]; level: string }>>([]);
  const [complaint, setComplaint] = useState("");
  const [serviceType, setServiceType] = useState<string>("mechanical");
  const [paintCode, setPaintCode] = useState("");
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);
  const [hasInsurance, setHasInsurance] = useState(false);
  const [insuranceCompany, setInsuranceCompany] = useState("");
  const [insurancePolicy, setInsurancePolicy] = useState("");
  const [history, setHistory] = useState<{ count: number; lastJobNo?: string }>({ count: 0 });

  // Load mechanic roster for the multi-select
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("mechanics")
        .select("id, name, specialties, level")
        .eq("active", true)
        .order("name");
      setMechRoster((data ?? []) as any);
    })();
  }, []);

  // Re-admission detection
  useEffect(() => {
    const p = plate.trim().toUpperCase();
    if (p.length < 4) { setHistory({ count: 0 }); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("jobs")
        .select("job_no")
        .eq("plate", p)
        .order("created_at", { ascending: false })
        .limit(5);
      setHistory({ count: data?.length ?? 0, lastJobNo: data?.[0]?.job_no });
    }, 400);
    return () => clearTimeout(t);
  }, [plate]);

  const analysePhotos = async () => {
    const imgs = ["front", "back", "left", "right"].map(s => photos[s]).filter(Boolean);
    if (imgs.length === 0) { toast.error("Take at least one vehicle photo first"); return; }
    setAiBusy(true);
    try {
      const { data, error, response } = await supabase.functions.invoke("vehicle-vision", { body: { images: imgs } });
      if (error || (data as any)?.error) {
        const message = (data as any)?.error
          ?? await readEdgeFunctionErrorMessage(error, response, "AI failed");
        toast.error(message);
        return;
      }
      setAiResult(data);
      if (data?.make && !make) setMake(data.make);
      if (data?.model && !model) setModel(data.model);
      if (data?.plate && !plate) setPlate(String(data.plate).toUpperCase());
      if (Array.isArray(data?.visible_problems) && data.visible_problems.length && !complaint) {
        setComplaint(data.visible_problems.map((p: any) => `• ${p.area}: ${p.problem} (${p.severity})`).join("\n"));
      }
      toast.success("Photos analysed — review and edit anything that's wrong");
    } finally {
      setAiBusy(false);
    }
  };

  const toggleMech = (id: string) =>
    setAssignedMechIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!plate.trim()) { toast.error("Plate is required"); return; }
    const vehicleLabel = [make.trim(), model.trim()].filter(Boolean).join(" ") || null;
    const mechNames = mechRoster.filter(m => assignedMechIds.includes(m.id)).map(m => m.name).join(", ") || null;
    setBusy(true);
    const { data: job, error } = await supabase.from("jobs").insert({
      plate: plate.trim().toUpperCase(),
      customer_name: customer || null,
      customer_phone: phone || null,
      vehicle_label: vehicleLabel,
      mechanic: mechNames,
      assigned_mechanic_id: assignedMechIds[0] ?? null,
      complaint: complaint || null,
      reported_problem: complaint || null,
      service_type: serviceType,
      paint_color_code: serviceType === "body" ? (paintCode || null) : null,
      estimate: 0,
      has_insurance: hasInsurance,
      insurance_company: hasInsurance ? (insuranceCompany || null) : null,
      insurance_policy_no: hasInsurance ? (insurancePolicy || null) : null,
      status: "diagnosis",
      created_by: userId ?? null,
    }).select("id").single();
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      // Persist multi-mechanic assignment
      if (job?.id && assignedMechIds.length) {
        await supabase.from("job_mechanics").insert(
          assignedMechIds.map((mid, i) => ({ job_id: job.id, mechanic_id: mid, role_on_job: i === 0 ? "lead" : "assist" }))
        );
      }
      toast.success("Job card created — number assigned");
      onCreated();
    }
  };

  return (
    <Card className="p-6 max-w-3xl">
      <h3 className="font-semibold mb-4 flex items-center gap-2"><Plus className="h-4 w-4 text-primary" />New Check-In</h3>

      {history.count > 0 && (
        <div className="mb-4 rounded-md border-2 border-amber-500/40 bg-amber-500/10 p-3 text-sm flex items-start gap-2">
          <History className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-amber-900 dark:text-amber-200">Welcome back! This vehicle has {history.count} previous job{history.count > 1 ? "s" : ""}.</p>
            <p className="text-xs text-amber-700 dark:text-amber-300">Last job: {history.lastJobNo}. Past history will auto-link to this new job.</p>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Customer name</Label>
          <Input placeholder="Customer name" value={customer} onChange={e => setCustomer(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Phone</Label>
          <Input placeholder="+254 7XX XXX XXX" value={phone} onChange={e => setPhone(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Plate Number</Label>
          <div className="flex gap-2">
            <Input placeholder="KCA 123A" value={plate} onChange={e => setPlate(e.target.value)} required />
            <CameraInput onPick={(_, url) => setPhotos(p => ({ ...p, plate: url }))} />
          </div>
          {photos.plate && <img src={photos.plate} alt="plate" className="h-12 rounded mt-1" />}
        </div>
        <div className="space-y-2">
          <Label>Make</Label>
          <Input list="vehicle-makes" placeholder="Mazda" value={make} onChange={e => setMake(e.target.value)} />
          <datalist id="vehicle-makes">
            <option value="Mazda" /><option value="Toyota" /><option value="Nissan" /><option value="Honda" />
            <option value="Mitsubishi" /><option value="Subaru" /><option value="Suzuki" /><option value="Isuzu" />
            <option value="Mercedes-Benz" /><option value="BMW" /><option value="Volkswagen" /><option value="Ford" />
            <option value="Hyundai" /><option value="Kia" /><option value="Land Rover" />
          </datalist>
        </div>
        <div className="space-y-2">
          <Label>Model</Label>
          <Input
            list={make.toLowerCase() === "mazda" ? "mazda-models" : undefined}
            placeholder={make.toLowerCase() === "mazda" ? "Demio / Axela / CX-5…" : "Demio, Premio, Note…"}
            value={model}
            onChange={e => setModel(e.target.value)}
          />
          <datalist id="mazda-models">
            <option value="Demio" /><option value="Axela" /><option value="Atenza" />
            <option value="CX-3" /><option value="CX-5" /><option value="CX-7" />
            <option value="CX-8" /><option value="CX-9" /><option value="Mazda2" />
            <option value="Mazda3" /><option value="Mazda6" /><option value="Premacy" />
            <option value="BT-50" /><option value="Bongo" /><option value="Verisa" />
            <option value="Familia" /><option value="RX-8" /><option value="MX-5" />
            <option value="Tribute" /><option value="Roadster" />
          </datalist>
          {make.toLowerCase() === "mazda" && <p className="text-[11px] text-muted-foreground">🔧 Mazda-friendly: pick a Mazda model from the dropdown.</p>}
        </div>
        <div className="space-y-2">
          <Label>Service type</Label>
          <Select value={serviceType} onValueChange={setServiceType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mechanical">Mechanical</SelectItem>
              <SelectItem value="service">Service</SelectItem>
              <SelectItem value="electrical">Electrical</SelectItem>
              <SelectItem value="general_checkup">General Check-up</SelectItem>
              <SelectItem value="body">Body / Paint</SelectItem>
              <SelectItem value="diagnosis">Diagnosis only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {serviceType === "body" && (
          <div className="space-y-2">
            <Label className="flex items-center gap-1"><Palette className="h-3 w-3" />Paint colour code</Label>
            <Input placeholder="e.g. 1G3 (Toyota Magnetic Gray)" value={paintCode} onChange={e => setPaintCode(e.target.value)} />
          </div>
        )}
        <div className="md:col-span-2 space-y-2">
          <Label>Assigned mechanics <span className="text-xs text-muted-foreground font-normal">(pick one or more — first picked is the lead)</span></Label>
          {mechRoster.length === 0 ? (
            <p className="text-xs text-muted-foreground">No mechanics yet. Add one in <strong>Tools → Mechanic</strong>.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {mechRoster.map(m => {
                const on = assignedMechIds.includes(m.id);
                const isLead = on && assignedMechIds[0] === m.id;
                return (
                  <button
                    type="button" key={m.id} onClick={() => toggleMech(m.id)}
                    className={`px-3 py-1.5 rounded-full text-xs border transition flex items-center gap-1.5 ${on ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 hover:bg-muted"}`}
                    title={(m.specialties ?? []).join(", ")}
                  >
                    <User className="h-3 w-3" />
                    {m.name}
                    <span className="opacity-70 capitalize">· {m.level}</span>
                    {isLead && <Badge variant="secondary" className="ml-1 h-4 text-[9px]">LEAD</Badge>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="md:col-span-2 space-y-2">
          <Label>Reported problem</Label>
          <Textarea placeholder="What the customer reported when bringing in the car…" value={complaint} onChange={e => setComplaint(e.target.value)} />
        </div>

        <div className="md:col-span-2 space-y-2 rounded-md border p-3 bg-muted/30">
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <input type="checkbox" checked={hasInsurance} onChange={e => setHasInsurance(e.target.checked)} className="h-4 w-4 accent-primary" />
            <ShieldAlert className="h-4 w-4 text-primary" />
            This car is covered by insurance
          </label>
          {hasInsurance && (
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div><Label className="text-xs">Insurance company</Label><Input value={insuranceCompany} onChange={e => setInsuranceCompany(e.target.value)} placeholder="e.g. Britam, Jubilee, AAR" /></div>
              <div><Label className="text-xs">Policy number</Label><Input value={insurancePolicy} onChange={e => setInsurancePolicy(e.target.value)} placeholder="POL-123456" /></div>
            </div>
          )}
        </div>
        <div className="md:col-span-2 space-y-2">
          <div className="flex items-center justify-between">
            <Label>Vehicle photos (4 angles) — tap to take photo or pick from files</Label>
            <Button type="button" size="sm" variant="outline" onClick={analysePhotos} disabled={aiBusy}>
              {aiBusy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
              {aiBusy ? "Analysing…" : "AI detect make / model / damage"}
            </Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            {["front", "back", "left", "right"].map(side => (
              <div key={side} className="aspect-square rounded-lg border-2 border-dashed border-border hover:border-primary hover:bg-muted/40 flex flex-col items-center justify-center gap-1 relative overflow-hidden">
                {photos[side] ? (
                  <img src={photos[side]} alt={side} className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <span className="text-[11px] text-muted-foreground capitalize font-medium">{side}</span>
                )}
                <div className="absolute bottom-1.5 right-1.5">
                  <CameraInput
                    size="sm"
                    onPick={(_, url) => {
                      setPhotos(p => {
                        const next = { ...p, [side]: url };
                        // Auto-scan first captured photo to fill plate / make / model when empty
                        const firstPhoto = !p.front && !p.back && !p.left && !p.right;
                        if (firstPhoto && (!plate || !make || !model)) {
                          setTimeout(() => analysePhotos(), 50);
                        }
                        return next;
                      });
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          {aiResult && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
              <p className="font-semibold flex items-center gap-1"><Sparkles className="h-3 w-3 text-primary" /> AI suggestion (you can edit any field)</p>
              <p>Make / Model: <strong>{aiResult.make || "?"} {aiResult.model || ""}</strong> {aiResult.year_guess && `(${aiResult.year_guess})`} · confidence {Math.round((aiResult.confidence ?? 0) * 100)}%</p>
              {aiResult.color && <p>Colour: {aiResult.color}</p>}
              {Array.isArray(aiResult.visible_problems) && aiResult.visible_problems.length > 0 && (
                <ul className="list-disc list-inside">
                  {aiResult.visible_problems.map((p: any, i: number) => (
                    <li key={i}><strong className="capitalize">{p.severity}</strong> — {p.area}: {p.problem}</li>
                  ))}
                </ul>
              )}
              {(!aiResult.make && !aiResult.model) && <p className="text-muted-foreground italic">Couldn't detect make/model from these photos — please key it in.</p>}
            </div>
          )}
        </div>
        <div className="md:col-span-2 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => { setPlate(""); setCustomer(""); setPhone(""); setAssignedMechIds([]); setMake(""); setModel(""); setComplaint(""); setPhotos({}); setPaintCode(""); setAiResult(null); }}>Reset</Button>
          <Button type="submit" disabled={busy} className="bg-gradient-primary">
            <Plus className="h-4 w-4 mr-2" />{busy ? "Creating…" : "Create Job Card"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ===== Job workspace (single job detail) =====
function JobWorkspace({ jobId, onBack, onMoveStatus }: {
  jobId: string;
  onBack: () => void;
  onMoveStatus: (s: JobStatus) => void;
}) {
  const { hasRole } = useAuth();
  const canApproveFitting = hasRole("mechanic") || hasRole("admin") || hasRole("super_admin") || hasRole("storekeeper") || hasRole("manager") || hasRole("director");
  const isMechanicOnly = hasRole("mechanic") && !(hasRole("admin") || hasRole("super_admin") || hasRole("director") || hasRole("manager") || hasRole("reception") || hasRole("storekeeper"));
  const canSeeFinances = !isMechanicOnly;
  const canManageJob = hasRole("admin") || hasRole("super_admin") || hasRole("manager") || hasRole("director");
  const [job, setJob] = useState<Job | null>(null);
  const [previous, setPrevious] = useState<Job | null>(null);
  const [partsUsed, setPartsUsed] = useState<any[]>([]);
  const [pettyForJob, setPettyForJob] = useState<any[]>([]);
  const [invoicesForJob, setInvoicesForJob] = useState<any[]>([]);
  const [requestOpen, setRequestOpen] = useState(false);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [tab, setTab] = useState<"overview" | "diagnosis" | "financial" | "documents">("overview");
  const [findings, setFindings] = useState<any[]>([]);
  const [obdCodes, setObdCodes] = useState<any[]>([]);
  const [lineItems, setLineItems] = useState<any[]>([]);
  const [partsCatalog, setPartsCatalog] = useState<any[]>([]);
  const [partStock, setPartStock] = useState<Record<string, number>>({});
  const [reportedProblem, setReportedProblem] = useState("");
  const [discountAmt, setDiscountAmt] = useState("0");
  const [discountReason, setDiscountReason] = useState("");
  const [workPerformed, setWorkPerformed] = useState("");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [amountPaid, setAmountPaid] = useState("0");
  const [mechanicsList, setMechanicsList] = useState<Array<{ id: string; name: string; phone: string | null; specialties: string[] }>>([]);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardSpecialty, setForwardSpecialty] = useState<string>("all");
  const [forwardMechId, setForwardMechId] = useState("");
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [codeOpen, setCodeOpen] = useState(false);
  const [enteredCode, setEnteredCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [statusOverride, setStatusOverride] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);

  const load = async () => {
    const { data: j } = await supabase.from("jobs").select("*").eq("id", jobId).maybeSingle();
    setJob(j as any);
    if (j) {
      setReportedProblem((j as any).reported_problem ?? (j as any).complaint ?? "");
      setDiscountAmt(String((j as any).discount_amount ?? 0));
      setDiscountReason((j as any).discount_reason ?? "");
      setWorkPerformed((j as any).work_performed ?? "");
      setAmountPaid(String((j as any).receipt_amount ?? 0));
      setForwardMechId((j as any).assigned_mechanic_id ?? "");
    }
    if (j?.previous_job_id) {
      const { data: prev } = await supabase.from("jobs").select("*").eq("id", j.previous_job_id).maybeSingle();
      setPrevious(prev as any);
    }
    const [{ data: m }, { data: p }, { data: inv }, { data: li }, { data: cat }, { data: stock }] = await Promise.all([
      supabase.from("stock_movements").select("*, parts(name, sku)").eq("job_id", jobId),
      supabase.from("petty_cash_entries").select("*").eq("job_id", jobId),
      supabase.from("invoices").select("*").eq("job_id", jobId),
      supabase.from("job_line_items").select("*").eq("job_id", jobId).order("position", { ascending: true }),
      supabase.from("parts").select("id, name, sku, unit_price").order("name").limit(2000),
      supabase.from("part_stock").select("part_id, qty"),
    ]);
    const { data: mechs } = await supabase.from("mechanics").select("id, name, phone, specialties").eq("active", true).order("name");
    setMechanicsList((mechs ?? []) as any);
    setPartsUsed(m ?? []);
    setPettyForJob(p ?? []);
    setInvoicesForJob(inv ?? []);
    setLineItems(li ?? []);
    setPartsCatalog(cat ?? []);
    const stockMap: Record<string, number> = {};
    (stock ?? []).forEach((s: any) => {
      stockMap[s.part_id] = (stockMap[s.part_id] ?? 0) + Number(s.qty || 0);
    });
    setPartStock(stockMap);

    // pull inspection findings + OBD for the diagnosis tab
    const { data: ins } = await supabase
      .from("inspections").select("id").eq("job_ref", jobId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (ins?.id) {
      const [{ data: f }, { data: scans }] = await Promise.all([
        supabase.from("inspection_findings").select("*").eq("inspection_id", ins.id),
        supabase.from("obd_scans").select("id").eq("inspection_id", ins.id),
      ]);
      setFindings(f ?? []);
      const scanIds = (scans ?? []).map((s: any) => s.id);
      if (scanIds.length) {
        const { data: cd } = await supabase.from("obd_codes").select("*").in("scan_id", scanIds);
        setObdCodes(cd ?? []);
      } else setObdCodes([]);
    } else { setFindings([]); setObdCodes([]); }

    // ===== AUTO STATUS TRANSITIONS — minimum input, maximum output =====
    if (j && !["completed", "closed"].includes(j.status)) {
      const hasIssuedParts = (m ?? []).some((x: any) => x.type === "sale" || x.type === "issue" || x.type === "out");
      const { data: openReqs } = await supabase
        .from("part_requests")
        .select("id, status")
        .eq("job_id", jobId);
      const reqs = openReqs ?? [];
      const hasPartRequest = reqs.length > 0;
      // "parts have arrived" = at least one issued / approved request exists
      const hasArrivedParts = reqs.some((r: any) => r.status === "issued" || r.status === "approved");
      const partsFitApproved = !!(j as any).parts_fit_approved_at;
      const diagnosisApproved = !!(j as any).diagnosis_approved_at;
      const needsInternalApproval = !!(j as any).requires_internal_parts_approval;

      let next: JobStatus | null = null;
      // Final client approval already in
      if ((j as any).client_approved_at && j.status === "awaiting_approval") next = "completed";
      // Once internal staff approves fitting OR a part is actually issued from stock → repair
      else if ((hasIssuedParts || partsFitApproved) && !["repair","awaiting_approval"].includes(j.status)) next = "repair";
      // Parts arrived → if any major part flagged, internal approval required; otherwise straight to repair
      else if (hasArrivedParts && j.status === "parts") next = needsInternalApproval ? "parts_approval" : "repair";
      // Client approved diagnosis → start parts requesting
      else if (diagnosisApproved && j.status === "diagnosis_approval") next = "parts";
      // Mechanic raised a part request before formal diagnosis approval — still allow flow,
      // but only if diagnosis approval has been granted (so we don't bypass the gate).
      else if (hasPartRequest && diagnosisApproved && (j.status === "diagnosis" || j.status === "diagnosed")) next = "parts";

      if (next && next !== j.status) {
        await supabase.from("jobs").update({ status: next }).eq("id", jobId);
        setJob({ ...(j as any), status: next });
      }
    }
  };
  useEffect(() => { load(); }, [jobId]);

  if (!job) return <p className="text-center text-muted-foreground py-8">Loading…</p>;

  const partsCost = partsUsed.reduce((s, m) => s + (Number(m.buy_price ?? m.unit_price ?? 0) * Number(m.qty ?? 0)), 0);
  const partsRevenue = partsUsed.reduce((s, m) => s + (Number(m.sell_price ?? m.unit_price ?? 0) * Number(m.qty ?? 0)), 0);
  const pettyTotal = pettyForJob.reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const lineSubtotal = calculateLineSubtotal(lineItems);
  const discount = Number(discountAmt || 0);
  const lineTotal = calculateLineTotal(lineItems, discount);
  const profit = lineSubtotal - partsCost - pettyTotal;

  // ===== STRICT DOC GATING (real garage flow) =====
  // Quotation: available once we've moved past "diagnosis" (so a diagnosis is on file)
  // Invoice  : only after work is "completed"
  // Receipt  : only after the customer has paid (status "closed" OR amount_paid >= total)
  const canQuotation = job.status !== "diagnosis";
  const canInvoice = ["completed", "closed"].includes(job.status);
  const canReceipt = job.status === "closed" || Number(amountPaid || 0) >= lineTotal && lineTotal > 0;
  const currentStage: "quotation" | "invoice" | "receipt" =
    canReceipt ? "receipt" : canInvoice ? "invoice" : "quotation";

  const buildDocData = (kind: "quotation" | "invoice" | "receipt") => ({
    doc_no: job.job_no,
    job_no: job.job_no,
    date: new Date(job.started_at).toISOString().slice(0, 10),
    customer_name: job.customer_name ?? "",
    customer_phone: job.customer_phone ?? "",
    plate: job.plate,
    lines: lineItems.length > 0
      ? lineItems.map((l) => ({ description: `${l.kind === "labour" ? "Labour: " : ""}${l.description}`, qty: Number(l.qty || 0), unit_price: Number(l.unit_price || 0) }))
      : [{ description: `${job.service_type ?? "Service"} — ${job.reported_problem ?? job.complaint ?? "Workshop services"}`, qty: 1, unit_price: lineSubtotal || Number(job.estimate || 0) }],
    served_by: job.mechanic ?? undefined,
    discount: kind === "quotation" ? 0 : discount,
    amount_paid: kind === "receipt" ? Number(amountPaid || 0) : undefined,
    vat: false,
  });

  // ------- AI: regenerate diagnostic summary + recommended parts ---------
  const runAiSummary = async () => {
    setAiBusy(true);
    try {
        const diagnosticFindings = findings.filter((f: any) => f.status && f.status !== "ok" && !isServiceCategory(f.category));
        const { data, error, response } = await supabase.functions.invoke("diagnose-summary", {
          body: {
            vehicle: job.vehicle_label ?? "",
            plate: job.plate,
          reported_problem: job.reported_problem ?? job.complaint ?? "",
          findings: diagnosticFindings,
          obd_codes: obdCodes,
        },
      });
        if (error) {
          throw new Error(await readEdgeFunctionErrorMessage(error, response, "AI failed"));
        }
        const recParts = (data?.parts ?? []).map((p: any) => ({ ...p, requested: false }));
      await supabase.from("jobs").update({
        ai_diagnostic_summary: data?.summary ?? "",
        recommended_parts: recParts as any,
      }).eq("id", jobId);
      // Pre-fill the financial editor: faulty findings + AI parts as line items
      // (only if no manual lines yet, to avoid clobbering the mechanic's edits)
      const { data: existingLines } = await supabase.from("job_line_items").select("id, source").eq("job_id", jobId);
      const onlyAuto = (existingLines ?? []).every((l: any) => l.source !== "manual");
      if (onlyAuto) {
        // wipe previous auto rows, re-seed
        await supabase.from("job_line_items").delete().eq("job_id", jobId).in("source", ["ai", "inspection"]);
        const seed: any[] = [];
        let pos = 0;
        for (const f of diagnosticFindings) {
          seed.push({
            job_id: jobId, kind: "part", source: "inspection", position: pos++,
            description: `${f.part}${f.subpart ? " · " + f.subpart : ""} — ${f.note || f.status}`,
            qty: 1, unit_price: 0,
          });
        }
        for (const p of recParts) {
          seed.push({
            job_id: jobId, kind: "part", source: "ai", position: pos++,
            description: p.name + (p.reason ? ` (${p.reason})` : ""),
            qty: p.qty || 1, unit_price: 0,
          });
        }
        seed.push({ job_id: jobId, kind: "labour", source: "ai", position: pos++, description: "Labour", qty: 1, unit_price: 0 });
        if (seed.length > 0) await supabase.from("job_line_items").insert(seed);
      }
      toast.success("AI diagnostic ready — financial summary pre-filled");
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "AI failed");
    } finally {
      setAiBusy(false);
    }
  };

  // Request a recommended part with one click
  const requestRecommendedPart = async (idx: number) => {
    const list = [...(job.recommended_parts ?? [])];
    const item = list[idx];
    if (!item || item.requested) return;
    const { error } = await supabase.from("part_requests").insert({
      job_id: jobId, kind: "part", item_name: item.name, qty: item.qty || 1,
      notes: item.reason ? `AI suggested · ${item.reason}` : "AI suggested", status: "pending",
    } as any);
    if (error) { toast.error(error.message); return; }
    list[idx] = { ...item, requested: true };
    await supabase.from("jobs").update({ recommended_parts: list as any }).eq("id", jobId);
    toast.success(`Requested: ${item.name}`);
    load();
  };

  const removeRecommendedPart = async (idx: number) => {
    const list = [...(job.recommended_parts ?? [])];
    list.splice(idx, 1);
    await supabase.from("jobs").update({ recommended_parts: list as any }).eq("id", jobId);
    load();
  };

  // ===== Line-item editor =====
  const addLine = async (kind: "part" | "labour") => {
    const pos = lineItems.length;
    const { data, error } = await supabase.from("job_line_items").insert({
      job_id: jobId, kind, source: "manual", position: pos,
      description: kind === "labour" ? "Labour" : "",
      qty: 1, unit_price: 0,
    }).select().single();
    if (error) {
      toast.error(error.message);
    } else if (data) {
      const next = [...lineItems, data];
      setLineItems(next);
      await persistFinancialSnapshot({ rows: next, silent: true });
    }
  };
  const updateLine = async (id: string, patch: any) => {
    const next = lineItems.map((l) => l.id === id ? { ...l, ...patch } : l);
    setLineItems(next);
    const { error } = await supabase.from("job_line_items").update(patch).eq("id", id);
    if (error) {
      toast.error(error.message);
    } else {
      await persistFinancialSnapshot({ rows: next, silent: true });
    }
  };
  const removeLine = async (id: string) => {
    const next = lineItems.filter((l) => l.id !== id);
    const { error } = await supabase.from("job_line_items").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
    } else {
      setLineItems(next);
      await persistFinancialSnapshot({ rows: next, silent: true });
    }
  };
  const pickPartForLine = async (id: string, partId: string) => {
    const part = partsCatalog.find((p) => p.id === partId);
    if (!part) return;
    const inStock = (partStock[partId] ?? 0) > 0;
    await updateLine(id, {
      part_id: partId,
      description: part.name,
      unit_price: inStock ? Number(part.unit_price || 0) : 0,
    });
    if (!inStock) toast.message(`${part.name} is out of stock — set price manually`);
  };

  const syncLinkedInvoice = async (jobSnapshot: Job, rows: any[], subtotal: number, total: number, amountPaidValue: number) => {
    const invoiceStatus = amountPaidValue >= total && total > 0
      ? "paid"
      : subtotal > 0 || total > 0
        ? "issued"
        : "draft";
    const docDateSource = jobSnapshot.paid_at || jobSnapshot.completed_at || jobSnapshot.started_at || new Date().toISOString();
    const payload: any = {
      invoice_no: jobSnapshot.job_no,
      plate: jobSnapshot.plate,
      vehicle_id: (jobSnapshot as any).vehicle_id ?? null,
      client_id: (jobSnapshot as any).client_id ?? null,
      service_type: jobSnapshot.service_type ?? "service",
      parts_source: "job_card",
      time_in: jobSnapshot.started_at,
      time_out: jobSnapshot.completed_at ?? jobSnapshot.paid_at ?? null,
      date: String(docDateSource).slice(0, 10),
      amount: subtotal,
      discount,
      discount_by: discountReason || null,
      amount_paid: amountPaidValue,
      technicians: jobSnapshot.mechanic ?? null,
      customer_phone: jobSnapshot.customer_phone ?? null,
      status: invoiceStatus,
      notes: workPerformed || reportedProblem || jobSnapshot.complaint || null,
      job_id: jobSnapshot.id,
      doc_type: "invoice",
    };

    const { data: existingRows, error: existingError } = await supabase
      .from("invoices")
      .select("id")
      .eq("job_id", jobSnapshot.id)
      .eq("doc_type", "invoice")
      .order("created_at", { ascending: true })
      .limit(1);
    if (existingError) throw existingError;

    let invoiceId = existingRows?.[0]?.id ?? null;
    if (invoiceId) {
      const { error } = await supabase.from("invoices").update(payload).eq("id", invoiceId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from("invoices").insert(payload).select("id").single();
      if (error) throw error;
      invoiceId = data?.id ?? null;
    }
    if (!invoiceId) return;

    const { error: clearError } = await supabase.from("invoice_items").delete().eq("invoice_id", invoiceId);
    if (clearError) throw clearError;

    const itemRows = rows.length > 0
      ? rows
      : [{
          kind: "labour",
          description: `${jobSnapshot.service_type ?? "Service"} - ${reportedProblem || (jobSnapshot.complaint ?? "Workshop services")}`,
          qty: 1,
          unit_price: subtotal || Number(jobSnapshot.estimate || 0),
        }];

    const { error: itemError } = await supabase.from("invoice_items").insert(
      itemRows.map((row: any) => ({
        invoice_id: invoiceId,
        kind: row.kind ?? "part",
        description: row.description,
        qty: Number(row.qty || 0),
        unit_price: Number(row.unit_price || 0),
      })),
    );
    if (itemError) throw itemError;
  };

  const persistFinancialSnapshot = async ({
    rows = lineItems,
    amountPaidValue = Number(amountPaid || 0),
    extraJobPatch = {},
    silent = true,
  }: {
    rows?: any[];
    amountPaidValue?: number;
    extraJobPatch?: Record<string, any>;
    silent?: boolean;
  } = {}) => {
    if (!job) return null;
    const subtotal = calculateLineSubtotal(rows);
    const total = calculateLineTotal(rows, discount);
    const patch: any = {
      discount_amount: discount,
      discount_reason: discountReason || null,
      work_performed: workPerformed || null,
      quotation_amount: subtotal,
      invoice_amount: total,
      receipt_amount: Math.max(0, Number(amountPaidValue || 0)),
      ...extraJobPatch,
    };

    const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
    if (error) {
      toast.error(error.message);
      return null;
    }

    const snapshot = { ...job, ...patch } as Job;
    setJob(snapshot);
    try {
      await syncLinkedInvoice(snapshot, rows, subtotal, total, Math.max(0, Number(amountPaidValue || 0)));
    } catch (e: any) {
      toast.error(e?.message ?? "Saved the job, but invoice sync failed");
    }

    if (!silent) toast.success("Saved");
    return snapshot;
  };

  const saveFinancialMeta = async () => {
    const saved = await persistFinancialSnapshot({ silent: false });
    if (saved) load();
  };

  const markPaid = async () => {
    if (!canInvoice) { toast.error("Mark the job complete before recording payment"); return; }
    if (Number(amountPaid || 0) < lineTotal) { toast.error("Amount paid is less than total"); return; }
    const now = new Date().toISOString();
    const snapshot = await persistFinancialSnapshot({
      amountPaidValue: Number(amountPaid || 0),
      extraJobPatch: {
        status: "closed",
        paid_at: now,
        closed_at: now,
        gate_pass_issued: true,
      },
      silent: true,
    });
    if (!snapshot) return;
    try {
      const gatePass = await ensureGatePass(jobId);
      // Trigger PDFs in parallel — receipt and gate pass
      await Promise.all([
        generateReceiptPDF({ ...buildDocData("receipt"), payment_mode: paymentMode.toUpperCase() }),
        downloadGatePass(snapshot, gatePass.pass_no, Number(amountPaid || 0)),
      ]);
      toast.success("Paid — receipt & gate pass downloaded");
    } catch (e: any) {
      toast.error(e?.message ?? "Receipt issued, but PDF download failed");
    }
    load();
  };

  // ===== Approval flow: send the client a feedback link =====
  const sendForApproval = async () => {
    if (!workPerformed.trim()) {
      toast.error("Describe what you did under 'Work performed' first");
      return;
    }
    const saved = await persistFinancialSnapshot({
      extraJobPatch: { status: "awaiting_approval" },
      silent: true,
    });
    if (!saved) return;
    await copyApprovalLink();
    toast.success("Status set to 'Awaiting client approval' — link copied");
    load();
  };

  // ===== Diagnosis-stage approval: send the client a link to approve diagnosis + estimate =====
  const approvalUrl = job?.client_feedback_token
    ? `${window.location.origin}/approve/${job.client_feedback_token}`
    : "";

  // Ensure the job has an approval token; mint one if missing so QR / link / email all work.
  const ensureApprovalToken = async (): Promise<string | null> => {
    if (job?.client_feedback_token) return job.client_feedback_token;
    const newToken = (crypto as any)?.randomUUID
      ? (crypto as any).randomUUID().replace(/-/g, "")
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    const { error } = await supabase.from("jobs")
      .update({ client_feedback_token: newToken })
      .eq("id", jobId);
    if (error) { toast.error(error.message); return null; }
    setJob((prev: any) => prev ? { ...prev, client_feedback_token: newToken } : prev);
    return newToken;
  };

  const ensureDiagnosisStage = async () => {
    if (!job?.ai_diagnostic_summary && !(job?.recommended_parts ?? []).length) {
      toast.message("Generating diagnosis summary first…");
      try {
        await runAiSummary();
      } catch (e: any) {
        toast.error(e?.message ?? "Failed to generate diagnosis summary");
        return false;
      }
      // Re-fetch to confirm summary landed
      const { data: fresh } = await supabase
        .from("jobs")
        .select("ai_diagnostic_summary, recommended_parts")
        .eq("id", jobId)
        .maybeSingle();
      if (!fresh?.ai_diagnostic_summary && !((fresh as any)?.recommended_parts ?? []).length) {
        toast.error("Could not generate a diagnosis summary — add findings or notes and try again");
        return false;
      }
    }
    if (job?.status !== "diagnosis_approval") {
      const { error } = await supabase.from("jobs").update({
        status: "diagnosis_approval",
        diagnosis_sent_at: new Date().toISOString(),
      }).eq("id", jobId);
      if (error) { toast.error(error.message); return false; }
    }
    return true;
  };

  const sendDiagnosisEmail = async () => {
    if (!(await ensureDiagnosisStage())) return;
    const token = await ensureApprovalToken();
    if (!token) return;
    const url = `${window.location.origin}/approve/${token}`;
    const subject = encodeURIComponent(`Golden Automotive — Diagnosis & Quotation for ${job?.plate}`);
    const body = encodeURIComponent(
`Hello ${job?.customer_name ?? ""},

Your vehicle ${job?.plate} (${job?.vehicle_label ?? ""}) — job ${job?.job_no} — has been diagnosed.

Please review and approve here (view-only, no download):
${url}

Thank you,
Golden Automotive Solutions`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    toast.success("Email draft opened — link cannot be downloaded by anyone else");
    load();
  };

  const sendDiagnosisWhatsApp = async () => {
    if (!(await ensureDiagnosisStage())) return;
    const token = await ensureApprovalToken();
    if (!token) return;
    const url2 = `${window.location.origin}/approve/${token}`;
    const phone = (job?.customer_phone ?? "").replace(/[^\d]/g, "");
    const text = encodeURIComponent(
`Hello ${job?.customer_name ?? ""}, your vehicle ${job?.plate} (job ${job?.job_no}) has been diagnosed. Please review and approve here (view-only):\n${url2}\n— Golden Automotive Solutions`);
    const url = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(url, "_blank", "noopener,noreferrer");
    load();
  };

  const showApprovalQR = async () => {
    if (!(await ensureDiagnosisStage())) return;
    const token = await ensureApprovalToken();
    if (!token) { toast.error("Could not create approval link"); return; }
    const url = `${window.location.origin}/approve/${token}`;
    const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1, color: { dark: "#1a1207", light: "#ffffff" } });
    setQrDataUrl(dataUrl);
    setQrOpen(true);
    load();
  };

  const verifyClientCode = async () => {
    if (!enteredCode.trim()) { toast.error("Enter the 6-digit code from the client"); return; }
    setVerifying(true);
    const { data, error } = await supabase.rpc("verify_diagnosis_code", { _job_id: jobId, _code: enteredCode.trim() });
    setVerifying(false);
    if (error) { toast.error(error.message); return; }
    if (!data) { toast.error("Code did not match"); return; }
    toast.success("Approval verified — job moved to parts");
    setCodeOpen(false);
    setEnteredCode("");
    load();
  };

  // ===== Internal approval: mechanic / manager / director confirms parts can be fitted =====
  const approvePartsForFitting = async () => {
    const { data, error } = await supabase.rpc("approve_parts_for_fitting", { _job_id: jobId });
    if (error || !data) { toast.error(error?.message ?? "Could not approve"); return; }
    toast.success("Parts approved — job moved to repair");
    load();
  };

  const copyApprovalLink = async () => {
    const token = await ensureApprovalToken();
    if (!token) return;
    const url = `${window.location.origin}/approve/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Approval link copied to clipboard");
    } catch {
      // fallback
      window.prompt("Copy this approval link to share with the client:", url);
    }
  };

  const forwardToMechanic = async () => {
    if (!forwardMechId) { toast.error("Pick a mechanic"); return; }
    const m = mechanicsList.find(x => x.id === forwardMechId);
    const newStatus: JobStatus = job.status === "diagnosed" || job.status === "parts" ? "repair" : job.status;
    const { error } = await supabase.from("jobs").update({
      assigned_mechanic_id: forwardMechId,
      mechanic: m?.name ?? null,
      status: newStatus,
    }).eq("id", jobId);
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase.from("job_mechanics").update({ role_on_job: "assist" }).eq("job_id", jobId).neq("mechanic_id", forwardMechId);
    await supabase.from("job_mechanics").upsert(
      { job_id: jobId, mechanic_id: forwardMechId, role_on_job: "lead" },
      { onConflict: "job_id,mechanic_id" },
    );
    toast.success(`Forwarded to ${m?.name ?? "mechanic"}`);
    setForwardOpen(false);
    load();
  };

  const diagnosticFindings = findings.filter((f) => f.status && f.status !== "ok" && !isServiceCategory(f.category));
  const serviceFindings = findings.filter(
    (f) => isServiceCategory(f.category) && (f.status !== "ok" || f.last_service || f.next_due || f.note),
  );
  const issueCount = diagnosticFindings.length;

  const allowedNext = NEXT_STATUSES[job.status] ?? [];
  const statusOptions: JobStatus[] = statusOverride && canManageJob
    ? ALL_STATUSES.filter((s) => s !== job.status)
    : allowedNext;

  const changeStatus = async (next: JobStatus) => {
    setSavingStatus(true);
    const patch: any = { status: next };
    if (next === "completed") patch.completed_at = new Date().toISOString();
    if (next === "closed")    patch.closed_at = new Date().toISOString();
    const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
    setSavingStatus(false);
    if (error) toast.error(error.message);
    else { toast.success(`Moved to ${STATUS_LABEL[next]}`); setStatusOverride(false); load(); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-2" />Back to jobs</Button>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => setInspectOpen(true)}>
            <Stethoscope className="h-4 w-4 mr-2" />Do inspection
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRequestOpen(true)}>
            <Package className="h-4 w-4 mr-2" />Request part
          </Button>
          {(canManageJob || job.status === "diagnosed" || job.status === "parts" || job.status === "repair") && (
            <Button size="sm" variant="outline" onClick={() => setForwardOpen(true)}>
              <Send className="h-4 w-4 mr-2" />Forward to mechanic
            </Button>
          )}
          {(job.status === "diagnosed" || job.status === "diagnosis_approval") && (
            <>
              <Button size="sm" variant="outline" onClick={sendDiagnosisEmail}>
                <Mail className="h-4 w-4 mr-2" />Email diagnosis
              </Button>
              <Button size="sm" variant="outline" onClick={sendDiagnosisWhatsApp}>
                <MessageCircle className="h-4 w-4 mr-2" />WhatsApp
              </Button>
              <Button size="sm" variant="outline" onClick={showApprovalQR}>
                <QrCode className="h-4 w-4 mr-2" />Generate QR
              </Button>
              <Button size="sm" variant="outline" onClick={() => setCodeOpen(true)}>
                <KeyRound className="h-4 w-4 mr-2" />Enter approval code
              </Button>
            </>
          )}
          {job.status === "parts_approval" && canApproveFitting && (
            <Button size="sm" className="bg-gradient-primary" onClick={approvePartsForFitting}>
              <ShieldCheck className="h-4 w-4 mr-2" />Approve parts &amp; start fitting
            </Button>
          )}
          {job.status === "repair" && (
            <Button size="sm" variant="outline" onClick={sendForApproval}>
              <Link2 className="h-4 w-4 mr-2" />Send to client for final approval
            </Button>
          )}
          {job.status === "awaiting_approval" && (
            <Button size="sm" variant="outline" onClick={copyApprovalLink}>
              <Copy className="h-4 w-4 mr-2" />Copy approval link
            </Button>
          )}
        </div>
      </div>

      {previous && (
        <Card className="p-4 border-amber-500/40 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <History className="h-5 w-5 text-amber-600 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-sm">Re-admission</p>
              <p className="text-xs text-muted-foreground">
                Linked to previous job <span className="font-mono font-bold text-primary">{previous.job_no}</span> — {previous.complaint ?? "no complaint recorded"} ·{" "}
                {previous.completed_at ? `completed ${new Date(previous.completed_at).toLocaleDateString()}` : "open"}
              </p>
              {previous.paint_color_code && <p className="text-xs">Paint code on file: <strong>{previous.paint_color_code}</strong></p>}
            </div>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-base font-mono font-bold text-primary">{job.job_no}</span>
              {canManageJob ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <Select
                    value={job.status}
                    onValueChange={(v) => changeStatus(v as JobStatus)}
                    disabled={savingStatus || statusOptions.length === 0}
                  >
                    <SelectTrigger className="h-7 w-[220px] text-xs">
                      <SelectValue>{STATUS_LABEL[job.status]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={job.status} disabled>
                        {STATUS_LABEL[job.status]} (current)
                      </SelectItem>
                      {statusOptions.map((s) => (
                        <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={statusOverride}
                      onChange={(e) => setStatusOverride(e.target.checked)}
                      className="h-3 w-3 accent-primary"
                    />
                    Override
                  </label>
                </div>
              ) : (
                <Badge variant="outline" className="capitalize">{STATUS_LABEL[job.status]}</Badge>
              )}
              <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />{elapsed(job.started_at)}</Badge>
              {job.paint_color_code && <Badge variant="secondary"><Palette className="h-3 w-3 mr-1" />{job.paint_color_code}</Badge>}
              {issueCount > 0 && (
                <Badge className="bg-destructive text-destructive-foreground">
                  <AlertTriangle className="h-3 w-3 mr-1" />{issueCount} issue{issueCount > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            <h2 className="text-2xl font-bold mt-1">{job.plate}</h2>
            <p className="text-sm text-muted-foreground">{job.vehicle_label ?? "—"} · {job.customer_name ?? "—"}{canSeeFinances ? ` · ${job.customer_phone ?? "—"}` : ""}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground capitalize">{currentStage}</p>
            {canSeeFinances ? (
              <>
                <p className="text-2xl font-bold">KSh {lineTotal.toLocaleString()}</p>
                {discount > 0 && <p className="text-[11px] text-success">Discount: KSh {discount.toLocaleString()}</p>}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Pricing hidden</p>
            )}
            {job.has_insurance && (
              <Badge className="mt-1 bg-status-diagnosed text-primary-foreground text-[10px]">
                <ShieldAlert className="h-3 w-3 mr-1" />Insurance{job.insurance_company ? ` · ${job.insurance_company}` : ""}
              </Badge>
            )}
          </div>
        </div>

        <div className="mt-4 pt-4 border-t">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {(["diagnosis","diagnosed","diagnosis_approval","parts","parts_approval","repair","awaiting_approval","completed"] as JobStatus[]).map((s, i, arr) => {
              const order = arr.indexOf(job.status);
              const reached = i <= order;
              return (
                <div key={s} className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded-md capitalize ${reached ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{s}</span>
                  {i < arr.length - 1 && <span className={reached && i < order ? "text-primary" : "text-muted-foreground/40"}>→</span>}
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Stages advance automatically as you request parts, issue stock, and finish inspections.
          </p>
        </div>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="diagnosis">
            Diagnosis{issueCount > 0 && <Badge variant="secondary" className="ml-2 h-4 text-[10px]">{issueCount}</Badge>}
          </TabsTrigger>
          {canSeeFinances && <TabsTrigger value="financial">Financial summary</TabsTrigger>}
          {canSeeFinances && <TabsTrigger value="documents">Documents</TabsTrigger>}
        </TabsList>

        {/* ====================== OVERVIEW ====================== */}
        <TabsContent value="overview" className="mt-4 grid gap-5 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2 space-y-4">
            <div>
              <h3 className="font-semibold flex items-center gap-2 mb-2"><FileText className="h-4 w-4 text-primary" />Reported problem</h3>
              {canManageJob ? (
                <Textarea
                  rows={3}
                  value={reportedProblem}
                  onChange={(e) => setReportedProblem(e.target.value)}
                  onBlur={async (e) => {
                    const val = e.target.value;
                    if (val === (job.reported_problem ?? job.complaint ?? "")) return;
                    const { error } = await supabase
                      .from("jobs")
                      .update({ reported_problem: val, complaint: val })
                      .eq("id", jobId);
                    if (error) toast.error(error.message);
                    else { toast.success("Saved"); load(); }
                  }}
                  className="text-sm"
                />
              ) : (
                <p className="text-sm bg-muted/40 rounded-md p-3">{job.reported_problem ?? job.complaint ?? "—"}</p>
              )}
            </div>
            {job.has_insurance && (
              <div className="rounded-md border border-status-diagnosed/40 bg-status-diagnosed/5 p-3 text-sm">
                <p className="font-semibold flex items-center gap-2"><ShieldAlert className="h-4 w-4" />Insurance claim</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {job.insurance_company ?? "Company not specified"}
                  {job.insurance_policy_no ? ` · Policy ${job.insurance_policy_no}` : ""}
                </p>
              </div>
            )}
            {workPerformed && (
              <div className="border-t pt-4">
                <h3 className="font-semibold flex items-center gap-2 mb-2"><Wrench className="h-4 w-4 text-primary" />What we ended up doing</h3>
                <p className="text-sm bg-muted/40 rounded-md p-3 whitespace-pre-wrap">{workPerformed}</p>
              </div>
            )}
            {(job.client_approved_at || job.feedback_rating) && (
              <div className="border-t pt-4">
                <h3 className="font-semibold flex items-center gap-2 mb-2"><Star className="h-4 w-4 text-yellow-500" />Client feedback</h3>
                <div className="rounded-md bg-success/5 border border-success/30 p-3 text-sm space-y-1">
                  {job.feedback_rating && (
                    <div className="flex gap-0.5">
                      {[1,2,3,4,5].map(n => (
                        <Star key={n} className={`h-4 w-4 ${n <= (job.feedback_rating ?? 0) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
                      ))}
                    </div>
                  )}
                  {job.customer_feedback && <p className="whitespace-pre-wrap">{job.customer_feedback}</p>}
                  {job.client_approved_at && (
                    <p className="text-[11px] text-muted-foreground">
                      Approved {new Date(job.client_approved_at).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
            )}
            {canSeeFinances && (
              <div className="border-t pt-4">
                <h3 className="font-semibold flex items-center gap-2 mb-3"><DollarSign className="h-4 w-4 text-primary" />Profit (live)</h3>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-md bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Parts cost</p><p className="font-bold">KSh {partsCost.toLocaleString()}</p></div>
                  <div className="rounded-md bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Total billed</p><p className="font-bold">KSh {lineTotal.toLocaleString()}</p></div>
                  <div className="rounded-md bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Petty cash</p><p className="font-bold">KSh {pettyTotal.toLocaleString()}</p></div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">Est. profit ≈ <strong className={profit >= 0 ? "text-success" : "text-destructive"}>KSh {profit.toLocaleString()}</strong></p>
              </div>
            )}
          </Card>
          <div className="space-y-5">
            <Card className="p-5">
              <h3 className="font-semibold flex items-center gap-2 mb-3"><Package className="h-4 w-4 text-primary" />Parts issued ({partsUsed.length})</h3>
              {partsUsed.length === 0 ? (
                <p className="text-sm text-muted-foreground">No parts issued yet.</p>
              ) : (
                <div className="space-y-2 text-sm">
                  {partsUsed.map((m, i) => (
                    <div key={i} className="flex justify-between bg-muted/40 rounded p-2">
                      <span>{m.parts?.name ?? "—"} ×{m.qty}</span>
                      <span className="font-mono text-xs">{m.type}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card className="p-5">
              <h3 className="font-semibold flex items-center gap-2 mb-3"><Wrench className="h-4 w-4 text-primary" />Mechanic</h3>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-gradient-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
                  {(job.mechanic ?? "??").split(" ").map(n => n[0]).join("").slice(0, 2)}
                </div>
                <div>
                  <p className="text-sm font-semibold">{job.mechanic ?? "Unassigned"}</p>
                  <p className="text-xs text-muted-foreground">{new Date(job.started_at).toLocaleDateString()}</p>
                </div>
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* ====================== DIAGNOSIS ====================== */}
        <TabsContent value="diagnosis" className="mt-4 space-y-5">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4 text-accent" />AI diagnostic summary</h3>
              <Button size="sm" variant="outline" onClick={runAiSummary} disabled={aiBusy}>
                {aiBusy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                {job.ai_diagnostic_summary ? "Regenerate" : "Generate"}
              </Button>
            </div>
            {job.ai_diagnostic_summary ? (
              <div className="text-sm bg-muted/40 rounded-md p-3 whitespace-pre-wrap">{job.ai_diagnostic_summary}</div>
            ) : (
              <p className="text-xs text-muted-foreground">Run an inspection then click <strong>Generate</strong>.</p>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="font-semibold flex items-center gap-2 mb-3"><AlertTriangle className="h-4 w-4 text-destructive" />Faulty items found ({issueCount})</h3>
            {issueCount === 0 ? (
              <p className="text-sm text-muted-foreground">No faults recorded yet. Run an inspection.</p>
            ) : (
              <div className="space-y-2">
                {diagnosticFindings.map((f) => (
                  <div key={f.id} className="flex items-start justify-between gap-3 rounded-md border p-2 bg-muted/30">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {getInspectionSystemLabel(f.system)} {f.subpart ? `-> ${f.subpart}` : `-> ${f.part}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[
                          f.note || f.status?.toUpperCase?.() || f.status,
                          f.action_required ? `Action: ${f.action_required}` : null,
                          f.assigned_technician ? `Tech: ${f.assigned_technician}` : null,
                          f.estimated_cost != null ? `Est. cost: ${f.estimated_cost}` : null,
                          f.time_estimate_minutes != null ? `${f.time_estimate_minutes} min` : null,
                          f.client_authorized ? "Client approved" : null,
                        ].filter(Boolean).join(" | ")}
                      </p>
                    </div>
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${
                      f.severity === "high" ? "border-destructive text-destructive"
                      : f.severity === "medium" ? "border-yellow-500 text-yellow-700"
                      : ""}`}>{f.severity ?? "medium"}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {serviceFindings.length > 0 && (
            <Card className="p-5">
              <h3 className="font-semibold flex items-center gap-2 mb-3"><ClipboardList className="h-4 w-4 text-primary" />Regular service ({serviceFindings.length})</h3>
              <div className="space-y-2">
                {serviceFindings.map((f) => (
                  <div key={f.id} className="rounded-md border p-2 bg-muted/30">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {getInspectionSystemLabel(f.system)} {f.subpart ? `-> ${f.subpart}` : `-> ${f.part}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[
                            `Status: ${String(f.status ?? "ok").toUpperCase()}`,
                            f.last_service ? `Last service: ${f.last_service}` : null,
                            f.next_due ? `Next due: ${f.next_due}` : null,
                            f.note ? `Remarks: ${f.note}` : null,
                          ].filter(Boolean).join(" | ")}
                        </p>
                      </div>
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${
                        f.status === "faulty" ? "border-destructive text-destructive"
                        : f.status === "attention" ? "border-yellow-500 text-yellow-700"
                        : ""
                      }`}>{String(f.status ?? "ok").toUpperCase()}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {obdCodes.length > 0 && (
            <Card className="p-5">
              <h3 className="font-semibold mb-3">OBD-II codes ({obdCodes.length})</h3>
              <div className="space-y-2">
                {obdCodes.map((c) => (
                  <div key={c.id} className="flex items-start justify-between gap-3 rounded-md border p-2 bg-muted/30">
                    <div>
                      <p className="text-sm font-mono font-bold">{c.code}</p>
                      <p className="text-xs text-muted-foreground">{c.meaning}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">{c.severity}</Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {(job.recommended_parts ?? []).length > 0 && (
            <Card className="p-5">
              <h3 className="font-semibold flex items-center gap-2 mb-3"><Package className="h-4 w-4 text-primary" />AI-recommended parts</h3>
              <div className="space-y-2">
                {(job.recommended_parts ?? []).map((p, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 rounded-md border p-2 bg-muted/30">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate flex items-center gap-2">
                        {p.name} <span className="text-xs text-muted-foreground">×{p.qty}</span>
                      </div>
                      {p.reason && <div className="text-xs text-muted-foreground truncate">{p.reason}</div>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {p.requested ? (
                        <Badge className="bg-success text-success-foreground"><CheckCircle2 className="h-3 w-3 mr-1" />Requested</Badge>
                      ) : (
                        <Button size="sm" className="bg-gradient-primary h-8" onClick={() => requestRecommendedPart(i)}>
                          <Send className="h-3 w-3 mr-1" />Request
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => removeRecommendedPart(i)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </TabsContent>

        {/* ====================== FINANCIAL ====================== */}
        <TabsContent value="financial" className="mt-4 space-y-5">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold flex items-center gap-2"><DollarSign className="h-4 w-4 text-primary" />Line items</h3>
                <p className="text-[11px] text-muted-foreground">Pre-filled from diagnosis. Add, edit or remove rows freely.</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => addLine("part")}><Plus className="h-3 w-3 mr-1" />Part</Button>
                <Button size="sm" variant="outline" onClick={() => addLine("labour")}><Plus className="h-3 w-3 mr-1" />Labour</Button>
              </div>
            </div>

            {lineItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No items yet. Run AI diagnostic to pre-fill, or add rows manually.</p>
            ) : (
              <div className="space-y-2">
                {lineItems.map((l) => (
                  <LineItemRow
                    key={l.id}
                    line={l}
                    parts={partsCatalog}
                    stock={partStock}
                    onUpdate={(patch) => updateLine(l.id, patch)}
                    onRemove={() => removeLine(l.id)}
                    onPickPart={(pid) => pickPartForLine(l.id, pid)}
                  />
                ))}
              </div>
            )}

            <div className="mt-4 pt-4 border-t grid gap-3 md:grid-cols-3">
              <div>
                <Label className="text-xs">Discount (KSh)</Label>
                <Input type="number" value={discountAmt} onChange={(e) => setDiscountAmt(e.target.value)} onBlur={saveFinancialMeta} />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Discount reason</Label>
                <Input value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} onBlur={saveFinancialMeta} placeholder="loyal customer, cash payment…" />
              </div>
              <div className="md:col-span-3">
                <Label className="text-xs">Work performed (final notes)</Label>
                <Textarea rows={2} value={workPerformed} onChange={(e) => setWorkPerformed(e.target.value)} onBlur={saveFinancialMeta} placeholder="e.g. Replaced front brake pads & rotors. Also fixed leaking power steering hose." />
              </div>
            </div>

            <div className="mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div className="rounded-md bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Subtotal</p><p className="font-bold">KSh {lineSubtotal.toLocaleString()}</p></div>
              <div className="rounded-md bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Discount</p><p className="font-bold text-success">- KSh {discount.toLocaleString()}</p></div>
              <div className="rounded-md bg-primary/10 p-3"><p className="text-xs text-muted-foreground">Total</p><p className="font-bold text-primary">KSh {lineTotal.toLocaleString()}</p></div>
            </div>
          </Card>

          {canInvoice && (
            <Card className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2"><Receipt className="h-4 w-4 text-primary" />Record payment</h3>
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <Label className="text-xs">Mode</Label>
                  <Select value={paymentMode} onValueChange={setPaymentMode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="mpesa">M-Pesa</SelectItem>
                      <SelectItem value="bank">Bank transfer</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Amount paid (KSh)</Label>
                  <Input type="number" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} />
                </div>
                <div className="flex items-end">
                  <Button className="w-full bg-gradient-primary" onClick={markPaid} disabled={Number(amountPaid || 0) < lineTotal}>
                    <CheckCircle2 className="h-4 w-4 mr-2" />Mark paid &amp; close
                  </Button>
                </div>
              </div>
              {Number(amountPaid || 0) < lineTotal && (
                <p className="text-xs text-muted-foreground mt-2">Receipt unlocks once amount paid covers the total.</p>
              )}
            </Card>
          )}
        </TabsContent>

        {/* ====================== DOCUMENTS ====================== */}
        <TabsContent value="documents" className="mt-4">
          <Card className="p-5">
            <h3 className="font-semibold mb-1">Stage-gated documents</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Quotation → Work done → Invoice → Payment → Receipt. Each unlocks only when its stage is reached.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <DocCard
                title="Quotation"
                icon={<FileSignature className="h-4 w-4" />}
                enabled={canQuotation}
                lockedReason="Available after diagnosis is logged."
                active={currentStage === "quotation"}
                onDownload={() => generateQuotationPDF(buildDocData("quotation"))}
              />
              <DocCard
                title="Invoice"
                icon={<FileText className="h-4 w-4" />}
                enabled={canInvoice}
                lockedReason="Unlocks when the job is marked complete (after customer approval)."
                active={currentStage === "invoice"}
                onDownload={() => generateInvoicePDF(buildDocData("invoice"))}
              />
              <DocCard
                title="Receipt"
                icon={<Receipt className="h-4 w-4" />}
                enabled={canReceipt}
                lockedReason="Unlocks once the customer has paid in full."
                active={currentStage === "receipt"}
                onDownload={() => generateReceiptPDF({ ...buildDocData("receipt"), payment_mode: paymentMode.toUpperCase() })}
              />
              <DocCard
                title="Job card"
                icon={<ClipboardList className="h-4 w-4" />}
                enabled={true}
                active={false}
                onDownload={() => generateJobCardPDF({
                  job_no: job.job_no, plate: job.plate, vehicle: job.vehicle_label ?? "",
                  customer_name: job.customer_name ?? "", customer_phone: job.customer_phone ?? "",
                  customer_complaint: reportedProblem || (job.complaint ?? ""),
                  technician_diagnosis: [job.ai_diagnostic_summary?.trim(), workPerformed.trim() ? `Work performed: ${workPerformed.trim()}` : ""].filter(Boolean).join("\n\n"),
                  technicians: job.mechanic ?? "",
                  paint_color_code: job.paint_color_code ?? undefined,
                })}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              {invoicesForJob.length} saved document{invoicesForJob.length === 1 ? "" : "s"} on file. Manage all printed/saved invoices from the <strong>Invoices</strong> page.
            </p>
          </Card>
        </TabsContent>
      </Tabs>

      <RequestPartDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        jobId={jobId}
        jobLabel={`${job.job_no} · ${job.plate}`}
        onCreated={load}
      />
      {inspectOpen && (
        <div className="fixed inset-0 z-50 bg-background overflow-auto">
          <InspectionWizard
            jobId={jobId}
            plate={job.plate}
            vehicle={job.vehicle_label ?? job.plate}
            onClose={() => setInspectOpen(false)}
            onFinished={() => { setInspectOpen(false); load(); runAiSummary(); }}
            onAutoDiagnosed={() => {
              if (job.status === "diagnosis") onMoveStatus("diagnosed");
            }}
          />
        </div>
      )}

      <Dialog open={forwardOpen} onOpenChange={setForwardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Send className="h-5 w-5" />Forward to mechanic</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label className="text-xs">Filter by specialty</Label>
              <Select value={forwardSpecialty} onValueChange={setForwardSpecialty}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All specialties</SelectItem>
                  {Array.from(new Set(mechanicsList.flatMap(m => m.specialties ?? []))).map(s => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Mechanic</Label>
              <Select value={forwardMechId} onValueChange={setForwardMechId}>
                <SelectTrigger><SelectValue placeholder="Pick mechanic" /></SelectTrigger>
                <SelectContent>
                  {mechanicsList
                    .filter(m => forwardSpecialty === "all" || (m.specialties ?? []).includes(forwardSpecialty))
                    .map(m => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}{m.specialties?.length ? ` · ${m.specialties.join(", ")}` : ""}
                      </SelectItem>
                    ))}
                  {mechanicsList.filter(m => forwardSpecialty === "all" || (m.specialties ?? []).includes(forwardSpecialty)).length === 0 && (
                    <div className="p-3 text-xs text-muted-foreground">No mechanics with this specialty. Add one in Tools → Mechanic.</div>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setForwardOpen(false)}>Cancel</Button>
            <Button onClick={forwardToMechanic} className="bg-gradient-primary">
              <Send className="h-4 w-4 mr-2" />Forward
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><QrCode className="h-5 w-5" />Scan to view diagnosis</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 py-2">
            {qrDataUrl && <img src={qrDataUrl} alt="Approval QR" className="rounded-md border" />}
            <p className="text-xs text-center text-muted-foreground">
              Hand the phone to the client. The page is view-only — they'll read out the 6-digit code shown there.
            </p>
            <p className="font-mono text-xs break-all text-center px-2">{approvalUrl}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQrOpen(false)}>Close</Button>
            <Button className="bg-gradient-primary" onClick={() => { setQrOpen(false); setCodeOpen(true); }}>
              <KeyRound className="h-4 w-4 mr-2" />Enter their code
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={codeOpen} onOpenChange={setCodeOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" />Client approval code</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Enter the 6-digit code the client read out. Once verified, the job moves automatically to parts sourcing.
            </p>
            <Input
              autoFocus
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              placeholder="000000"
              value={enteredCode}
              onChange={(e) => setEnteredCode(e.target.value.replace(/[^\d]/g, "").slice(0,6))}
              className="text-center font-mono text-2xl tracking-[0.4em] h-14"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCodeOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-primary" onClick={verifyClientCode} disabled={verifying || enteredCode.length !== 6}>
              {verifying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
              Verify & approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ===== Line item row (Part picker w/ stock check, or Labour) =====
function LineItemRow({
  line, parts, stock, onUpdate, onRemove, onPickPart,
}: {
  line: any;
  parts: any[];
  stock: Record<string, number>;
  onUpdate: (p: any) => void;
  onRemove: () => void;
  onPickPart: (partId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const isLabour = line.kind === "labour";
  const filtered = useMemo(() => {
    if (isLabour) return [];
    const q = search.trim().toLowerCase();
    if (!q) return parts.slice(0, 8);
    return parts.filter((p) =>
      p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q)
    ).slice(0, 8);
  }, [search, parts, isLabour]);

  const inStock = line.part_id ? (stock[line.part_id] ?? 0) > 0 : null;
  const lineTotal = Number(line.qty || 0) * Number(line.unit_price || 0);

  return (
    <div className="rounded-md border p-3 bg-muted/20 space-y-2">
      <div className="flex items-center gap-2">
        <Select value={line.kind} onValueChange={(v) => onUpdate({ kind: v, part_id: v === "labour" ? null : line.part_id })}>
          <SelectTrigger className="w-[110px] h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="part">Part</SelectItem>
            <SelectItem value="labour">Labour</SelectItem>
          </SelectContent>
        </Select>
        {line.source !== "manual" && (
          <Badge variant="outline" className="text-[10px] capitalize">{line.source}</Badge>
        )}
        {!isLabour && line.part_id && (
          inStock
            ? <Badge className="bg-success text-success-foreground text-[10px]">in stock</Badge>
            : <Badge variant="outline" className="border-destructive text-destructive text-[10px]">out of stock — manual price</Badge>
        )}
        <div className="ml-auto text-sm font-bold">KSh {lineTotal.toLocaleString()}</div>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onRemove}><Trash2 className="h-3 w-3" /></Button>
      </div>

      {!isLabour && !line.part_id && (
        <div className="space-y-1">
          <Input placeholder="Search part by name or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-sm" />
          {filtered.length > 0 && (
            <div className="max-h-40 overflow-auto rounded-md border bg-card">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-left px-2 py-1.5 text-xs hover:bg-muted flex items-center justify-between"
                  onClick={() => { onPickPart(p.id); setSearch(""); }}
                >
                  <span>
                    <span className="font-medium">{p.name}</span>
                    <span className="text-muted-foreground ml-2">{p.sku}</span>
                  </span>
                  <span className="text-muted-foreground">
                    {(stock[p.id] ?? 0) > 0 ? `${stock[p.id]} in stock` : <span className="text-destructive">out</span>}
                    {" · KSh "}{Number(p.unit_price || 0).toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-12 gap-2 items-center">
        <Input
          className="col-span-7 h-8 text-sm"
          placeholder={isLabour ? "Labour description (e.g. Brake bleeding)" : "Description"}
          value={line.description ?? ""}
          onChange={(e) => onUpdate({ description: e.target.value })}
          onBlur={(e) => onUpdate({ description: e.target.value })}
        />
        <Input
          className="col-span-2 h-8 text-sm" type="number" min={0} step={1}
          value={line.qty}
          onChange={(e) => onUpdate({ qty: Number(e.target.value) })}
          placeholder="Qty"
        />
        <Input
          className="col-span-3 h-8 text-sm" type="number" min={0}
          value={line.unit_price}
          onChange={(e) => onUpdate({ unit_price: Number(e.target.value) })}
          placeholder="Unit price"
        />
      </div>
    </div>
  );
}

function DocCard({
  title, icon, enabled, lockedReason, active, onDownload,
}: {
  title: string;
  icon: React.ReactNode;
  enabled: boolean;
  lockedReason?: string;
  active: boolean;
  onDownload: () => void;
}) {
  return (
    <div className={`rounded-lg border p-4 ${active ? "border-primary bg-primary/5" : "bg-card"}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <p className="font-semibold text-sm">{title}</p>
        {active && <Badge className="ml-auto bg-primary">Current</Badge>}
        {!enabled && <Lock className="ml-auto h-3 w-3 text-muted-foreground" />}
      </div>
      {!enabled && lockedReason && <p className="text-[11px] text-muted-foreground mb-2">{lockedReason}</p>}
      <Button size="sm" variant={active ? "default" : "outline"} className={`w-full ${active ? "bg-gradient-primary" : ""}`} disabled={!enabled} onClick={onDownload}>
        Download PDF
      </Button>
    </div>
  );
}
