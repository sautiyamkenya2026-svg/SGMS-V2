import { useEffect, useMemo, useRef, useState } from "react";
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
import { friendlyErrorMessage } from "@/lib/app-error";
import {
  closeReservedDocumentWindow,
  openStoredDocumentUrl,
  reserveDocumentWindow,
  storeGatePassPdf,
  storeInvoiceDocumentPdf,
  storeJobCardPdf,
} from "@/lib/document-storage";
import { readEdgeFunctionErrorMessage } from "@/lib/edge-function-error";
import { invokeEdgeFunction } from "@/lib/invoke-edge";
import { getInspectionSystemLabel, isServiceCategory } from "@/lib/inspection-tree";
import { canonicalizeDocuments, canonicalizeGeneratedMovements } from "@/lib/generated-records";
import {
  DEFAULT_SERVICE_TYPE,
  SERVICE_TYPE_OPTIONS,
  type ServiceTypeValue,
  formatServiceTypes,
  getServiceTypes,
  primaryServiceType,
  serviceTypeIncludes,
  serviceTypeLabel,
} from "@/lib/service-types";

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

const STATUS_ORDER: Record<JobStatus, number> = {
  diagnosis: 0,
  diagnosed: 1,
  diagnosis_approval: 2,
  parts: 3,
  parts_approval: 4,
  repair: 5,
  awaiting_approval: 6,
  completed: 7,
  closed: 8,
};

const isIssuedPartMovement = (movement: any) =>
  ["sale", "transfer_out", "issue", "out"].includes(String(movement?.type ?? ""));

const parseLineNumberInput = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
  service_types: string[] | null;
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
  fuel_type: string | null;
  quotation_amount: number;
  invoice_amount: number;
  receipt_amount: number;
  deposit_required: number;
  deposit_paid: number;
  discount_amount: number;
  discount_reason: string | null;
  return_visit_type: "same_problem" | "related_problem" | "new_problem" | null;
  return_visit_notes: string | null;
  assigned_mechanic_id: string | null;
  client_feedback_token: string | null;
  client_approved_at: string | null;
  client_rating: number | null;
  feedback_rating: number | null;
  lead_source: string | null;
  lead_source_detail: string | null;
  payer_type: string;
  payer_name: string | null;
  payment_bypass: boolean;
  payment_bypass_reason: string | null;
  payment_bypass_authorized_by: string | null;
  vehicle_color: string | null;
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
type JobCardPhotoKind = "plate" | "front" | "back" | "left" | "right" | "door_jamb";
type JobCardPhotoDraft = { file: File; preview: string };
type ReturnVisitType = "same_problem" | "related_problem" | "new_problem";
type ReturnVisitJob = {
  id: string;
  job_no: string;
  status: JobStatus;
  customer_name: string | null;
  customer_phone: string | null;
  vehicle_label: string | null;
  reported_problem: string | null;
  complaint: string | null;
  fuel_type: string | null;
  service_type: string | null;
  service_types: string[] | null;
  paint_color_code: string | null;
  vehicle_color: string | null;
  has_insurance: boolean;
  insurance_company: string | null;
  insurance_policy_no: string | null;
  lead_source: string | null;
  lead_source_detail: string | null;
  created_at: string;
  completed_at: string | null;
};

const JOB_CARD_PHOTO_LABELS: Record<JobCardPhotoKind, string> = {
  plate: "Plate",
  front: "Front",
  back: "Back",
  left: "Left",
  right: "Right",
  door_jamb: "Door jamb",
};

const VEHICLE_AI_PHOTO_KINDS: JobCardPhotoKind[] = ["front", "back", "left", "right"];

const CLIENT_SOURCE_OPTIONS = [
  { value: "walk_in", label: "Walk-in" },
  { value: "referral", label: "Referral by friend" },
  { value: "social_media_ads", label: "Social media ads" },
  { value: "repeat_customer", label: "Repeat customer" },
  { value: "insurance", label: "Insurance partner" },
  { value: "other", label: "Other" },
] as const;

type DocumentKind = "quotation" | "deposit_invoice" | "invoice" | "receipt";

const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  quotation: "Quotation",
  deposit_invoice: "Deposit invoice",
  invoice: "Invoice",
  receipt: "Receipt",
};

const LEAD_SOURCE_LABELS: Record<string, string> = {
  walk_in: "Walk-in",
  referral: "Referral by friend",
  social_media_ads: "Social media ads",
  repeat_customer: "Repeat customer",
  insurance: "Insurance partner",
  other: "Other",
};

const getDocumentNumber = (jobNo: string, kind: DocumentKind) => {
  if (kind === "quotation") return `Q-${jobNo}`;
  if (kind === "deposit_invoice") return `DEP-${jobNo}`;
  if (kind === "receipt") return `RC-${jobNo}`;
  return `INV-${jobNo}`;
};

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

async function openGatePassPdf(
  job: Job,
  gatePass: GatePassRow,
  amountPaid: number,
  target?: Window | null,
) {
  const stored = await storeGatePassPdf({
    gatePassId: gatePass.id,
    data: {
      pass_no: gatePass.pass_no,
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
    },
  });
  openStoredDocumentUrl(stored.url, target);
}

export default function Jobs() {
  const { user, loading: authLoading } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [openJob, setOpenJob] = useState<Job | null>(null);
  const [tab, setTab] = useState("new_checkin");
  const [loading, setLoading] = useState(true);
  const activeColumns = useMemo(() => columns.filter((column) => column.key !== "completed"), []);
  const completedJobs = useMemo(
    () => jobs.filter((job) => job.status === "completed" || job.status === "closed"),
    [jobs],
  );

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
        <TabsList className="h-auto w-full flex-wrap justify-start gap-2 bg-transparent p-0">
          <TabsTrigger value="new_checkin">New Check-In</TabsTrigger>
          <TabsTrigger value="returned_checkin">Returned Check-In</TabsTrigger>
          <TabsTrigger value="active">Active Jobs</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
        </TabsList>

        <TabsContent value="new_checkin" className="mt-4">
          <CheckInForm mode="new" onCreated={() => { setTab("active"); load(); }} userId={user?.id} />
        </TabsContent>

        <TabsContent value="returned_checkin" className="mt-4">
          <CheckInForm mode="returned" onCreated={() => { setTab("active"); load(); }} userId={user?.id} />
        </TabsContent>

        <TabsContent value="active" className="mt-4">
          {loading ? (
            <p className="text-center text-muted-foreground py-8">Loading…</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
              {activeColumns.map(col => {
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

        <TabsContent value="completed" className="mt-4">
          <Card>
            <div className="p-4 border-b">
              <h3 className="font-semibold">Completed jobs ready for billing & gate pass</h3>
            </div>
            <div className="divide-y">
              {completedJobs.map(j => (
                <BillingRow key={j.id} job={j} onOpen={() => setOpenJob(j)} onChange={load} />
              ))}
              {completedJobs.length === 0 && (
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
    const gatePassWindow = reserveDocumentWindow();
    try {
      const gatePass = await ensureGatePass(job.id);
      await supabase.from("jobs").update({
        gate_pass_issued: true,
        status: "closed",
        closed_at: new Date().toISOString(),
      }).eq("id", job.id);
      await openGatePassPdf(job, gatePass, amountPaid || totalDue, gatePassWindow);
    } catch (e: any) {
      closeReservedDocumentWindow(gatePassWindow);
      toast.error(e?.message ?? "Could not issue gate pass");
      return;
    }
    toast.success("Gate pass ready — opening secure link");
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

function CheckInForm({
  onCreated,
  userId,
  mode,
}: {
  onCreated: () => void;
  userId?: string;
  mode: "new" | "returned";
}) {
  const [plate, setPlate] = useState("");
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [assignedMechId, setAssignedMechId] = useState("");
  const [mechRoster, setMechRoster] = useState<Array<{ id: string; name: string; specialties: string[]; level: string }>>([]);
  const [complaint, setComplaint] = useState("");
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeValue[]>([DEFAULT_SERVICE_TYPE]);
  const [fuelType, setFuelType] = useState<"petrol" | "diesel" | "unknown">("unknown");
  const [vehicleColor, setVehicleColor] = useState("");
  const [paintCode, setPaintCode] = useState("");
  const [photos, setPhotos] = useState<Partial<Record<JobCardPhotoKind, JobCardPhotoDraft>>>({});
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);
  const [hasInsurance, setHasInsurance] = useState(false);
  const [insuranceCompany, setInsuranceCompany] = useState("");
  const [insurancePolicy, setInsurancePolicy] = useState("");
  const [clientSource, setClientSource] = useState<string>("walk_in");
  const [clientSourceDetail, setClientSourceDetail] = useState("");
  const [history, setHistory] = useState<{ count: number; lastJobNo?: string }>({ count: 0 });
  const [returnVisitType, setReturnVisitType] = useState<ReturnVisitType>("new_problem");
  const [returnVisitNotes, setReturnVisitNotes] = useState("");
  const [previousJobs, setPreviousJobs] = useState<ReturnVisitJob[]>([]);
  const [selectedPreviousJobId, setSelectedPreviousJobId] = useState("");
  const isReturnedMode = mode === "returned";
  const normalizedPlate = plate.trim().toUpperCase();
  const showReturnVisitFields = isReturnedMode && previousJobs.length > 0;
  const selectedPreviousJob = previousJobs.find((row) => row.id === selectedPreviousJobId) ?? previousJobs[0] ?? null;
  const needsFreshComplaint = showReturnVisitFields && returnVisitType !== "same_problem";
  const selectedPrimaryServiceType = serviceTypes[0] ?? DEFAULT_SERVICE_TYPE;

  const toggleServiceType = (value: ServiceTypeValue) => {
    setServiceTypes((current) => {
      if (current.includes(value)) {
        return current.length === 1 ? current : current.filter((item) => item !== value);
      }
      return [...current, value];
    });
  };

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

  useEffect(() => {
    if (normalizedPlate.length < 4) {
      setHistory({ count: 0 });
      setPreviousJobs([]);
      setSelectedPreviousJobId("");
      setReturnVisitType("new_problem");
      setReturnVisitNotes("");
      return;
    }
    const timeoutId = setTimeout(async () => {
      const { data } = await supabase
        .from("jobs")
        .select(`
          id,
          job_no,
          status,
          customer_name,
          customer_phone,
          vehicle_label,
          reported_problem,
          complaint,
          fuel_type,
          service_type,
          service_types,
          paint_color_code,
          vehicle_color,
          has_insurance,
          insurance_company,
          insurance_policy_no,
          lead_source,
          lead_source_detail,
          created_at,
          completed_at
        `)
        .eq("plate", normalizedPlate)
        .order("created_at", { ascending: false })
        .limit(5);
      const rows = (data ?? []) as ReturnVisitJob[];
      setHistory({ count: rows.length, lastJobNo: rows[0]?.job_no });
      setPreviousJobs(rows);
      setSelectedPreviousJobId((current) => {
        if (current && rows.some((row) => row.id === current)) return current;
        return rows[0]?.id ?? "";
      });

      if (!isReturnedMode || rows.length === 0) return;

      const latest = rows[0];
      const [seedMake, ...seedModelParts] = (latest.vehicle_label ?? "").trim().split(/\s+/).filter(Boolean);
      const seedModel = seedModelParts.join(" ");

      setCustomer((current) => current || latest.customer_name || "");
      setPhone((current) => current || latest.customer_phone || "");
      setMake((current) => current || seedMake || "");
      setModel((current) => current || seedModel || "");
      setComplaint((current) => current || latest.reported_problem || latest.complaint || "");
      setFuelType((current) => current === "unknown" && latest.fuel_type ? latest.fuel_type as "petrol" | "diesel" | "unknown" : current);
      setVehicleColor((current) => current || latest.vehicle_color || "");
      setServiceTypes((current) => {
        const isDefaultOnly = current.length === 1 && current[0] === DEFAULT_SERVICE_TYPE;
        if (!isDefaultOnly) return current;
        return getServiceTypes(latest.service_types, latest.service_type);
      });
      setPaintCode((current) => current || latest.paint_color_code || "");
      setHasInsurance((current) => current || Boolean(latest.has_insurance));
      setInsuranceCompany((current) => current || latest.insurance_company || "");
      setInsurancePolicy((current) => current || latest.insurance_policy_no || "");
      setClientSource((current) => current === "walk_in" && latest.lead_source ? latest.lead_source : current);
      setClientSourceDetail((current) => current || latest.lead_source_detail || "");
    }, 400);
    return () => clearTimeout(timeoutId);
  }, [isReturnedMode, normalizedPlate]);

  const analysePhotos = async () => {
    const images = VEHICLE_AI_PHOTO_KINDS
      .map((side) => photos[side]?.preview)
      .filter((value): value is string => Boolean(value));
    if (images.length === 0) {
      toast.error("Take at least one vehicle photo first");
      return;
    }
    setAiBusy(true);
    try {
      const { data, error, response } = await invokeEdgeFunction("vehicle-vision", { body: { images } });
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
      if (data?.color && !vehicleColor) setVehicleColor(String(data.color));
      if (Array.isArray(data?.visible_problems) && data.visible_problems.length > 0 && !complaint) {
        setComplaint(data.visible_problems.map((photoIssue: any) => `- ${photoIssue.area}: ${photoIssue.problem} (${photoIssue.severity})`).join("\n"));
      }
      toast.success("Photos analysed — review and edit anything that's wrong");
    } finally {
      setAiBusy(false);
    }
  };

  const resetForm = () => {
    setPlate("");
    setCustomer("");
    setPhone("");
    setMake("");
    setModel("");
    setAssignedMechId("");
    setComplaint("");
    setServiceTypes([DEFAULT_SERVICE_TYPE]);
    setFuelType("unknown");
    setVehicleColor("");
    setPaintCode("");
    setPhotos({});
    setAiResult(null);
    setHasInsurance(false);
    setInsuranceCompany("");
    setInsurancePolicy("");
    setClientSource("walk_in");
    setClientSourceDetail("");
    setHistory({ count: 0 });
    setReturnVisitType("new_problem");
    setReturnVisitNotes("");
    setPreviousJobs([]);
    setSelectedPreviousJobId("");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!normalizedPlate) {
      toast.error("Plate is required");
      return;
    }

    if (isReturnedMode && !selectedPreviousJob) {
      toast.error("Enter a plate with an existing job card first");
      return;
    }

    const previousJob = selectedPreviousJob;
    const previousVehicleTokens = (previousJob?.vehicle_label ?? "").trim().split(/\s+/).filter(Boolean);
    const fallbackMake = previousVehicleTokens[0] ?? "";
    const fallbackModel = previousVehicleTokens.slice(1).join(" ");
    const customerName = (customer.trim() || (isReturnedMode ? (previousJob?.customer_name ?? "") : "")).trim();
    const customerPhone = (phone.trim() || (isReturnedMode ? (previousJob?.customer_phone ?? "") : "")).trim();
    const resolvedMake = (make.trim() || (isReturnedMode ? fallbackMake : "")).trim();
    const resolvedModel = (model.trim() || (isReturnedMode ? fallbackModel : "")).trim();
    const complaintText = complaint.trim();
    const resolvedComplaint = showReturnVisitFields && returnVisitType === "same_problem"
      ? (complaintText || previousJob?.reported_problem || previousJob?.complaint || "")
      : complaintText;
    if (needsFreshComplaint && !complaintText) {
      toast.error("Enter the new reported problem");
      return;
    }
    if (!resolvedComplaint) {
      toast.error("Reported problem is required");
      return;
    }
    if (!customerPhone) {
      toast.error("Customer phone is required so the client portal can be created");
      return;
    }

    const selectedMechanic = mechRoster.find((mechanic) => mechanic.id === assignedMechId) ?? null;
    const vehicleLabel = [resolvedMake, resolvedModel].filter(Boolean).join(" ") || null;
    const resolvedFuelType = fuelType !== "unknown"
      ? fuelType
      : ((previousJob?.fuel_type as "petrol" | "diesel" | "unknown" | null) ?? "unknown");
    const resolvedVehicleColor = (vehicleColor.trim() || aiResult?.color || previousJob?.vehicle_color || "").trim();
    const resolvedServiceTypes = isReturnedMode
      && serviceTypes.length === 1
      && serviceTypes[0] === DEFAULT_SERVICE_TYPE
      && (previousJob?.service_types?.length || previousJob?.service_type)
        ? getServiceTypes(previousJob?.service_types, previousJob?.service_type)
        : getServiceTypes(serviceTypes);
    const resolvedServiceType = primaryServiceType(resolvedServiceTypes);
    const resolvedPaintCode = serviceTypeIncludes(resolvedServiceTypes, resolvedServiceType, "body")
      ? (paintCode || previousJob?.paint_color_code || null)
      : null;
    const resolvedHasInsurance = hasInsurance || Boolean(previousJob?.has_insurance);
    const resolvedInsuranceCompany = resolvedHasInsurance
      ? (insuranceCompany || previousJob?.insurance_company || null)
      : null;
    const resolvedInsurancePolicy = resolvedHasInsurance
      ? (insurancePolicy || previousJob?.insurance_policy_no || null)
      : null;
    const resolvedClientSource = clientSource === "walk_in" && previousJob?.lead_source
      ? previousJob.lead_source
      : clientSource;
    const resolvedClientSourceDetail = clientSourceDetail.trim() || previousJob?.lead_source_detail || "";

    setBusy(true);
    try {
      let clientId: string | null = null;
      if (customerName || customerPhone) {
        let existingClient: { id: string } | null = null;
        if (customerPhone) {
          const { data } = await supabase
            .from("clients")
            .select("id")
            .eq("phone_primary", customerPhone)
            .limit(1)
            .maybeSingle();
          existingClient = (data as { id: string } | null) ?? null;
        }
        if (!existingClient && customerName) {
          const { data } = await supabase
            .from("clients")
            .select("id")
            .eq("name", customerName)
            .limit(1)
            .maybeSingle();
          existingClient = (data as { id: string } | null) ?? null;
        }

        const clientPayload = {
          name: customerName || normalizedPlate,
          phone_primary: customerPhone || null,
          source: resolvedClientSource || null,
          source_detail: resolvedClientSourceDetail || null,
          referred_by: resolvedClientSource === "referral" ? (resolvedClientSourceDetail || null) : null,
        };

        if (existingClient?.id) {
          const { error } = await supabase.from("clients").update(clientPayload).eq("id", existingClient.id);
          if (error) throw error;
          clientId = existingClient.id;
        } else {
          const { data, error } = await supabase.from("clients").insert(clientPayload).select("id").single();
          if (error) throw error;
          clientId = data.id;
        }
      }

      let vehicleId: string | null = null;
      const { data: existingVehicle } = await supabase
        .from("vehicles")
        .select("id, fuel_type, color")
        .eq("plate", normalizedPlate)
        .limit(1)
        .maybeSingle();
      const existingVehicleFuel = (existingVehicle as any)?.fuel_type as string | null;
      const existingVehicleColor = (existingVehicle as any)?.color as string | null;
      const vehiclePayload = {
        client_id: clientId,
        plate: normalizedPlate,
        make: resolvedMake || null,
        model: resolvedModel || null,
        color: resolvedVehicleColor || existingVehicleColor || null,
        fuel_type: resolvedFuelType !== "unknown" ? resolvedFuelType : existingVehicleFuel ?? null,
        detected_by_ai: Boolean(aiResult),
      };

      if (existingVehicle?.id) {
        const { error } = await supabase.from("vehicles").update(vehiclePayload).eq("id", existingVehicle.id);
        if (error) throw error;
        vehicleId = existingVehicle.id;
      } else {
        const { data, error } = await supabase.from("vehicles").insert(vehiclePayload).select("id").single();
        if (error) throw error;
        vehicleId = data.id;
      }

      const { data: job, error: jobError } = await supabase.from("jobs").insert({
        plate: normalizedPlate,
        vehicle_id: vehicleId,
        client_id: clientId,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        vehicle_label: vehicleLabel,
        mechanic: selectedMechanic?.name ?? null,
        assigned_mechanic_id: assignedMechId || null,
        complaint: resolvedComplaint || null,
        reported_problem: resolvedComplaint || null,
        fuel_type: resolvedFuelType !== "unknown" ? resolvedFuelType : existingVehicleFuel ?? null,
        service_type: resolvedServiceType,
        service_types: resolvedServiceTypes,
        paint_color_code: resolvedPaintCode,
        vehicle_color: resolvedVehicleColor || existingVehicleColor || null,
        estimate: 0,
        has_insurance: resolvedHasInsurance,
        insurance_company: resolvedInsuranceCompany,
        insurance_policy_no: resolvedInsurancePolicy,
        lead_source: resolvedClientSource || null,
        lead_source_detail: resolvedClientSourceDetail || null,
        previous_job_id: showReturnVisitFields ? (previousJob?.id ?? null) : null,
        return_visit_type: showReturnVisitFields ? returnVisitType : null,
        return_visit_notes: showReturnVisitFields ? (returnVisitNotes.trim() || null) : null,
        status: "diagnosis",
        created_by: userId ?? null,
      }).select("id, job_no").single();
      if (jobError) throw jobError;

      const { error: portalError } = await invokeEdgeFunction("ensure-client-portal-user", {
        body: {
          plate: normalizedPlate,
          phone: customerPhone,
          client_id: clientId,
          vehicle_id: vehicleId,
          customer_name: customerName || normalizedPlate,
        },
      });
      if (portalError) throw portalError;

      if (job?.id && assignedMechId) {
        const { error } = await supabase.from("job_mechanics").upsert(
          { job_id: job.id, mechanic_id: assignedMechId, role_on_job: "lead" },
          { onConflict: "job_id,mechanic_id" },
        );
        if (error) throw error;
      }

      const draftPhotos = Object.entries(photos) as Array<[JobCardPhotoKind, JobCardPhotoDraft]>;
      if (job?.id && draftPhotos.length > 0) {
        const rows: Array<{ job_id: string; kind: JobCardPhotoKind; storage_path: string; uploaded_by: string | null }> = [];
        for (const [kind, photo] of draftPhotos) {
          const ext = photo.file.name.split(".").pop()?.toLowerCase() || "jpg";
          const storagePath = `${job.id}/${kind}-${Date.now()}.${ext}`;
          const { error } = await supabase.storage.from("job-card-photos").upload(storagePath, photo.file, { upsert: true });
          if (error) throw error;
          rows.push({
            job_id: job.id,
            kind,
            storage_path: storagePath,
            uploaded_by: userId ?? null,
          });
        }
        if (rows.length > 0) {
          const { error } = await supabase.from("job_card_photos").insert(rows);
          if (error) throw error;
        }
      }

      if (job?.id) {
        await supabase.rpc("notify_client_portal" as any, {
          _job_id: job.id,
          _title: "Vehicle admitted",
          _body: `${normalizedPlate} has been admitted and job card ${job.job_no} is now live in your portal.`,
          _kind: "job_created",
          _link: "/client",
        });
      }

      toast.success("Job card created — number assigned");
      resetForm();
      onCreated();
    } catch (error: any) {
      toast.error(error.message ?? "Could not create the job card");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="max-w-4xl p-6">
      <div className="mb-4 space-y-1">
        <h3 className="flex items-center gap-2 font-semibold">
          <Plus className="h-4 w-4 text-primary" />
          {isReturnedMode ? "Returned Check-In" : "New Check-In"}
        </h3>
        <p className="text-sm text-muted-foreground">
          {isReturnedMode
            ? "Enter the plate first, link the earlier job, and mark whether the vehicle came back for the same problem, a related problem, or a new problem."
            : "Create a fresh job card for a new arrival, then proceed with workshop intake."}
        </p>
      </div>

      {history.count > 0 && isReturnedMode && (
        <div className="mb-4 flex items-start gap-2 rounded-md border-2 border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <History className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold text-amber-900 dark:text-amber-200">
              Welcome back! This vehicle has {history.count} previous job{history.count > 1 ? "s" : ""}.
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300">Last job: {history.lastJobNo}. Past history will auto-link to this new job.</p>
          </div>
        </div>
      )}

      {history.count > 0 && !isReturnedMode && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-primary/25 bg-primary/5 p-3 text-sm">
          <History className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="font-semibold">This plate already has workshop history.</p>
            <p className="text-xs text-muted-foreground">
              If this car is coming back for the same, related, or a new problem, switch to the <strong>Returned Check-In</strong> tab so the jobs stay linked.
            </p>
          </div>
        </div>
      )}

      {isReturnedMode && normalizedPlate.length >= 4 && previousJobs.length === 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-semibold">No earlier job found for this plate yet.</p>
            <p className="text-xs text-muted-foreground">
              If this is the first visit for this car, use the <strong>New Check-In</strong> tab instead.
            </p>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2 space-y-2">
          <Label>Plate number</Label>
          <div className="flex gap-2">
            <Input placeholder="KCA 123A" value={plate} onChange={(e) => setPlate(e.target.value)} required />
            <CameraInput onPick={(file, preview) => setPhotos((current) => ({ ...current, plate: { file, preview } }))} />
          </div>
          {photos.plate && <img src={photos.plate.preview} alt="plate" className="mt-1 h-12 rounded" />}
        </div>
        {isReturnedMode && selectedPreviousJob && (
          <div className="md:col-span-2 rounded-md border bg-muted/30 p-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="font-semibold">Matched previous vehicle</p>
                <p>{selectedPreviousJob.vehicle_label || "Vehicle details on file"} - {selectedPreviousJob.customer_name || "Customer on file"}</p>
                <p className="text-xs text-muted-foreground">
                  {selectedPreviousJob.customer_phone || "No phone on file"} - last job {selectedPreviousJob.job_no}
                </p>
              </div>
              <Badge variant="secondary">{STATUS_LABEL[selectedPreviousJob.status]}</Badge>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <div>
                <p className="text-xs uppercase text-muted-foreground">Last reported problem</p>
                <p>{selectedPreviousJob.reported_problem ?? selectedPreviousJob.complaint ?? "No problem recorded"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Service type on file</p>
                <p>{formatServiceTypes(selectedPreviousJob.service_types, selectedPreviousJob.service_type)}</p>
              </div>
            </div>
          </div>
        )}
        {isReturnedMode && (
          <>
            <div className="space-y-2">
              <Label>Customer name</Label>
              <Input placeholder="Customer name" value={customer} onChange={(e) => setCustomer(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input placeholder="+254 7XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </>
        )}
        {!isReturnedMode && (
          <>
            <div className="space-y-2">
              <Label>Customer name</Label>
              <Input placeholder="Customer name" value={customer} onChange={(e) => setCustomer(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input placeholder="+254 7XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Make</Label>
              <Input list="vehicle-makes" placeholder="Mazda" value={make} onChange={(e) => setMake(e.target.value)} />
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
                placeholder={make.toLowerCase() === "mazda" ? "Demio / Axela / CX-5..." : "Demio, Premio, Note..."}
                value={model}
                onChange={(e) => setModel(e.target.value)}
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
              {make.toLowerCase() === "mazda" && <p className="text-[11px] text-muted-foreground">Mazda-friendly: pick a Mazda model from the dropdown.</p>}
            </div>
          </>
        )}
        <div className="space-y-2 md:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Service types</Label>
            <span className="text-[11px] text-muted-foreground">Primary: {serviceTypeLabel(selectedPrimaryServiceType)}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {SERVICE_TYPE_OPTIONS.map((option) => {
              const checked = serviceTypes.includes(option.value);
              return (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm transition-colors ${checked ? "border-primary bg-primary/5" : "bg-muted/20"}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleServiceType(option.value)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Pick one or many service types during check-in. The first selected type stays as the primary one for older screens and documents.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Fuel type</Label>
          <Select value={fuelType} onValueChange={(value: "petrol" | "diesel" | "unknown") => setFuelType(value)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unknown">Not set yet</SelectItem>
              <SelectItem value="petrol">Petrol</SelectItem>
              <SelectItem value="diesel">Diesel</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Vehicle colour</Label>
          <Input
            placeholder="Silver, white, black..."
            value={vehicleColor}
            onChange={(e) => setVehicleColor(e.target.value)}
          />
          {aiResult?.color && (
            <p className="text-[11px] text-muted-foreground">AI saw: {aiResult.color}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label>Assigned mechanic</Label>
          <Select value={assignedMechId || "unassigned"} onValueChange={(value) => setAssignedMechId(value === "unassigned" ? "" : value)}>
            <SelectTrigger><SelectValue placeholder="Pick mechanic" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">Unassigned for now</SelectItem>
              {mechRoster.map((mechanic) => (
                <SelectItem key={mechanic.id} value={mechanic.id}>
                  {mechanic.name}{mechanic.specialties?.length ? ` · ${mechanic.specialties.join(", ")}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {serviceTypes.includes("body") ? (
          <div className="space-y-2">
            <Label className="flex items-center gap-1"><Palette className="h-3 w-3" />Paint colour code</Label>
            <Input placeholder="e.g. 1G3 (Toyota Magnetic Gray)" value={paintCode} onChange={(e) => setPaintCode(e.target.value)} />
          </div>
        ) : <div />}
        {!isReturnedMode && (
          <>
            <div className="space-y-2">
              <Label>How did the client come to us?</Label>
              <Select value={clientSource} onValueChange={setClientSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CLIENT_SOURCE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{clientSource === "referral" ? "Referral details" : "Source details"}</Label>
              <Input
                placeholder={clientSource === "referral" ? "Friend's name or who referred them" : "Campaign, platform, or useful note"}
                value={clientSourceDetail}
                onChange={(e) => setClientSourceDetail(e.target.value)}
              />
            </div>
            <div className="md:col-span-2 space-y-2">
              <Label>Reported problem</Label>
              <Textarea placeholder="What the customer reported when bringing in the car..." value={complaint} onChange={(e) => setComplaint(e.target.value)} />
            </div>
          </>
        )}

        {showReturnVisitFields && (
          <div className="md:col-span-2 space-y-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-4">
            <div className="flex items-start gap-2">
              <History className="mt-0.5 h-4 w-4 text-amber-700" />
              <div>
                <p className="text-sm font-semibold text-amber-950">Returned car</p>
                <p className="text-xs text-amber-800">
                  Choose whether this visit is for the same problem, a related problem, or a new problem before creating the next job card.
                </p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Return type</Label>
                <Select value={returnVisitType} onValueChange={(value: ReturnVisitType) => setReturnVisitType(value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="same_problem">Same problem</SelectItem>
                    <SelectItem value="related_problem">Related problem</SelectItem>
                    <SelectItem value="new_problem">New problem</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Link to previous job</Label>
                <Select value={selectedPreviousJobId || "none"} onValueChange={(value) => setSelectedPreviousJobId(value === "none" ? "" : value)}>
                  <SelectTrigger><SelectValue placeholder="Pick previous job" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Latest linked automatically</SelectItem>
                    {previousJobs.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {row.job_no} - {row.reported_problem ?? row.complaint ?? "No problem recorded"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Return notes</Label>
              <Textarea
                rows={2}
                placeholder="Short note for this return visit, for example what changed since the last job."
                value={returnVisitNotes}
                onChange={(e) => setReturnVisitNotes(e.target.value)}
              />
            </div>
          </div>
        )}

        {showReturnVisitFields && !needsFreshComplaint && (
          <div className="md:col-span-2 rounded-md border bg-muted/30 p-3 text-sm">
            <p className="font-medium">Same-problem return</p>
            <p className="text-xs text-muted-foreground">
              This new job card will reuse the previous reported problem unless you add a return note.
            </p>
          </div>
        )}
        {isReturnedMode && needsFreshComplaint && (
          <div className="md:col-span-2 space-y-2">
            <Label>New reported problem</Label>
            <Textarea
              placeholder="Describe the new or related problem..."
              value={complaint}
              onChange={(e) => setComplaint(e.target.value)}
            />
          </div>
        )}

        {!isReturnedMode && (
        <>
        <div className="md:col-span-2 space-y-2 rounded-md border bg-muted/30 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={hasInsurance} onChange={(e) => setHasInsurance(e.target.checked)} className="h-4 w-4 accent-primary" />
            <ShieldAlert className="h-4 w-4 text-primary" />
            This car is covered by insurance
          </label>
          {hasInsurance && (
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div><Label className="text-xs">Insurance company</Label><Input value={insuranceCompany} onChange={(e) => setInsuranceCompany(e.target.value)} placeholder="e.g. Britam, Jubilee, AAR" /></div>
              <div><Label className="text-xs">Policy number</Label><Input value={insurancePolicy} onChange={(e) => setInsurancePolicy(e.target.value)} placeholder="POL-123456" /></div>
            </div>
          )}
        </div>
        <div className="md:col-span-2 space-y-2">
          <div className="flex items-center justify-between">
            <Label>Vehicle photos plus door jamb</Label>
            <Button type="button" size="sm" variant="outline" onClick={analysePhotos} disabled={aiBusy}>
              {aiBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
              {aiBusy ? "Analysing..." : "AI detect make / model / damage"}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
            {[...VEHICLE_AI_PHOTO_KINDS, "door_jamb" as const].map((side) => (
              <div key={side} className="relative flex aspect-square flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border-2 border-dashed border-border hover:border-primary hover:bg-muted/40">
                {photos[side] ? (
                  <img src={photos[side]?.preview} alt={side} className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <span className="text-[11px] font-medium text-muted-foreground">{JOB_CARD_PHOTO_LABELS[side]}</span>
                )}
                <div className="absolute bottom-1.5 right-1.5">
                  <CameraInput
                    size="sm"
                    onPick={(file, preview) => {
                      setPhotos((current) => {
                        const next = { ...current, [side]: { file, preview } };
                        const firstVehiclePhoto = VEHICLE_AI_PHOTO_KINDS.every((kind) => !current[kind]);
                        if (side !== "door_jamb" && firstVehiclePhoto && (!plate || !make || !model)) {
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
            <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-xs">
              <p className="flex items-center gap-1 font-semibold"><Sparkles className="h-3 w-3 text-primary" />AI suggestion (you can edit any field)</p>
              <p>Make / Model: <strong>{aiResult.make || "?"} {aiResult.model || ""}</strong> {aiResult.year_guess && `(${aiResult.year_guess})`} · confidence {Math.round((aiResult.confidence ?? 0) * 100)}%</p>
              {aiResult.color && <p>Colour: {aiResult.color}</p>}
              {Array.isArray(aiResult.visible_problems) && aiResult.visible_problems.length > 0 && (
                <ul className="list-inside list-disc">
                  {aiResult.visible_problems.map((photoIssue: any, index: number) => (
                    <li key={index}><strong className="capitalize">{photoIssue.severity}</strong> - {photoIssue.area}: {photoIssue.problem}</li>
                  ))}
                </ul>
              )}
              {(!aiResult.make && !aiResult.model) && <p className="italic text-muted-foreground">Couldn't detect make/model from these photos — please key it in.</p>}
            </div>
          )}
        </div>
        </>
        )}
        <div className="md:col-span-2 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={resetForm}>Reset</Button>
          <Button type="submit" disabled={busy || (isReturnedMode && previousJobs.length === 0)} className="bg-gradient-primary">
            <Plus className="mr-2 h-4 w-4" />{busy ? "Creating..." : isReturnedMode ? "Create Return Job Card" : "Create Job Card"}
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
  const { hasRole, user } = useAuth();
  const canSeePrivateJobPhotos = hasRole("admin") || hasRole("super_admin") || hasRole("manager") || hasRole("director");
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
  const [paymentReference, setPaymentReference] = useState("");
  const [amountPaid, setAmountPaid] = useState("0");
  const [depositRequired, setDepositRequired] = useState("0");
  const [depositPaid, setDepositPaid] = useState("0");
  const [payerType, setPayerType] = useState<"client" | "insurance">("client");
  const [payerName, setPayerName] = useState("");
  const [paymentBypass, setPaymentBypass] = useState(false);
  const [paymentBypassReason, setPaymentBypassReason] = useState("");
  const [paymentBypassAuthorizedBy, setPaymentBypassAuthorizedBy] = useState("");
  const [jobPhotos, setJobPhotos] = useState<Array<{ kind: string; url: string }>>([]);
  const financialSyncQueueRef = useRef<Promise<unknown>>(Promise.resolve());
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
      setDepositRequired(String((j as any).deposit_required ?? 0));
      setDepositPaid(String((j as any).deposit_paid ?? 0));
      setPayerType(((j as any).payer_type === "insurance" ? "insurance" : "client"));
      setPayerName((j as any).payer_name ?? ((j as any).payer_type === "insurance" ? ((j as any).insurance_company ?? "") : ((j as any).customer_name ?? "")));
      setPaymentBypass(Boolean((j as any).payment_bypass));
      setPaymentBypassReason((j as any).payment_bypass_reason ?? "");
      setPaymentBypassAuthorizedBy((j as any).payment_bypass_authorized_by ?? "");
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
      supabase.from("parts").select("id, name, sku, unit_price, unit_cost").order("name").limit(2000),
      supabase.from("part_stock").select("part_id, qty"),
    ]);
    const { data: mechs } = await supabase.from("mechanics").select("id, name, phone, specialties").eq("active", true).order("name");
    setMechanicsList((mechs ?? []) as any);
    if (canSeePrivateJobPhotos) {
      const { data: photoRows } = await supabase
        .from("job_card_photos")
        .select("kind, storage_path")
        .eq("job_id", jobId)
        .order("created_at", { ascending: true });
      const signedPhotos = await Promise.all((photoRows ?? []).map(async (row: any) => {
        const { data } = await supabase.storage.from("job-card-photos").createSignedUrl(row.storage_path, 60 * 60);
        return data?.signedUrl ? { kind: row.kind, url: data.signedUrl } : null;
      }));
      setJobPhotos(signedPhotos.filter((row): row is { kind: string; url: string } => Boolean(row)));
    } else {
      setJobPhotos([]);
    }
    const movementRows = canonicalizeGeneratedMovements((m ?? []) as any[]);
    const invoiceRows = canonicalizeDocuments((inv ?? []) as any[]);
    setPartsUsed(movementRows.filter((row: any) => isIssuedPartMovement(row)));
    setPettyForJob(p ?? []);
    setInvoicesForJob(invoiceRows);
    setLineItems(li ?? []);
    setPartsCatalog(cat ?? []);
    const paymentDoc = invoiceRows.find((row: any) => row.doc_type === "receipt")
      ?? invoiceRows.find((row: any) => row.doc_type === "invoice")
      ?? invoiceRows.find((row: any) => row.doc_type === "deposit_invoice");
    if (paymentDoc?.payment_mode) setPaymentMode(String(paymentDoc.payment_mode));
    if (paymentDoc?.payment_reference) setPaymentReference(String(paymentDoc.payment_reference));
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
  useEffect(() => { load(); }, [jobId, canSeePrivateJobPhotos]);

  if (!job) return <p className="text-center text-muted-foreground py-8">Loading…</p>;

  const notifyClient = async (title: string, body: string, kind: string, link = "/client") => {
    try {
      await supabase.rpc("notify_client_portal" as any, {
        _job_id: jobId,
        _title: title,
        _body: body,
        _kind: kind,
        _link: link,
      });
    } catch {
      // Client notifications should never block workshop operations.
    }
  };

  const partsCost = partsUsed.reduce((s, m) => s + (Number(m.buy_price ?? m.unit_price ?? 0) * Number(m.qty ?? 0)), 0);
  const partsRevenue = partsUsed.reduce((s, m) => s + (Number(m.sell_price ?? m.unit_price ?? 0) * Number(m.qty ?? 0)), 0);
  const pettyTotal = pettyForJob.reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const lineSubtotal = calculateLineSubtotal(lineItems);
  const discount = Number(discountAmt || 0);
  const lineTotal = calculateLineTotal(lineItems, discount);
  const profit = lineTotal - partsCost - pettyTotal;
  const depositRequiredValue = Math.max(0, Number(depositRequired || 0));
  const depositPaidValue = Math.max(0, Number(depositPaid || 0));
  const totalPaidValue = Math.max(0, Number(amountPaid || 0));
  const payerLabel = (
    payerName.trim()
    || (payerType === "insurance" ? (job.insurance_company ?? "") : (job.customer_name ?? ""))
  ).trim();
  const leadSourceLabel = job.lead_source ? (LEAD_SOURCE_LABELS[job.lead_source] ?? job.lead_source) : null;

  // ===== STRICT DOC GATING (real garage flow) =====
  // Quotation: available once we've moved past "diagnosis" (so a diagnosis is on file)
  // Invoice  : only after work is "completed"
  // Receipt  : only after the customer has paid (status "closed" OR amount_paid >= total)
  const canQuotation = job.status !== "diagnosis";
  const canDepositInvoice = canQuotation && depositRequiredValue > 0;
  const canInvoice = ["completed", "closed"].includes(job.status);
  const canReceipt = !paymentBypass && (job.status === "closed" || (totalPaidValue >= lineTotal && lineTotal > 0));
  const currentStage: DocumentKind =
    canReceipt ? "receipt" : canInvoice ? "invoice" : canDepositInvoice ? "deposit_invoice" : "quotation";

  const buildDocData = (kind: DocumentKind) => kind === "deposit_invoice"
    ? ({
        doc_no: getDocumentNumber(job.job_no, kind),
        job_no: job.job_no,
        date: new Date(job.started_at).toISOString().slice(0, 10),
        customer_name: payerLabel || (job.customer_name ?? ""),
        customer_phone: job.customer_phone ?? "",
        plate: job.plate,
        lines: [{
          description: `Deposit for job ${job.job_no} - ${job.plate}`,
          qty: 1,
          unit_price: depositRequiredValue,
        }],
        served_by: job.mechanic ?? undefined,
        discount: 0,
        amount_paid: depositPaidValue,
        notes: "Deposit requested before work starts.",
        vat: false,
      })
    : ({
    doc_no: getDocumentNumber(job.job_no, kind),
    job_no: job.job_no,
    date:
      kind === "receipt"
        ? String(job.paid_at ?? new Date().toISOString()).slice(0, 10)
        : kind === "invoice"
          ? String(job.completed_at ?? job.started_at).slice(0, 10)
          : new Date(job.started_at).toISOString().slice(0, 10),
    customer_name: payerLabel || (job.customer_name ?? ""),
    customer_phone: job.customer_phone ?? "",
    plate: job.plate,
    lines: lineItems.length > 0
      ? lineItems.map((l) => ({ description: `${l.kind === "labour" ? "Labour: " : ""}${l.description}`, qty: Number(l.qty || 0), unit_price: Number(l.unit_price || 0) }))
      : [{ description: `${job.service_type ?? "Service"} — ${job.reported_problem ?? job.complaint ?? "Workshop services"}`, qty: 1, unit_price: lineSubtotal || Number(job.estimate || 0) }],
    served_by: job.mechanic ?? undefined,
    discount,
    amount_paid: kind === "receipt" ? Math.max(0, totalPaidValue - depositPaidValue) : kind === "invoice" ? totalPaidValue : undefined,
    notes: workPerformed || reportedProblem || job.complaint || undefined,
    vat: false,
  });

  const findInvoiceDocument = (kind: DocumentKind) =>
    invoicesForJob.find((row: any) => row.doc_type === kind);

  const ensureInvoiceDocumentId = async (kind: DocumentKind) => {
    const existing = findInvoiceDocument(kind);
    if (existing?.id) return String(existing.id);

    const snapshot = await persistFinancialSnapshot({ silent: true });
    if (!snapshot) throw new Error(`Could not prepare the ${DOCUMENT_LABELS[kind].toLowerCase()}`);

    const { data, error } = await supabase
      .from("invoices")
      .select("id, doc_type")
      .eq("job_id", jobId)
      .eq("doc_type", kind)
      .maybeSingle();
    if (error) throw error;
    if (!data?.id) throw new Error(`${DOCUMENT_LABELS[kind]} is not ready yet`);

    setInvoicesForJob((current) => canonicalizeDocuments([
      ...(current.filter((row: any) => row.doc_type !== kind)),
      data as any,
    ]));

    return String(data.id);
  };

  const openInvoiceDocumentForJob = async (kind: DocumentKind, target?: Window | null) => {
    const invoiceId = await ensureInvoiceDocumentId(kind);
    const stored = await storeInvoiceDocumentPdf({
      invoiceId,
      kind,
      data: buildDocData(kind),
      paymentMode: kind === "receipt" ? paymentMode : undefined,
      receivedFrom: kind === "receipt" ? payerLabel : undefined,
    });
    openStoredDocumentUrl(stored.url, target);
    return stored;
  };

  const openJobCardDocument = async (target?: Window | null) => {
    const stored = await storeJobCardPdf({
      jobId,
      data: {
        job_no: job.job_no,
        plate: job.plate,
        vehicle: job.vehicle_label ?? "",
        customer_name: job.customer_name ?? "",
        customer_phone: job.customer_phone ?? "",
        customer_complaint: reportedProblem || (job.complaint ?? ""),
        technician_diagnosis: [
          job.ai_diagnostic_summary?.trim(),
          workPerformed.trim() ? `Work performed: ${workPerformed.trim()}` : "",
        ].filter(Boolean).join("\n\n"),
        technicians: job.mechanic ?? "",
        paint_color_code: job.paint_color_code ?? undefined,
      },
    });
    openStoredDocumentUrl(stored.url, target);
    return stored;
  };

  const openStoredDocumentCard = async (action: (target: Window | null) => Promise<unknown>) => {
    const target = reserveDocumentWindow();
    try {
      await action(target);
    } catch (e: any) {
      closeReservedDocumentWindow(target);
      toast.error(e?.message ?? "Could not open that PDF");
    }
  };

  // ------- AI: regenerate diagnostic summary + recommended parts ---------
  const runAiSummary = async () => {
    setAiBusy(true);
    try {
        const diagnosticFindings = findings.filter((f: any) => f.status && f.status !== "ok" && !isServiceCategory(f.category));
        const { data, error, response } = await invokeEdgeFunction("diagnose-summary", {
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
    if (error) { toast.error(friendlyErrorMessage(error, "Could not request that part.")); return; }
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
      toast.error(friendlyErrorMessage(error, "Could not add the line item."));
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
      toast.error(friendlyErrorMessage(error, "Could not update the line item."));
    } else {
      await persistFinancialSnapshot({ rows: next, silent: true });
    }
  };
  const removeLine = async (id: string) => {
    const next = lineItems.filter((l) => l.id !== id);
    const { error } = await supabase.from("job_line_items").delete().eq("id", id);
    if (error) {
      toast.error(friendlyErrorMessage(error, "Could not remove the line item."));
      return false;
    } else {
      setLineItems(next);
      await persistFinancialSnapshot({ rows: next, silent: true });
      return true;
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

  const removeIssuedPart = async (movement: any) => {
    const movementLabel = movement.parts?.name ?? "this issued part";
    if (!window.confirm(`Remove ${movementLabel} from this job and return it to stock?`)) return;

    try {
      const reference = String(movement.reference ?? "");
      const jobLineMatch = reference.match(/^job-line:(.+)$/i);
      if (jobLineMatch?.[1]) {
        const removed = await removeLine(jobLineMatch[1]);
        if (removed) {
          toast.success(`${movementLabel} removed and returned to stock`);
          load();
        }
        return;
      }

      const partRequestMatch = reference.match(/^part_request:(.+)$/i);
      if (partRequestMatch?.[1]) {
        const { error: requestError } = await supabase
          .from("part_requests")
          .update({ status: "approved" })
          .eq("id", partRequestMatch[1]);
        if (requestError) throw requestError;
      }

      const { error } = await supabase.from("stock_movements").delete().eq("id", movement.id);
      if (error) throw error;

      toast.success(`${movementLabel} removed and returned to stock`);
      load();
    } catch (error) {
      toast.error(friendlyErrorMessage(error, "Could not remove that issued part."));
    }
  };

  const syncPartLineSales = async (jobSnapshot: Job, rows: any[]) => {
    const saleRows = rows.filter((row) =>
      row.kind === "part" && row.part_id && !row.part_request_id && Number(row.qty || 0) > 0,
    );

    const references = saleRows.map((row) => `job-line:${row.id}`);
    if (references.length === 0) {
      const { error: clearError } = await supabase
        .from("stock_movements")
        .delete()
        .eq("job_id", jobSnapshot.id)
        .like("reference", "job-line:%");
      if (clearError) throw clearError;
      return;
    }

    const { data: existingMovements, error: existingError } = await supabase
      .from("stock_movements")
      .select("id, reference")
      .eq("job_id", jobSnapshot.id)
      .like("reference", "job-line:%");
    if (existingError) throw existingError;

    const staleIds = (existingMovements ?? [])
      .filter((movement: any) => !references.includes(String(movement.reference ?? "")))
      .map((movement: any) => movement.id as string);
    if (staleIds.length > 0) {
      const { error: deleteError } = await supabase.from("stock_movements").delete().in("id", staleIds);
      if (deleteError) throw deleteError;
    }

    const { data: primaryLocation } = await supabase
      .from("locations")
      .select("id")
      .eq("kind", "garage_store")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    let fallbackLocation: { id: string } | null = null;
    if (!primaryLocation?.id) {
      const { data } = await supabase
        .from("locations")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      fallbackLocation = (data as { id: string } | null) ?? null;
    }
    const locationId = primaryLocation?.id ?? fallbackLocation?.id ?? null;
    if (!locationId) return;

    const movementPayload = saleRows.map((row) => {
      const part = partsCatalog.find((entry) => entry.id === row.part_id);
      return {
        part_id: row.part_id,
        location_id: locationId,
        type: "sale",
        qty: Number(row.qty || 0),
        unit_price: Number(row.unit_price || 0),
        reference: `job-line:${row.id}`,
        note: `Issued from financial summary for ${jobSnapshot.job_no}`,
        buy_price: Number(part?.unit_cost || 0),
        sell_price: Number(row.unit_price || 0),
        created_by: user?.id ?? null,
        job_id: jobSnapshot.id,
      };
    });

    const { error } = await supabase
      .from("stock_movements")
      .upsert(movementPayload, { onConflict: "reference" });
    if (error) throw error;
  };

  const syncInvoiceItems = async (invoiceId: string, rows: any[]) => {
    const { error: clearError } = await supabase.from("invoice_items").delete().eq("invoice_id", invoiceId);
    if (clearError) throw clearError;
    if (rows.length === 0) return;

    const { error } = await supabase.from("invoice_items").insert(
      rows.map((row: any) => ({
        invoice_id: invoiceId,
        kind: row.kind ?? "part",
        description: row.description,
        qty: Number(row.qty || 0),
        unit_price: Number(row.unit_price || 0),
      })),
    );
    if (error) throw error;
  };

  const syncJobDocuments = async (jobSnapshot: Job, rows: any[], subtotal: number, total: number, amountPaidValue: number) => {
    const trackedKinds: DocumentKind[] = ["quotation", "deposit_invoice", "invoice", "receipt"];
    const { data: existingDocs, error: existingError } = await supabase
      .from("invoices")
      .select("id, doc_type")
      .eq("job_id", jobSnapshot.id)
      .in("doc_type", trackedKinds);
    if (existingError) throw existingError;

    const existingByKind = new Map(
      (existingDocs ?? []).map((row: any) => [row.doc_type as DocumentKind, row.id as string]),
    );
    const keepKinds = new Set<DocumentKind>();
    const fallbackRows = rows.length > 0
      ? rows
      : [{
          kind: "labour",
          description: `${jobSnapshot.service_type ?? "Service"} - ${reportedProblem || (jobSnapshot.complaint ?? "Workshop services")}`,
          qty: 1,
          unit_price: subtotal || Number(jobSnapshot.estimate || 0),
        }];
    const receiptCaptured = Math.max(0, amountPaidValue - depositPaidValue);

    const documents: Array<{ kind: DocumentKind; payload: Record<string, any>; items: any[] }> = [];
    if (canQuotation || subtotal > 0 || total > 0) {
      documents.push({
        kind: "quotation",
        payload: {
          invoice_no: getDocumentNumber(jobSnapshot.job_no, "quotation"),
          plate: jobSnapshot.plate,
          vehicle_id: (jobSnapshot as any).vehicle_id ?? null,
          client_id: (jobSnapshot as any).client_id ?? null,
          service_type: jobSnapshot.service_type ?? "service",
          parts_source: "job_card",
          time_in: jobSnapshot.started_at,
          time_out: null,
          date: String(jobSnapshot.started_at).slice(0, 10),
          amount: total,
          discount,
          discount_by: discountReason || null,
          amount_paid: 0,
          technicians: jobSnapshot.mechanic ?? null,
          customer_phone: jobSnapshot.customer_phone ?? null,
          status: canQuotation ? "issued" : "draft",
          notes: reportedProblem || jobSnapshot.complaint || null,
          job_id: jobSnapshot.id,
          doc_type: "quotation",
          payer_type: payerType,
          payer_name: payerLabel || null,
        },
        items: fallbackRows,
      });
    }
    if (depositRequiredValue > 0) {
      documents.push({
        kind: "deposit_invoice",
        payload: {
          invoice_no: getDocumentNumber(jobSnapshot.job_no, "deposit_invoice"),
          plate: jobSnapshot.plate,
          vehicle_id: (jobSnapshot as any).vehicle_id ?? null,
          client_id: (jobSnapshot as any).client_id ?? null,
          service_type: jobSnapshot.service_type ?? "service",
          parts_source: "job_card",
          time_in: jobSnapshot.started_at,
          time_out: null,
          date: String(jobSnapshot.started_at).slice(0, 10),
          amount: depositRequiredValue,
          discount: 0,
          discount_by: null,
          amount_paid: depositPaidValue,
          technicians: jobSnapshot.mechanic ?? null,
          customer_phone: jobSnapshot.customer_phone ?? null,
          status: depositPaidValue >= depositRequiredValue && depositRequiredValue > 0 ? "paid" : "issued",
          notes: "Deposit requested before work starts.",
          job_id: jobSnapshot.id,
          doc_type: "deposit_invoice",
          payer_type: payerType,
          payer_name: payerLabel || null,
          payment_mode: paymentMode,
          payment_reference: paymentReference || null,
        },
        items: [{
          kind: "labour",
          description: `Deposit for job ${jobSnapshot.job_no} - ${jobSnapshot.plate}`,
          qty: 1,
          unit_price: depositRequiredValue,
        }],
      });
    }
    if (subtotal > 0 || total > 0) {
      documents.push({
        kind: "invoice",
        payload: {
          invoice_no: getDocumentNumber(jobSnapshot.job_no, "invoice"),
          plate: jobSnapshot.plate,
          vehicle_id: (jobSnapshot as any).vehicle_id ?? null,
          client_id: (jobSnapshot as any).client_id ?? null,
          service_type: jobSnapshot.service_type ?? "service",
          parts_source: "job_card",
          time_in: jobSnapshot.started_at,
          time_out: jobSnapshot.completed_at ?? jobSnapshot.paid_at ?? null,
          date: String(jobSnapshot.completed_at ?? jobSnapshot.started_at).slice(0, 10),
          amount: total,
          discount,
          discount_by: discountReason || null,
          amount_paid: paymentBypass ? 0 : amountPaidValue,
          technicians: jobSnapshot.mechanic ?? null,
          customer_phone: jobSnapshot.customer_phone ?? null,
          status: paymentBypass ? "bypassed" : amountPaidValue >= total && total > 0 ? "paid" : canInvoice ? "issued" : "draft",
          notes: workPerformed || reportedProblem || jobSnapshot.complaint || null,
          job_id: jobSnapshot.id,
          doc_type: "invoice",
          payer_type: payerType,
          payer_name: payerLabel || null,
          payment_mode: paymentMode,
          payment_reference: paymentReference || null,
          is_payment_bypassed: paymentBypass,
          payment_bypass_reason: paymentBypass ? (paymentBypassReason || null) : null,
          payment_bypass_authorized_by: paymentBypass ? (paymentBypassAuthorizedBy || null) : null,
        },
        items: fallbackRows,
      });
    }
    if (!paymentBypass && (canReceipt || receiptCaptured > 0)) {
      documents.push({
        kind: "receipt",
        payload: {
          invoice_no: getDocumentNumber(jobSnapshot.job_no, "receipt"),
          plate: jobSnapshot.plate,
          vehicle_id: (jobSnapshot as any).vehicle_id ?? null,
          client_id: (jobSnapshot as any).client_id ?? null,
          service_type: jobSnapshot.service_type ?? "service",
          parts_source: "job_card",
          time_in: jobSnapshot.started_at,
          time_out: jobSnapshot.paid_at ?? jobSnapshot.completed_at ?? null,
          date: String(jobSnapshot.paid_at ?? new Date().toISOString()).slice(0, 10),
          amount: receiptCaptured || amountPaidValue,
          discount: 0,
          discount_by: null,
          amount_paid: receiptCaptured || amountPaidValue,
          technicians: jobSnapshot.mechanic ?? null,
          customer_phone: jobSnapshot.customer_phone ?? null,
          status: "paid",
          notes: "Customer payment received.",
          job_id: jobSnapshot.id,
          doc_type: "receipt",
          payer_type: payerType,
          payer_name: payerLabel || null,
          payment_mode: paymentMode,
          payment_reference: paymentReference || null,
        },
        items: fallbackRows,
      });
    }

    for (const document of documents) {
      keepKinds.add(document.kind);
      const { data, error } = await supabase
        .from("invoices")
        .upsert(document.payload, { onConflict: "job_id,doc_type" })
        .select("id")
        .single();
      if (error) throw error;
      const invoiceId = data.id ?? existingByKind.get(document.kind) ?? null;
      if (invoiceId) await syncInvoiceItems(invoiceId, document.items);
    }

    const staleIds = (existingDocs ?? [])
      .filter((row: any) => !keepKinds.has(row.doc_type as DocumentKind))
      .map((row: any) => row.id as string);
    if (staleIds.length > 0) {
      const { error: deleteItemsError } = await supabase.from("invoice_items").delete().in("invoice_id", staleIds);
      if (deleteItemsError) throw deleteItemsError;
      const { error: deleteDocsError } = await supabase.from("invoices").delete().in("id", staleIds);
      if (deleteDocsError) throw deleteDocsError;
    }
  };

  const persistFinancialSnapshotNow = async ({
    rows = lineItems,
    amountPaidValue = Math.max(0, Number(amountPaid || 0)),
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
      deposit_required: depositRequiredValue,
      deposit_paid: depositPaidValue,
      payer_type: payerType,
      payer_name: payerLabel || null,
      payment_bypass: paymentBypass,
      payment_bypass_reason: paymentBypass ? (paymentBypassReason || null) : null,
      payment_bypass_authorized_by: paymentBypass ? (paymentBypassAuthorizedBy || null) : null,
      ...extraJobPatch,
    };

    const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
    if (error) {
      toast.error(friendlyErrorMessage(error, "Could not save the job changes."));
      return null;
    }

    const snapshot = { ...job, ...patch } as Job;
    setJob(snapshot);
    try {
      await syncPartLineSales(snapshot, rows);
      await syncJobDocuments(snapshot, rows, subtotal, total, Math.max(0, Number(amountPaidValue || 0)));
    } catch (e: any) {
      toast.error(friendlyErrorMessage(e, "Saved the job, but document sync failed."));
    }

    if (!silent) toast.success("Saved");
    return snapshot;
  };

  const persistFinancialSnapshot = async (options: {
    rows?: any[];
    amountPaidValue?: number;
    extraJobPatch?: Record<string, any>;
    silent?: boolean;
  } = {}) => {
    const run = financialSyncQueueRef.current
      .catch(() => undefined)
      .then(() => persistFinancialSnapshotNow(options));

    financialSyncQueueRef.current = run.then(() => undefined, () => undefined);
    return run;
  };

  const saveFinancialMeta = async () => {
    const saved = await persistFinancialSnapshot({ silent: false });
    if (saved) load();
  };

  const markPaid = async () => {
    if (!canInvoice) { toast.error("Mark the job complete before recording payment"); return; }
    const now = new Date().toISOString();
    if (paymentBypass) {
      if (!paymentBypassReason.trim() || !paymentBypassAuthorizedBy.trim()) {
        toast.error("Add the bypass reason and who authorized it");
        return;
      }
    } else if (totalPaidValue < lineTotal) {
      toast.error("Total paid so far is less than the job total");
      return;
    }
    const receiptWindow = paymentBypass ? null : reserveDocumentWindow();
    const gatePassWindow = reserveDocumentWindow();
    const snapshot = await persistFinancialSnapshot({
      amountPaidValue: totalPaidValue,
      extraJobPatch: {
        status: "closed",
        paid_at: paymentBypass ? job.paid_at : now,
        closed_at: now,
        gate_pass_issued: true,
      },
      silent: true,
    });
    if (!snapshot) {
      closeReservedDocumentWindow(receiptWindow);
      closeReservedDocumentWindow(gatePassWindow);
      return;
    }
    try {
      const gatePass = await ensureGatePass(jobId);
      // Trigger PDFs in parallel — receipt and gate pass
      if (paymentBypass) {
        await openGatePassPdf(snapshot, gatePass, totalPaidValue, gatePassWindow);
        toast.success("Payment bypass saved and gate pass link opened");
      } else {
        await Promise.all([
          openInvoiceDocumentForJob("receipt", receiptWindow),
          openGatePassPdf(snapshot, gatePass, totalPaidValue, gatePassWindow),
        ]);
        toast.success("Paid and receipt/gate pass links opened");
      }
      load();
    } catch (e: any) {
      closeReservedDocumentWindow(receiptWindow);
      closeReservedDocumentWindow(gatePassWindow);
      toast.error(e?.message ?? "Payment was saved, but document links could not be opened");
    }
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

  const buildStatusPatch = (current: JobStatus, next: JobStatus) => {
    const patch: Record<string, any> = { status: next };
    if (next === "completed") patch.completed_at = new Date().toISOString();
    else if (STATUS_ORDER[next] < STATUS_ORDER.completed && STATUS_ORDER[current] >= STATUS_ORDER.completed) patch.completed_at = null;
    if (next === "closed") patch.closed_at = new Date().toISOString();
    else if (current === "closed") patch.closed_at = null;
    return patch;
  };

  const changeStatus = async (next: JobStatus) => {
    const isOverrideMove = statusOverride && !allowedNext.includes(next);
    const movingBackward = STATUS_ORDER[next] < STATUS_ORDER[job.status];

    if (isOverrideMove) {
      let prompt = `Override this job from ${STATUS_LABEL[job.status]} to ${STATUS_LABEL[next]}?`;
      if (movingBackward && next === "diagnosed") {
        prompt += "\n\nThis will discard issued parts, clear linked documents, and return the job to a true diagnosed state.";
      } else if (movingBackward && next === "diagnosis") {
        prompt += "\n\nThis will discard issued parts, delete diagnosis work, clear linked documents, and reset the job to a fresh awaiting-diagnosis state.";
      } else {
        prompt += "\n\nUse this only if you want to bypass the normal workflow for this car.";
      }
      if (!window.confirm(prompt)) return;
    }

    setSavingStatus(true);
    try {
      if (isOverrideMove && movingBackward && (next === "diagnosed" || next === "diagnosis")) {
        const { error } = await (supabase as any).rpc("rollback_job_to_status", {
          _job_id: jobId,
          _target_status: next,
        });
        if (error) throw error;
      } else {
        const patch = buildStatusPatch(job.status, next);
        const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
        if (error) throw error;
      }
      toast.success(`Moved to ${STATUS_LABEL[next]}`);
      setStatusOverride(false);
      load();
    } catch (error: any) {
      toast.error(friendlyErrorMessage(error, "Could not change the job status."));
    } finally {
      setSavingStatus(false);
    }
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
              {job.return_visit_type && (
                <p className="text-xs mt-1">
                  Return type: <strong>{job.return_visit_type.replaceAll("_", " ")}</strong>
                </p>
              )}
              {job.return_visit_notes && (
                <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{job.return_visit_notes}</p>
              )}
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
              {job.return_visit_type && (
                <Badge variant="secondary" className="capitalize">
                  <History className="h-3 w-3 mr-1" />
                  {job.return_visit_type.replaceAll("_", " ")}
                </Badge>
              )}
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
            <p className="text-xs text-muted-foreground">{DOCUMENT_LABELS[currentStage]}</p>
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
            {(leadSourceLabel || canSeeFinances) && (
              <div className="rounded-md border bg-muted/20 p-3 text-sm">
                <p className="font-semibold mb-2">Intake and billing</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {leadSourceLabel && (
                    <p><span className="text-muted-foreground">How client came to us:</span> {leadSourceLabel}{job.lead_source_detail ? ` - ${job.lead_source_detail}` : ""}</p>
                  )}
                  {canSeeFinances && (
                    <p><span className="text-muted-foreground">Payer:</span> {payerLabel || "Not set"} ({payerType})</p>
                  )}
                  {canSeeFinances && (
                    <p><span className="text-muted-foreground">Deposit:</span> KSh {depositPaidValue.toLocaleString()} / {depositRequiredValue.toLocaleString()}</p>
                  )}
                  {canSeeFinances && paymentBypass && (
                    <p><span className="text-muted-foreground">Payment bypass:</span> {paymentBypassReason || "Reason not set"}{paymentBypassAuthorizedBy ? ` - ${paymentBypassAuthorizedBy}` : ""}</p>
                  )}
                </div>
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
                    <div key={m.id ?? i} className="flex items-center justify-between gap-3 rounded bg-muted/40 p-2">
                      <span>{m.parts?.name ?? "—"} ×{m.qty}</span>
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-xs">{m.type}</span>
                        {canManageJob && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => removeIssuedPart(m)}
                            title="Remove issued part"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
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
            {canSeePrivateJobPhotos && jobPhotos.length > 0 && (
              <Card className="p-5">
                <h3 className="font-semibold flex items-center gap-2 mb-3"><ClipboardList className="h-4 w-4 text-primary" />Private intake photos</h3>
                <div className="grid grid-cols-2 gap-3">
                  {jobPhotos.map((photo, index) => (
                    <div key={`${photo.kind}-${index}`} className="space-y-1">
                      <img src={photo.url} alt={photo.kind} className="h-24 w-full rounded-md border object-cover" />
                      <p className="text-[11px] capitalize text-muted-foreground">{JOB_CARD_PHOTO_LABELS[photo.kind as JobCardPhotoKind] ?? photo.kind.replaceAll("_", " ")}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}
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
                <Input type="number" value={discountAmt} onChange={(e) => setDiscountAmt(e.target.value)} />
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

          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold mb-1 flex items-center gap-2"><Receipt className="h-4 w-4 text-primary" />Billing details</h3>
                <p className="text-[11px] text-muted-foreground">Track deposits first, decide who is paying, and keep the document sync up to date.</p>
              </div>
              <Button variant="outline" onClick={saveFinancialMeta}>Save billing details</Button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label className="text-xs">Payer</Label>
                <Select value={payerType} onValueChange={(value) => setPayerType(value as "client" | "insurance")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="client">Client</SelectItem>
                    <SelectItem value="insurance">Insurance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="lg:col-span-2">
                <Label className="text-xs">{payerType === "insurance" ? "Insurance name" : "Invoice name"}</Label>
                <Input
                  value={payerName}
                  onChange={(e) => setPayerName(e.target.value)}
                  placeholder={payerType === "insurance" ? (job.insurance_company ?? "Insurance company") : (job.customer_name ?? "Client name")}
                />
              </div>
              <div>
                <Label className="text-xs">Payment reference</Label>
                <Input value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="M-Pesa code / bank ref" />
              </div>
              <div>
                <Label className="text-xs">Deposit required (KSh)</Label>
                <Input type="number" value={depositRequired} onChange={(e) => setDepositRequired(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Deposit paid (KSh)</Label>
                <Input type="number" value={depositPaid} onChange={(e) => setDepositPaid(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Total paid so far (KSh)</Label>
                <Input type="number" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Payment mode</Label>
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
            </div>

            <div className="mt-4 grid gap-3 text-sm md:grid-cols-4">
              <div className="rounded-md bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Deposit outstanding</p><p className="font-bold">KSh {Math.max(0, depositRequiredValue - depositPaidValue).toLocaleString()}</p></div>
              <div className="rounded-md bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Collected so far</p><p className="font-bold">KSh {totalPaidValue.toLocaleString()}</p></div>
              <div className="rounded-md bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Balance due</p><p className="font-bold">KSh {Math.max(0, lineTotal - totalPaidValue).toLocaleString()}</p></div>
              <div className="rounded-md bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Payer on documents</p><p className="font-bold">{payerLabel || "Not set"}</p></div>
            </div>

            <div className="mt-4 rounded-lg border p-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={paymentBypass}
                  onChange={(e) => setPaymentBypass(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                Bypass payment requirement
              </label>
              <p className="mt-1 text-[11px] text-muted-foreground">This is visible inside the system only. It is never printed on the quotation, invoice, receipt, or job card PDFs.</p>
              {paymentBypass && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <Label className="text-xs">Reason for bypass</Label>
                    <Input value={paymentBypassReason} onChange={(e) => setPaymentBypassReason(e.target.value)} placeholder="Waiver / authorised release / special case" />
                  </div>
                  <div>
                    <Label className="text-xs">Authorised by</Label>
                    <Input value={paymentBypassAuthorizedBy} onChange={(e) => setPaymentBypassAuthorizedBy(e.target.value)} placeholder="Manager / director / insurer" />
                  </div>
                </div>
              )}
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
                  <Label className="text-xs">Total paid so far (KSh)</Label>
                  <Input type="number" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} />
                </div>
                <div className="flex items-end">
                  <Button className="w-full bg-gradient-primary" onClick={markPaid} disabled={!paymentBypass && totalPaidValue < lineTotal}>
                    <CheckCircle2 className="h-4 w-4 mr-2" />{paymentBypass ? "Close with bypass" : "Mark paid &amp; close"}
                  </Button>
                </div>
              </div>
              {!paymentBypass && totalPaidValue < lineTotal && (
                <p className="text-xs text-muted-foreground mt-2">Enter the full amount paid so far, including any deposit, before closing the job.</p>
              )}
              {paymentBypass && (
                <p className="text-xs text-muted-foreground mt-2">A bypass needs both a reason and an authorised-by name before the job can close.</p>
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
                onDownload={() => openStoredDocumentCard((target) => openInvoiceDocumentForJob("quotation", target))}
              />
              <DocCard
                title="Deposit invoice"
                icon={<DollarSign className="h-4 w-4" />}
                enabled={canDepositInvoice}
                lockedReason="Set a deposit amount to unlock this document."
                active={currentStage === "deposit_invoice"}
                onDownload={() => openStoredDocumentCard((target) => openInvoiceDocumentForJob("deposit_invoice", target))}
              />
              <DocCard
                title="Invoice"
                icon={<FileText className="h-4 w-4" />}
                enabled={canInvoice}
                lockedReason="Unlocks when the job is marked complete (after customer approval)."
                active={currentStage === "invoice"}
                onDownload={() => openStoredDocumentCard((target) => openInvoiceDocumentForJob("invoice", target))}
              />
              <DocCard
                title="Receipt"
                icon={<Receipt className="h-4 w-4" />}
                enabled={canReceipt}
                lockedReason="Unlocks once the customer has paid in full."
                active={currentStage === "receipt"}
                onDownload={() => openStoredDocumentCard((target) => openInvoiceDocumentForJob("receipt", target))}
              />
              <DocCard
                title="Job card"
                icon={<ClipboardList className="h-4 w-4" />}
                enabled={true}
                active={false}
                onDownload={() => openStoredDocumentCard((target) => openJobCardDocument(target))}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              {invoicesForJob.length} saved document{invoicesForJob.length === 1 ? "" : "s"} on file. Manage quotations, deposit invoices, invoices, and receipts from the <strong>Invoices</strong> page.
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
  const [descriptionDraft, setDescriptionDraft] = useState(line.description ?? "");
  const [qtyDraft, setQtyDraft] = useState(String(line.qty ?? 0));
  const [unitPriceDraft, setUnitPriceDraft] = useState(String(line.unit_price ?? 0));
  const isLabour = line.kind === "labour";
  const filtered = useMemo(() => {
    if (isLabour) return [];
    const q = search.trim().toLowerCase();
    if (!q) return parts.slice(0, 8);
    return parts.filter((p) =>
      p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q)
    ).slice(0, 8);
  }, [search, parts, isLabour]);

  useEffect(() => {
    setDescriptionDraft(line.description ?? "");
  }, [line.id, line.description]);

  useEffect(() => {
    setQtyDraft(String(line.qty ?? 0));
  }, [line.id, line.qty]);

  useEffect(() => {
    setUnitPriceDraft(String(line.unit_price ?? 0));
  }, [line.id, line.unit_price]);

  const inStock = line.part_id ? (stock[line.part_id] ?? 0) > 0 : null;
  const lineTotal = parseLineNumberInput(qtyDraft) * parseLineNumberInput(unitPriceDraft);

  const commitDescription = () => {
    if (descriptionDraft !== (line.description ?? "")) onUpdate({ description: descriptionDraft });
  };

  const commitQty = () => {
    const nextQty = parseLineNumberInput(qtyDraft);
    setQtyDraft(String(nextQty));
    if (nextQty !== Number(line.qty || 0)) onUpdate({ qty: nextQty });
  };

  const commitUnitPrice = () => {
    const nextUnitPrice = parseLineNumberInput(unitPriceDraft);
    setUnitPriceDraft(String(nextUnitPrice));
    if (nextUnitPrice !== Number(line.unit_price || 0)) onUpdate({ unit_price: nextUnitPrice });
  };

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
          value={descriptionDraft}
          onChange={(e) => setDescriptionDraft(e.target.value)}
          onBlur={commitDescription}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <Input
          className="col-span-2 h-8 text-sm" type="number" min={0} step={1}
          value={qtyDraft}
          onChange={(e) => setQtyDraft(e.target.value)}
          onBlur={commitQty}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          placeholder="Qty"
        />
        <Input
          className="col-span-3 h-8 text-sm" type="number" min={0}
          value={unitPriceDraft}
          onChange={(e) => setUnitPriceDraft(e.target.value)}
          onBlur={commitUnitPrice}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
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
        Open PDF
      </Button>
    </div>
  );
}

