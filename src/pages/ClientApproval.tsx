import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Star, CheckCircle2, Wrench, Loader2, Stethoscope, Package, ShieldCheck, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type FeedbackJob = {
  id: string;
  job_no: string;
  plate: string;
  vehicle_label: string | null;
  customer_name: string | null;
  reported_problem: string | null;
  work_performed: string | null;
  status: string;
  invoice_amount: number;
  client_approved_at: string | null;
  client_rating: number | null;
  ai_diagnostic_summary: string | null;
  recommended_parts: Array<{ name: string; qty: number; reason?: string; severity?: string }> | null;
  estimate: number | null;
  diagnosis_approved_at: string | null;
  diagnosis_approval_code: string | null;
};

export default function ClientApproval() {
  const { token } = useParams<{ token: string }>();
  const [job, setJob] = useState<FeedbackJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    // Disable copy / right-click / print on this view-only page
    const block = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", block);
    document.addEventListener("copy", block);
    document.addEventListener("cut", block);
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === "p" || k === "s" || k === "c")) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    (async () => {
      const { data, error } = await supabase.rpc("get_job_for_feedback", { _token: token });
      if (error) { toast.error(error.message); }
      const row = (data as any[])?.[0] ?? null;
      setJob(row);
      if (row?.client_approved_at) setDone(true);
      setLoading(false);
    })();
    return () => {
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("copy", block);
      document.removeEventListener("cut", block);
      window.removeEventListener("keydown", onKey);
    };
  }, [token]);

  const submit = async () => {
    if (!token) return;
    setSubmitting(true);
    const isDiagnosisStage = job?.status === "diagnosis_approval";
    const rpc = isDiagnosisStage ? "submit_diagnosis_approval" : "submit_client_feedback";
    const { data, error } = await supabase.rpc(rpc as any, {
      _token: token, _rating: rating, _comment: comment,
    });
    setSubmitting(false);
    if (error || !data) { toast.error(error?.message ?? "Failed"); return; }
    toast.success(isDiagnosisStage ? "Diagnosis approved — thank you!" : "Thank you for your feedback!");
    setDone(true);
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );

  if (!job) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="p-8 max-w-md text-center">
        <h1 className="text-xl font-bold">Link not found</h1>
        <p className="text-sm text-muted-foreground mt-2">This approval link is invalid or has expired.</p>
      </Card>
    </div>
  );

  const isDiagnosisStage = job.status === "diagnosis_approval";
  const recParts = job.recommended_parts ?? [];
  const partsTotal = recParts.reduce((s, p: any) => s + (Number(p.qty || 1) * Number(p.estimated_price || 0)), 0);
  const approvalTotal = Number(job.invoice_amount || job.estimate || 0);

  return (
    <div
      className="min-h-screen bg-gradient-to-b from-muted/30 to-background flex items-start justify-center p-4 select-none print:hidden"
      style={{ WebkitUserSelect: "none", userSelect: "none" }}
    >
      <style>{`@media print { body { display: none !important; } }`}</style>
      <Card className="p-6 max-w-2xl w-full space-y-5 shadow-lg my-6 relative overflow-hidden">
        {/* watermark */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center -rotate-12 opacity-[0.04] text-6xl font-black tracking-widest">
          GOLDEN · CLIENT COPY
        </div>
        <div className="text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-gradient-primary text-primary-foreground mb-2">
            <Wrench className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold">Golden Automotive Solutions</h1>
          <p className="text-xs text-muted-foreground">
            {isDiagnosisStage ? "Diagnosis & Quotation — Client Approval" : "Customer approval & feedback"}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">View-only · this page cannot be printed or downloaded</p>
        </div>

        <div className="rounded-lg border bg-muted/30 p-4 space-y-1.5 text-sm relative z-10">
          <p><span className="text-muted-foreground">Job: </span><span className="font-mono font-bold text-primary">{job.job_no}</span></p>
          <p><span className="text-muted-foreground">Vehicle: </span><span className="font-semibold">{job.plate}</span> {job.vehicle_label ? `· ${job.vehicle_label}` : ""}</p>
          {job.customer_name && <p><span className="text-muted-foreground">Customer: </span>{job.customer_name}</p>}
          {job.reported_problem && (
            <div className="pt-2"><p className="text-muted-foreground text-xs">Reported problem</p><p>{job.reported_problem}</p></div>
          )}
          {!isDiagnosisStage && job.work_performed && (
            <div className="pt-2"><p className="text-muted-foreground text-xs">Work performed</p><p className="whitespace-pre-wrap">{job.work_performed}</p></div>
          )}
          {isDiagnosisStage && job.ai_diagnostic_summary && (
            <div className="pt-2">
              <p className="text-muted-foreground text-xs flex items-center gap-1"><Stethoscope className="h-3 w-3" />Our diagnosis</p>
              <p className="whitespace-pre-wrap leading-snug">{job.ai_diagnostic_summary}</p>
            </div>
          )}
          {isDiagnosisStage && recParts.length > 0 && (
            <div className="pt-2">
              <p className="text-muted-foreground text-xs flex items-center gap-1"><Package className="h-3 w-3" />Recommended parts</p>
              <ul className="list-disc list-inside space-y-0.5">
                {recParts.map((p, i) => (
                  <li key={i}><span className="font-medium">{p.name}</span> ×{p.qty}{p.reason ? <span className="text-muted-foreground"> — {p.reason}</span> : null}</li>
                ))}
              </ul>
            </div>
          )}
          {isDiagnosisStage ? (
            Number(job.estimate || 0) > 0 && (
              <p className="pt-2 text-base"><span className="text-muted-foreground text-xs">Quotation total: </span><span className="font-bold text-primary">KSh {Number(job.estimate || 0).toLocaleString()}</span></p>
            )
          ) : (
            <p className="pt-2 text-base"><span className="text-muted-foreground text-xs">Total: </span><span className="font-bold">KSh {approvalTotal.toLocaleString()}</span></p>
          )}
        </div>

        {isDiagnosisStage && job.diagnosis_approval_code && !done && (
          <div className="rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 p-4 text-center relative z-10">
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <KeyRound className="h-3 w-3" />Read this code to our team to approve
            </p>
            <p className="font-mono text-3xl font-black tracking-[0.4em] text-primary mt-1">
              {job.diagnosis_approval_code}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">Or simply tap "Approve" below.</p>
          </div>
        )}

        {done ? (
          <div className="text-center py-4 relative z-10">
            <CheckCircle2 className="h-12 w-12 text-success mx-auto mb-2" />
            <p className="font-semibold">Thank you!</p>
            <p className="text-sm text-muted-foreground">
              {isDiagnosisStage ? "Approval received — the garage will start sourcing your parts." : "Your feedback was received. The garage will be in touch."}
            </p>
          </div>
        ) : (
          <div className="relative z-10 space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-semibold">
                {isDiagnosisStage ? "How clear was our diagnosis?" : "How would you rate the work?"}
              </p>
              <div className="flex justify-center gap-2">
                {[1,2,3,4,5].map(n => (
                  <button key={n} type="button" onClick={() => setRating(n)}
                    className="transition-transform hover:scale-110">
                    <Star className={`h-8 w-8 ${n <= rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold mb-1">Any comments? (optional)</p>
              <Textarea rows={3} value={comment} onChange={e => setComment(e.target.value)}
                placeholder={isDiagnosisStage ? "Any concerns about the diagnosis or parts?" : "Was everything done well? Anything we can improve?"} />
            </div>
            <Button className="w-full bg-gradient-primary" onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
              {isDiagnosisStage ? "Approve diagnosis & proceed" : "Approve & submit feedback"}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
