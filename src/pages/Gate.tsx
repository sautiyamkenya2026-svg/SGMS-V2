import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, ShieldCheck, ShieldAlert, Plus, CheckCircle2, XCircle, DoorOpen, RotateCcw, Clock, AlertTriangle, BellRing } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

type Job = { id: string; job_no: string; plate: string; status: string; gate_pass_issued: boolean; customer_name: string | null };
type GPR = {
  id: string; job_id: string | null; plate: string | null; reason: string; reason_detail: string | null;
  destination: string | null; status: string; expected_return: string | null;
  created_at: string; approved_at: string | null; released_at: string | null; returned_at: string | null;
  is_final_release?: boolean; late_notified_at?: string | null; arrived_early_at?: string | null;
};

const REASONS = [
  { v: "roadtest", l: "Road test" },
  { v: "external_repair", l: "External repair (we lack capacity)" },
  { v: "paint_run", l: "Paint pickup / no paint in store" },
  { v: "parts_pickup", l: "Parts pickup" },
  { v: "final_release", l: "Final release to client" },
  { v: "other", l: "Other" },
];

export default function Gate() {
  const { user, hasRole } = useAuth();
  const isGateman = hasRole("gateman");
  const canApprove = hasRole("admin") || hasRole("reception") || hasRole("super_admin");
  const [search, setSearch] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [reqs, setReqs] = useState<GPR[]>([]);
  const [allReqs, setAllReqs] = useState<GPR[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ reason: "roadtest", reason_detail: "", destination: "", expected_return: "" });
  const isFinalRelease = form.reason === "final_release";

  const loadAll = async () => {
    const { data } = await supabase.from("gate_pass_requests").select("*").order("created_at", { ascending: false }).limit(50);
    setAllReqs((data ?? []) as GPR[]);
  };
  useEffect(() => { loadAll(); }, []);

  const lookup = async () => {
    const q = search.trim().toUpperCase();
    if (!q) return;
    const { data: j } = await supabase.from("jobs").select("*").or(`job_no.eq.${q},plate.eq.${q}`).maybeSingle();
    if (!j) { setJob(null); setReqs([]); toast({ title: "Not found", description: "No job matches that number or plate.", variant: "destructive" }); return; }
    setJob(j as Job);
    const { data: rs } = await supabase.from("gate_pass_requests").select("*").eq("job_id", j.id).order("created_at", { ascending: false });
    setReqs((rs ?? []) as GPR[]);
  };

  const submitReq = async () => {
    if (!job) return;
    const { error } = await supabase.from("gate_pass_requests").insert({
      job_id: job.id, plate: job.plate,
      reason: form.reason, reason_detail: form.reason_detail || null,
      destination: form.destination || null,
      // Final release = car will not return; do not store an expected_return.
      expected_return: form.reason === "final_release"
        ? null
        : (form.expected_return ? new Date(form.expected_return).toISOString() : null),
      is_final_release: form.reason === "final_release",
      requested_by: user?.id ?? null,
    });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Release request submitted" });
    setOpen(false);
    setForm({ reason: "roadtest", reason_detail: "", destination: "", expected_return: "" });
    lookup();
    loadAll();
  };

  const setStatus = async (id: string, status: string) => {
    const patch: any = { status };
    if (status === "approved") { patch.approved_by = user?.id ?? null; patch.approved_at = new Date().toISOString(); }
    if (status === "released") { patch.released_by = user?.id ?? null; patch.released_at = new Date().toISOString(); }
    if (status === "returned") patch.returned_at = new Date().toISOString();
    const { error } = await supabase.from("gate_pass_requests").update(patch).eq("id", id);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Marked ${status}` });
    lookup(); loadAll();
  };

  const markEarlyArrival = async (r: GPR) => {
    const { error } = await supabase.from("gate_pass_requests").update({
      status: "returned",
      returned_at: new Date().toISOString(),
      arrived_early_at: new Date().toISOString(),
    }).eq("id", r.id);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Marked arrived early ✓" });
    lookup(); loadAll();
  };

  const markNotYetBack = async (r: GPR) => {
    const { error } = await supabase.from("gate_pass_requests").update({
      late_notified_at: new Date().toISOString(),
    }).eq("id", r.id);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Reminder logged", description: "Reception, admin and (where wired) the client have been notified." });
    lookup(); loadAll();
  };

  const isOverdue = (r: GPR) =>
    r.status === "released" && !r.is_final_release && r.expected_return && new Date(r.expected_return) < new Date();

  const activeApproved = reqs.find(r => r.status === "approved" || r.status === "released");
  const releaseTag = job ? (
    activeApproved
      ? <Badge className="bg-success text-success-foreground text-base px-4 py-1.5"><ShieldCheck className="h-4 w-4 mr-2" />CLEARED TO LEAVE</Badge>
      : job.gate_pass_issued
      ? <Badge className="bg-success text-success-foreground text-base px-4 py-1.5"><ShieldCheck className="h-4 w-4 mr-2" />FINAL GATE PASS — RELEASE</Badge>
      : <Badge className="bg-destructive text-destructive-foreground text-base px-4 py-1.5"><ShieldAlert className="h-4 w-4 mr-2" />DO NOT RELEASE</Badge>
  ) : null;

  const reasonLabel = (r: string) => REASONS.find(x => x.v === r)?.l ?? r;
  const badge = (s: string) => {
    if (s === "pending") return <Badge variant="secondary">Pending</Badge>;
    if (s === "approved") return <Badge className="bg-status-diagnosed text-primary-foreground">Approved</Badge>;
    if (s === "released") return <Badge className="bg-gradient-primary text-primary-foreground">Released</Badge>;
    if (s === "returned") return <Badge className="bg-success text-success-foreground">Returned</Badge>;
    if (s === "rejected") return <Badge className="bg-destructive text-destructive-foreground">Rejected</Badge>;
    return <Badge>{s}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Gate Control</h1>
        <p className="text-sm text-muted-foreground">Search a job# or plate. Verify release authorisation before opening the gate.</p>
      </div>

      <Card className="p-5">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9 text-lg h-12" placeholder="JOB-0042 or KCA 123A"
              value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === "Enter" && lookup()} />
          </div>
          <Button size="lg" onClick={lookup} className="bg-gradient-primary">Verify</Button>
        </div>

        {job && (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <div>
                <p className="text-xs text-muted-foreground">Job</p>
                <p className="text-2xl font-bold">{job.plate} <span className="font-mono text-base text-primary ml-2">{job.job_no}</span></p>
                <p className="text-sm text-muted-foreground">{job.customer_name ?? "—"} · status: <span className="capitalize">{job.status}</span></p>
              </div>
              {releaseTag}
            </div>

            {!isGateman && (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild><Button variant="outline"><Plus className="h-4 w-4 mr-2" />Request release</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Request to release {job.plate}</DialogTitle></DialogHeader>
                  <div className="grid gap-3 py-2">
                    <div>
                      <Label>Reason</Label>
                      <Select value={form.reason} onValueChange={v => setForm({ ...form, reason: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{REASONS.map(r => <SelectItem key={r.v} value={r.v}>{r.l}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div><Label>Detail</Label><Textarea rows={2} value={form.reason_detail} onChange={e => setForm({ ...form, reason_detail: e.target.value })} placeholder={isFinalRelease ? "Optional notes for the gateman" : "e.g. picking up paint at Jay Painters"} /></div>
                    <div className={isFinalRelease ? "" : "grid grid-cols-2 gap-3"}>
                      <div><Label>Destination</Label><Input value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} placeholder={isFinalRelease ? "Client pickup" : ""} /></div>
                      {!isFinalRelease && (
                        <div><Label>Expected return</Label><Input type="datetime-local" value={form.expected_return} onChange={e => setForm({ ...form, expected_return: e.target.value })} /></div>
                      )}
                    </div>
                    {isFinalRelease && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        ⓘ Final release — vehicle will not return. No follow-up reminder will be scheduled.
                      </p>
                    )}
                  </div>
                  <DialogFooter><Button onClick={submitReq} className="bg-gradient-primary">Submit</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            )}

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Release requests for this vehicle</h3>
              {reqs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No release requests yet.</p>
              ) : reqs.map(r => (
                <Card key={r.id} className="p-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium flex items-center gap-2">
                      {reasonLabel(r.reason)} {badge(r.status)}
                      {r.is_final_release && <Badge className="bg-amber-500 text-amber-950">Final release</Badge>}
                      {isOverdue(r) && <Badge className="bg-destructive text-destructive-foreground"><AlertTriangle className="h-3 w-3 mr-1" />Overdue</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.reason_detail ?? "—"} · dest: {r.destination ?? "—"}
                      {!r.is_final_release && r.expected_return && <> · expected back: {new Date(r.expected_return).toLocaleString("en-GB")}</>}
                      {r.arrived_early_at && <> · arrived early ✓</>}
                      {r.late_notified_at && <> · reminder sent</>}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {canApprove && r.status === "pending" && <>
                      <Button size="sm" variant="outline" onClick={() => setStatus(r.id, "approved")}><CheckCircle2 className="h-3 w-3 mr-1" />Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => setStatus(r.id, "rejected")}><XCircle className="h-3 w-3 mr-1" />Reject</Button>
                    </>}
                    {(isGateman || canApprove) && r.status === "approved" && <Button size="sm" className="bg-gradient-primary" onClick={() => setStatus(r.id, "released")}><DoorOpen className="h-3 w-3 mr-1" />Open gate</Button>}
                    {(isGateman || canApprove) && r.status === "released" && !r.is_final_release && <>
                      <Button size="sm" variant="outline" onClick={() => markEarlyArrival(r)}><Clock className="h-3 w-3 mr-1" />Arrived</Button>
                      <Button size="sm" variant="outline" onClick={() => setStatus(r.id, "returned")}><RotateCcw className="h-3 w-3 mr-1" />Returned</Button>
                      {isOverdue(r) && <Button size="sm" variant="outline" onClick={() => markNotYetBack(r)}><BellRing className="h-3 w-3 mr-1" />Not yet back</Button>}
                    </>}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card>
        <div className="p-4 border-b"><h3 className="font-semibold">Recent gate activity</h3></div>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground">
            <th className="p-3">When</th><th className="p-3">Plate</th><th className="p-3">Reason</th><th className="p-3">Status</th>
          </tr></thead>
          <tbody>
            {allReqs.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No activity.</td></tr>
              : allReqs.map(r => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="p-3 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("en-GB")}</td>
                  <td className="p-3 font-mono">{r.plate ?? "—"}</td>
                  <td className="p-3">{reasonLabel(r.reason)}</td>
                  <td className="p-3">{badge(r.status)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
