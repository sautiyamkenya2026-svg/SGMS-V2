import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { canSeePrices } from "@/lib/permissions";

type Req = {
  id: string; job_id: string | null; mechanic_name: string | null; kind: string;
  item_name: string; qty: number; notes: string | null; status: string;
  created_at: string; returned_at: string | null;
  source?: string | null; is_major?: boolean | null;
  ordered_at?: string | null; in_delivery_at?: string | null; delivered_at?: string | null;
  estimated_unit_price?: number | null;
};
type Job = { id: string; job_no: string; plate: string };

export default function Requests() {
  const { user, hasRole } = useAuth();
  const showPrice = canSeePrices(user as any);
  const canApprove = hasRole("admin") || hasRole("reception") || hasRole("storekeeper") || hasRole("super_admin") || hasRole("manager") || hasRole("director");
  const [rows, setRows] = useState<Req[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ job_id: "", kind: "part", item_name: "", qty: "1", notes: "", source: "in_house", estimated_unit_price: "0", is_major: false });

  const load = async () => {
    const [{ data: r }, { data: j }] = await Promise.all([
      supabase.from("part_requests").select("*").order("created_at", { ascending: false }),
      supabase.from("jobs").select("id, job_no, plate").in("status", ["diagnosis","diagnosed","diagnosis_approval","parts","parts_approval","repair","approval"]).order("created_at", { ascending: false }),
    ]);
    setRows((r ?? []) as Req[]);
    setJobs((j ?? []) as Job[]);
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.item_name.trim()) { toast({ title: "Item name required", variant: "destructive" }); return; }
    const { error } = await supabase.from("part_requests").insert({
      job_id: form.job_id || null,
      kind: form.kind,
      item_name: form.item_name,
      qty: Number(form.qty || 1),
      notes: form.notes || null,
      mechanic_name: user?.displayName ?? null,
      requested_by: user?.id ?? null,
      source: form.source,
      estimated_unit_price: Number(form.estimated_unit_price || 0),
      is_major: form.is_major,
    } as any);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Request submitted" });
    setOpen(false);
    setForm({ job_id: "", kind: "part", item_name: "", qty: "1", notes: "", source: "in_house", estimated_unit_price: "0", is_major: false });
    load();
  };

  const setStatus = async (id: string, status: string) => {
    const patch: any = { status };
    if (status === "approved" || status === "issued") {
      patch.approved_by = user?.id ?? null;
      patch.approved_at = new Date().toISOString();
    }
    if (status === "ordered") patch.ordered_at = new Date().toISOString();
    if (status === "in_delivery") patch.in_delivery_at = new Date().toISOString();
    if (status === "delivered") patch.delivered_at = new Date().toISOString();
    if (status === "returned") patch.returned_at = new Date().toISOString();
    const { error } = await supabase.from("part_requests").update(patch).eq("id", id);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Marked ${status}` });
    load();
  };

  const badge = (s: string) => {
    if (s === "pending") return <Badge variant="secondary">Pending</Badge>;
    if (s === "approved") return <Badge className="bg-status-diagnosed text-primary-foreground">Approved</Badge>;
    if (s === "ordered") return <Badge className="bg-amber-500 text-white">Ordered</Badge>;
    if (s === "in_delivery") return <Badge className="bg-blue-500 text-white">In delivery</Badge>;
    if (s === "delivered") return <Badge className="bg-emerald-500 text-white">Delivered</Badge>;
    if (s === "issued") return <Badge className="bg-gradient-primary text-primary-foreground">Issued</Badge>;
    if (s === "returned") return <Badge className="bg-success text-success-foreground">Returned</Badge>;
    if (s === "rejected") return <Badge className="bg-destructive text-destructive-foreground">Rejected</Badge>;
    return <Badge>{s}</Badge>;
  };

  const sourceBadge = (src?: string | null) => {
    const s = src || "in_house";
    const label = s === "in_house" ? "In-house" : s === "outsourced" ? "Outsourced" : "Supplier";
    const cls = s === "in_house" ? "bg-primary/10 text-primary border-primary/30"
      : s === "outsourced" ? "bg-amber-500/10 text-amber-700 border-amber-500/30"
      : "bg-blue-500/10 text-blue-700 border-blue-500/30";
    return <Badge variant="outline" className={`text-[10px] ${cls}`}>{label}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Parts & Tools Requests</h1>
          <p className="text-sm text-muted-foreground">Mechanics request items for a job · reception/storekeeper approves and tracks returns.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="bg-gradient-primary"><Plus className="h-4 w-4 mr-2" />New request</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Request part or tool</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              <div>
                <Label>Job</Label>
                <Select value={form.job_id} onValueChange={v => setForm({ ...form, job_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Pick active job" /></SelectTrigger>
                  <SelectContent>{jobs.map(j => <SelectItem key={j.id} value={j.id}>{j.job_no} — {j.plate}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Kind</Label>
                  <Select value={form.kind} onValueChange={v => setForm({ ...form, kind: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="part">Part</SelectItem>
                      <SelectItem value="tool">Tool</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Quantity</Label><Input type="number" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} /></div>
              </div>
              <div><Label>Item</Label><Input value={form.item_name} onChange={e => setForm({ ...form, item_name: e.target.value })} placeholder="e.g. Brake pad front" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Source</Label>
                  <Select value={form.source} onValueChange={v => setForm({ ...form, source: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in_house">In-house (own stock)</SelectItem>
                      <SelectItem value="outsourced">Outsourced (external)</SelectItem>
                      <SelectItem value="supplier">From our supplier</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {showPrice && (
                  <div><Label>Est. unit price (KSh)</Label><Input type="number" value={form.estimated_unit_price} onChange={e => setForm({ ...form, estimated_unit_price: e.target.value })} /></div>
                )}
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={form.is_major} onChange={e => setForm({ ...form, is_major: e.target.checked })} className="h-4 w-4 accent-primary" />
                Mark as <strong>major part</strong> (requires manager/director go-ahead before fitting)
              </label>
              <div><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={submit} className="bg-gradient-primary">Submit</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground">
            <th className="p-3">When</th><th className="p-3">Mechanic</th><th className="p-3">Kind</th>
            <th className="p-3">Item</th><th className="p-3 text-right">Qty</th><th className="p-3">Status</th>
            {canApprove && <th className="p-3 text-right">Action</th>}
          </tr></thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={canApprove ? 7 : 6} className="p-6 text-center text-muted-foreground">No requests yet.</td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="p-3 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("en-GB")}</td>
                <td className="p-3">{r.mechanic_name ?? "—"}</td>
                <td className="p-3 capitalize">{r.kind}</td>
                <td className="p-3 font-medium">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span>{r.item_name}</span>
                    {sourceBadge(r.source)}
                    {r.is_major && <Badge className="bg-destructive text-destructive-foreground text-[10px]">MAJOR</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">{r.notes ?? ""}</div>
                </td>
                <td className="p-3 text-right">{r.qty}</td>
                <td className="p-3">{badge(r.status)}</td>
                {canApprove && (
                  <td className="p-3 text-right space-x-1">
                    {r.status === "pending" && <>
                      <Button size="sm" variant="outline" onClick={() => setStatus(r.id, "approved")}><CheckCircle2 className="h-3 w-3 mr-1" />Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => setStatus(r.id, "rejected")}><XCircle className="h-3 w-3 mr-1" />Reject</Button>
                    </>}
                    {r.status === "approved" && r.source === "in_house" && (
                      <Button size="sm" className="bg-gradient-primary" onClick={() => setStatus(r.id, "issued")}>Mark issued</Button>
                    )}
                    {r.status === "approved" && r.source !== "in_house" && (
                      <Button size="sm" variant="outline" onClick={() => setStatus(r.id, "ordered")}>Mark ordered</Button>
                    )}
                    {r.status === "ordered" && (
                      <Button size="sm" variant="outline" onClick={() => setStatus(r.id, "in_delivery")}>In delivery</Button>
                    )}
                    {r.status === "in_delivery" && (
                      <Button size="sm" variant="outline" onClick={() => setStatus(r.id, "delivered")}>Delivered</Button>
                    )}
                    {r.status === "delivered" && (
                      <Button size="sm" className="bg-gradient-primary" onClick={() => setStatus(r.id, "issued")}>Issue to mechanic</Button>
                    )}
                    {r.status === "issued" && r.kind === "tool" && <Button size="sm" variant="outline" onClick={() => setStatus(r.id, "returned")}><RotateCcw className="h-3 w-3 mr-1" />Returned</Button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Card>
    </div>
  );
}
