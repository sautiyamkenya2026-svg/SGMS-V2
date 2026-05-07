import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  CarFront,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Download,
  FileSignature,
  FileText,
  KeyRound,
  Loader2,
  Palette,
  Phone,
  Receipt,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  closeReservedDocumentWindow,
  openStoredDocumentUrl,
  reserveDocumentWindow,
  storeGatePassPdf,
  storeInvoiceDocumentPdf,
  storeJobCardPdf,
} from "@/lib/document-storage";
import { canonicalizeDocuments } from "@/lib/generated-records";
import { toast } from "sonner";

type DocumentKind = "quotation" | "deposit_invoice" | "invoice" | "receipt";

type PortalAccount = {
  plate: string;
  phone: string | null;
};

type PortalInvoiceItem = {
  description: string;
  qty: number;
  unit_price: number;
};

type PortalDocument = {
  id: string;
  job_id: string | null;
  invoice_no: string | null;
  doc_type: DocumentKind;
  amount: number;
  amount_paid: number;
  customer_phone: string | null;
  payment_mode: string;
  payer_name: string | null;
  date: string;
  created_at: string;
  updated_at: string;
  invoice_items?: PortalInvoiceItem[];
};

type PortalGatePass = {
  id: string;
  job_id: string;
  pass_no: string;
  issued_at: string;
};

type PortalJob = {
  id: string;
  job_no: string;
  plate: string;
  customer_name: string | null;
  customer_phone: string | null;
  vehicle_label: string | null;
  complaint: string | null;
  reported_problem: string | null;
  work_performed: string | null;
  status: string;
  estimate: number;
  invoice_amount: number;
  receipt_amount: number;
  started_at: string;
  completed_at: string | null;
  service_type: string | null;
  client_feedback_token: string | null;
  ai_diagnostic_summary: string | null;
  recommended_parts: Array<{ name: string; qty: number; reason?: string }> | null;
  fuel_type: string | null;
  vehicle_color: string | null;
  paint_color_code: string | null;
};

type PortalNotification = {
  id: string;
  title: string;
  body: string | null;
  kind: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

const DOC_LABELS: Record<DocumentKind, string> = {
  quotation: "Quotation",
  deposit_invoice: "Deposit invoice",
  invoice: "Invoice",
  receipt: "Receipt",
};

const STATUS_LABELS: Record<string, string> = {
  diagnosis: "Car admitted",
  diagnosed: "Diagnosed",
  diagnosis_approval: "Approve diagnosis",
  parts: "Parts sourcing",
  parts_approval: "Approve parts fitting",
  repair: "In repair",
  awaiting_approval: "Approve completed work",
  completed: "Invoice ready",
  closed: "Ready for pickup",
};

const fmtMoney = (value: number) => `KSh ${Number(value || 0).toLocaleString()}`;

function buildPdfData(job: PortalJob, doc: PortalDocument) {
  const lines = (doc.invoice_items ?? []).length > 0
    ? (doc.invoice_items ?? []).map((item) => ({
        description: item.description,
        qty: Number(item.qty || 0),
        unit_price: Number(item.unit_price || 0),
      }))
    : [{
        description: `${DOC_LABELS[doc.doc_type]} - ${job.work_performed ?? job.reported_problem ?? job.complaint ?? "Workshop services"}`,
        qty: 1,
        unit_price: Number(doc.amount || 0),
      }];

  return {
    doc_no: doc.invoice_no ?? undefined,
    date: doc.date,
    customer_name: doc.payer_name ?? job.customer_name ?? undefined,
    customer_phone: doc.customer_phone ?? job.customer_phone ?? undefined,
    plate: job.plate,
    job_no: job.job_no,
    lines,
    amount_paid: Number(doc.amount_paid || 0),
    notes: job.work_performed ?? job.reported_problem ?? job.complaint ?? undefined,
    served_by: undefined,
    vat: false,
  };
}

export default function ClientPortal() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<PortalAccount | null>(null);
  const [jobs, setJobs] = useState<PortalJob[]>([]);
  const [documents, setDocuments] = useState<PortalDocument[]>([]);
  const [gatePasses, setGatePasses] = useState<PortalGatePass[]>([]);
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);

  const load = async () => {
    setLoading(true);
    const [
      { data: accountRow, error: accountError },
      { data: jobRows, error: jobsError },
      { data: docRows, error: docsError },
      { data: gateRows, error: gateError },
      { data: notifRows, error: notifError },
    ] = await Promise.all([
      supabase.from("client_portal_accounts").select("plate, phone").maybeSingle(),
      supabase.from("jobs").select(`
        id,
        job_no,
        plate,
        customer_name,
        customer_phone,
        vehicle_label,
        complaint,
        reported_problem,
        work_performed,
        status,
        estimate,
        invoice_amount,
        receipt_amount,
        started_at,
        completed_at,
        service_type,
        client_feedback_token,
        ai_diagnostic_summary,
        recommended_parts,
        fuel_type,
        vehicle_color,
        paint_color_code
      `).order("created_at", { ascending: false }),
      supabase.from("invoices").select("*, invoice_items(*)").order("date", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("gate_passes").select("id, job_id, pass_no, issued_at").order("issued_at", { ascending: false }),
      supabase.from("notifications").select("id, title, body, kind, link, read_at, created_at").order("created_at", { ascending: false }).limit(30),
    ]);

    if (accountError || jobsError || docsError || gateError || notifError) {
      toast.error(
        accountError?.message
          ?? jobsError?.message
          ?? docsError?.message
          ?? gateError?.message
          ?? notifError?.message
          ?? "Could not load your portal.",
      );
      setLoading(false);
      return;
    }

    setAccount((accountRow as PortalAccount | null) ?? null);
    setJobs((jobRows ?? []) as PortalJob[]);
    setDocuments(canonicalizeDocuments((docRows ?? []) as PortalDocument[]));
    setGatePasses((gateRows ?? []) as PortalGatePass[]);
    setNotifications((notifRows ?? []) as PortalNotification[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const docsByJob = useMemo(() => {
    const map = new Map<string, PortalDocument[]>();
    for (const doc of documents) {
      if (!doc.job_id) continue;
      const rows = map.get(doc.job_id) ?? [];
      rows.push(doc);
      map.set(doc.job_id, rows);
    }
    return map;
  }, [documents]);

  const gateByJob = useMemo(() => {
    const map = new Map<string, PortalGatePass>();
    for (const gatePass of gatePasses) {
      if (!map.has(gatePass.job_id)) map.set(gatePass.job_id, gatePass);
    }
    return map;
  }, [gatePasses]);

  const unreadCount = notifications.filter((notification) => !notification.read_at).length;
  const activeJobs = jobs.filter((job) => !["completed", "closed"].includes(job.status)).length;
  const completedJobs = jobs.filter((job) => ["completed", "closed"].includes(job.status)).length;

  const markAllRead = async () => {
    const ids = notifications.filter((notification) => !notification.read_at).map((notification) => notification.id);
    if (!ids.length) return;
    const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
    if (error) {
      toast.error(error.message);
      return;
    }
    setNotifications((current) => current.map((notification) => ({
      ...notification,
      read_at: notification.read_at ?? new Date().toISOString(),
    })));
  };

  const openInvoicePdf = async (job: PortalJob, doc: PortalDocument) => {
    const target = reserveDocumentWindow();
    try {
      const stored = await storeInvoiceDocumentPdf({
        invoiceId: doc.id,
        kind: doc.doc_type,
        data: buildPdfData(job, doc),
        paymentMode: doc.payment_mode,
        receivedFrom: doc.payer_name ?? job.customer_name ?? undefined,
      });
      openStoredDocumentUrl(stored.url, target);
    } catch (error: any) {
      closeReservedDocumentWindow(target);
      toast.error(error?.message ?? "Could not open that document.");
    }
  };

  const openJobCard = async (job: PortalJob) => {
    const target = reserveDocumentWindow();
    try {
      const stored = await storeJobCardPdf({
        jobId: job.id,
        data: {
          job_no: job.job_no,
          customer_name: job.customer_name ?? "",
          customer_phone: job.customer_phone ?? "",
          plate: job.plate,
          vehicle: job.vehicle_label ?? "",
          customer_complaint: job.reported_problem ?? job.complaint ?? "",
          technician_diagnosis: job.work_performed ?? job.ai_diagnostic_summary ?? "",
          fuel_level: job.fuel_type ?? undefined,
          valuables: job.vehicle_color ?? undefined,
          paint_color_code: job.paint_color_code ?? undefined,
        },
      });
      openStoredDocumentUrl(stored.url, target);
    } catch (error: any) {
      closeReservedDocumentWindow(target);
      toast.error(error?.message ?? "Could not open the job card.");
    }
  };

  const openGatePass = async (job: PortalJob, gatePass: PortalGatePass) => {
    const target = reserveDocumentWindow();
    try {
      const stored = await storeGatePassPdf({
        gatePassId: gatePass.id,
        data: {
          pass_no: gatePass.pass_no,
          job_no: job.job_no,
          plate: job.plate,
          vehicle: job.vehicle_label ?? "",
          customer_name: job.customer_name ?? "",
          customer_phone: job.customer_phone ?? "",
          amount_paid: Number(job.receipt_amount || 0),
          total: Number(job.invoice_amount || job.estimate || 0),
          date: new Date(gatePass.issued_at).toLocaleString(),
        },
      });
      openStoredDocumentUrl(stored.url, target);
    } catch (error: any) {
      closeReservedDocumentWindow(target);
      toast.error(error?.message ?? "Could not open the gate pass.");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Client Portal</h1>
          <p className="text-sm text-muted-foreground">
            Track your vehicle, approve work, and download your documents in one place.
          </p>
        </div>
        <Card className="min-w-72 p-4">
          <p className="text-xs uppercase text-muted-foreground">Portal login</p>
          <p className="mt-1 font-mono text-lg font-bold">{account?.plate ?? "Not linked yet"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Username is your plate number. Password is your phone number on file.
          </p>
          {account?.phone && (
            <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              <Phone className="h-3 w-3" /> {account.phone}
            </p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
            <CarFront className="h-3.5 w-3.5" /> Active jobs
          </div>
          <p className="mt-1 text-2xl font-bold">{activeJobs}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5" /> Finished jobs
          </div>
          <p className="mt-1 text-2xl font-bold">{completedJobs}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
            <FileText className="h-3.5 w-3.5" /> Documents
          </div>
          <p className="mt-1 text-2xl font-bold">{documents.length}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
            <Bell className="h-3.5 w-3.5" /> Unread updates
          </div>
          <p className="mt-1 text-2xl font-bold">{unreadCount}</p>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">My vehicles and job cards</h2>
              <p className="text-xs text-muted-foreground">Live workshop progress, approvals, and downloadable documents.</p>
            </div>
          </div>

          {jobs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No job cards are linked to this portal account yet.</p>
          ) : (
            <div className="space-y-4">
              {jobs.map((job) => {
                const jobDocuments = docsByJob.get(job.id) ?? [];
                const gatePass = gateByJob.get(job.id) ?? null;
                const needsApproval = Boolean(job.client_feedback_token) && ["diagnosis_approval", "awaiting_approval"].includes(job.status);
                return (
                  <div key={job.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-sm font-bold text-primary">{job.job_no}</p>
                        <h3 className="mt-1 flex items-center gap-2 text-lg font-semibold">
                          <CarFront className="h-4 w-4" />
                          {job.plate}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {job.vehicle_label ?? "Vehicle on file"}
                        </p>
                      </div>
                      <Badge variant={job.status === "closed" ? "secondary" : "outline"}>
                        {STATUS_LABELS[job.status] ?? job.status}
                      </Badge>
                    </div>

                    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                      <div className="rounded-md bg-muted/40 p-3">
                        <p className="text-[11px] uppercase text-muted-foreground">Reported problem</p>
                        <p className="mt-1">{job.reported_problem ?? job.complaint ?? "Not recorded yet."}</p>
                      </div>
                      <div className="rounded-md bg-muted/40 p-3">
                        <p className="text-[11px] uppercase text-muted-foreground">Workshop update</p>
                        <p className="mt-1">{job.work_performed ?? job.ai_diagnostic_summary ?? "We will post progress here as the job moves."}</p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
                        <Clock3 className="h-3 w-3" />
                        Admitted {new Date(job.started_at).toLocaleString()}
                      </span>
                      {job.fuel_type && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
                          <Wrench className="h-3 w-3" />
                          {job.fuel_type}
                        </span>
                      )}
                      {job.vehicle_color && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
                          <Palette className="h-3 w-3" />
                          {job.vehicle_color}
                        </span>
                      )}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => openJobCard(job)}>
                        <ClipboardList className="mr-1 h-3.5 w-3.5" /> Job card
                      </Button>
                      {needsApproval && job.client_feedback_token && (
                        <Button size="sm" className="bg-gradient-primary" onClick={() => navigate(`/approve/${job.client_feedback_token}`)}>
                          <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                          {job.status === "diagnosis_approval" ? "Approve diagnosis" : "Approve completed work"}
                        </Button>
                      )}
                      {gatePass && (
                        <Button variant="outline" size="sm" onClick={() => openGatePass(job, gatePass)}>
                          <KeyRound className="mr-1 h-3.5 w-3.5" /> Gate pass
                        </Button>
                      )}
                    </div>

                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase text-muted-foreground">Documents</p>
                      {jobDocuments.length === 0 ? (
                        <p className="mt-2 text-sm text-muted-foreground">No documents are ready for this job yet.</p>
                      ) : (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {jobDocuments.map((doc) => (
                            <Button key={doc.id} variant="outline" size="sm" onClick={() => openInvoicePdf(job, doc)}>
                              {doc.doc_type === "quotation" && <FileSignature className="mr-1 h-3.5 w-3.5" />}
                              {doc.doc_type === "deposit_invoice" && <Receipt className="mr-1 h-3.5 w-3.5" />}
                              {doc.doc_type === "invoice" && <FileText className="mr-1 h-3.5 w-3.5" />}
                              {doc.doc_type === "receipt" && <Download className="mr-1 h-3.5 w-3.5" />}
                              {DOC_LABELS[doc.doc_type]}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Recent updates</h2>
              <p className="text-xs text-muted-foreground">Admission, approvals, invoices, and release notices.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={markAllRead}>
              Mark all read
            </Button>
          </div>

          {notifications.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No updates yet.</p>
          ) : (
            <div className="space-y-2">
              {notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => {
                    if (notification.link?.startsWith("/approve/")) navigate(notification.link);
                    else navigate("/client");
                  }}
                  className={`w-full rounded-lg border p-3 text-left transition hover:bg-muted/40 ${notification.read_at ? "opacity-75" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{notification.title}</p>
                      {notification.body && <p className="mt-1 text-sm text-muted-foreground">{notification.body}</p>}
                    </div>
                    {!notification.read_at && <Badge>New</Badge>}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">{new Date(notification.created_at).toLocaleString()}</p>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
