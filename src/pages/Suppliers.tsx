import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, Building2, Wallet, Receipt, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type Supplier = { id: string; name: string; phone: string | null; kind: string; location: string | null; purpose: string | null; notes: string | null };
type Ledger = { id: string; supplier_id: string; date: string; type: string; amount: number; reference: string | null; note: string | null };
type Part = { id: string; name: string; sku: string; unit_cost: number; unit_price: number };
type Loc  = { id: string; name: string; kind: string };
type JobOption = { id: string; job_no: string; plate: string; vehicle_label: string | null; status: string };

const fmt = (n: number) => `KSh ${Number(n).toLocaleString()}`;

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [openSup, setOpenSup] = useState(false);
  const [openPay, setOpenPay] = useState<Supplier | null>(null);
  const [openCharge, setOpenCharge] = useState<Supplier | null>(null);
  const [supForm, setSupForm] = useState({ name: "", phone: "", kind: "external", location: "", purpose: "", notes: "", opening_balance: "" });
  const [txnForm, setTxnForm] = useState({ amount: "", reference: "", note: "", date: new Date().toISOString().slice(0, 10), job_id: "" });
  const [chargeParts, setChargeParts] = useState<Part[]>([]);
  const [locs, setLocs] = useState<Loc[]>([]);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [chargeForm, setChargeForm] = useState({
    part_id: "" as string, qty: "", buy_price: "", sell_price: "", location_id: "" as string,
  });

  const load = async () => {
    setLoading(true);
    const [{ data: sd }, { data: ld }, { data: pd }, { data: lod }, { data: jd }] = await Promise.all([
      supabase.from("suppliers").select("*").order("name"),
      supabase.from("supplier_ledger").select("*").order("date", { ascending: false }),
      supabase.from("parts").select("id,name,sku,unit_cost,unit_price").order("name"),
      supabase.from("locations").select("id,name,kind").order("name"),
      supabase.from("jobs").select("id, job_no, plate, vehicle_label, status").order("created_at", { ascending: false }).limit(300),
    ]);
    setSuppliers((sd ?? []) as Supplier[]);
    setLedger((ld ?? []) as Ledger[]);
    setChargeParts((pd ?? []) as Part[]);
    setLocs((lod ?? []) as Loc[]);
    setJobs((jd ?? []) as JobOption[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const balances = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of ledger) {
      const sign = e.type === "payment" ? -1 : 1; // payments reduce balance; opening/charge increase
      map.set(e.supplier_id, (map.get(e.supplier_id) ?? 0) + sign * Number(e.amount));
    }
    return map;
  }, [ledger]);

  const totalOwed = useMemo(() => {
    let t = 0;
    for (const v of balances.values()) if (v > 0) t += v;
    return t;
  }, [balances]);

  const filtered = useMemo(() => {
    if (!search.trim()) return suppliers;
    const q = search.toLowerCase();
    return suppliers.filter(s => s.name.toLowerCase().includes(q) || (s.purpose ?? "").toLowerCase().includes(q));
  }, [suppliers, search]);

  const saveSupplier = async () => {
    if (!supForm.name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    const openingBalance = Math.max(0, Number(supForm.opening_balance || 0));
    const { data: supplier, error } = await supabase.from("suppliers").insert({
      name: supForm.name,
      phone: supForm.phone || null,
      kind: supForm.kind,
      location: supForm.location || null,
      purpose: supForm.purpose || null,
      notes: supForm.notes || null,
    }).select("id, name").single();
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }

    if (supplier?.id && openingBalance > 0) {
      const { error: ledgerError } = await supabase.from("supplier_ledger").insert({
        supplier_id: supplier.id,
        date: new Date().toISOString().slice(0, 10),
        type: "opening_balance",
        amount: openingBalance,
        note: "Opening balance owed when supplier was created",
      });
      if (ledgerError) {
        toast({ title: "Supplier added", description: `Opening balance was not saved: ${ledgerError.message}`, variant: "destructive" });
        setOpenSup(false);
        setSupForm({ name: "", phone: "", kind: "external", location: "", purpose: "", notes: "", opening_balance: "" });
        load();
        return;
      }
    }

    toast({ title: "Supplier added" });
    setOpenSup(false);
    setSupForm({ name: "", phone: "", kind: "external", location: "", purpose: "", notes: "", opening_balance: "" });
    load();
  };

  const saveTxn = async (kind: "payment" | "charge") => {
    const sup = kind === "payment" ? openPay : openCharge;
    if (!sup) return;
    let amount = Number(txnForm.amount);
    const payload: any = {
      supplier_id: sup.id, date: txnForm.date, type: kind,
      reference: txnForm.reference || null, note: txnForm.note || null,
      job_id: txnForm.job_id || null,
    };
    if (kind === "charge" && chargeForm.part_id) {
      const qty = Number(chargeForm.qty || 0);
      const buy = Number(chargeForm.buy_price || 0);
      const sell = Number(chargeForm.sell_price || 0);
      if (!qty || !buy) { toast({ title: "Qty and buy price required for parts", variant: "destructive" }); return; }
      amount = qty * buy;
      payload.part_id = chargeForm.part_id;
      payload.qty = qty;
      payload.buy_price = buy;
      payload.sell_price = sell || null;
      payload.location_id = chargeForm.location_id || null;
    }
    if (!amount) { toast({ title: "Amount required", variant: "destructive" }); return; }
    payload.amount = amount;

    const { error } = await supabase.from("supplier_ledger").insert(payload);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    toast({
      title: kind === "payment" ? "Payment recorded" : "Charge added",
      description: kind === "charge" && chargeForm.part_id
        ? `Stock increased by ${chargeForm.qty}. Margin: KSh ${(Number(chargeForm.sell_price||0) - Number(chargeForm.buy_price||0)).toLocaleString()} per unit.`
        : undefined,
    });
    setOpenPay(null); setOpenCharge(null);
    setTxnForm({ amount: "", reference: "", note: "", date: new Date().toISOString().slice(0, 10), job_id: "" });
    setChargeForm({ part_id: "", qty: "", buy_price: "", sell_price: "", location_id: "" });
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Suppliers & Credit</h1>
          <p className="text-sm text-muted-foreground">External suppliers, internal stores · running balances and payments</p>
        </div>
        <Dialog open={openSup} onOpenChange={setOpenSup}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-primary"><Plus className="h-4 w-4 mr-2" />Add supplier</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New supplier</DialogTitle></DialogHeader>
            <div className="grid gap-3 py-2">
              <div><Label>Name</Label><Input value={supForm.name} onChange={e => setSupForm({ ...supForm, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Phone</Label><Input value={supForm.phone} onChange={e => setSupForm({ ...supForm, phone: e.target.value })} /></div>
                <div>
                  <Label>Kind</Label>
                  <Select value={supForm.kind} onValueChange={v => setSupForm({ ...supForm, kind: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="external">External</SelectItem>
                      <SelectItem value="labour_supplier">Labour supplier</SelectItem>
                      <SelectItem value="internal_shop">Internal — Nairobi shop</SelectItem>
                      <SelectItem value="internal_garage">Internal — Garage store</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>Location</Label><Input value={supForm.location} onChange={e => setSupForm({ ...supForm, location: e.target.value })} /></div>
              <div><Label>Purpose</Label><Input value={supForm.purpose} onChange={e => setSupForm({ ...supForm, purpose: e.target.value })} placeholder="e.g. Paint supplies" /></div>
              <div>
                <Label>Opening balance owed (KSh)</Label>
                <Input
                  type="number"
                  min="0"
                  value={supForm.opening_balance}
                  onChange={e => setSupForm({ ...supForm, opening_balance: e.target.value })}
                  placeholder="Optional amount you already owe this supplier"
                />
              </div>
              <div><Label>Notes</Label><Textarea value={supForm.notes} onChange={e => setSupForm({ ...supForm, notes: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpenSup(false)}>Cancel</Button>
              <Button onClick={saveSupplier} className="bg-gradient-primary">Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground"><Building2 className="h-3.5 w-3.5" />Suppliers</div>
          <p className="mt-1 text-2xl font-bold">{suppliers.length}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground"><Wallet className="h-3.5 w-3.5" />Total owed</div>
          <p className="mt-1 text-2xl font-bold text-destructive">{fmt(totalOwed)}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground"><Receipt className="h-3.5 w-3.5" />Ledger entries</div>
          <p className="mt-1 text-2xl font-bold">{ledger.length}</p>
        </Card>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search supplier or description…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Card>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-muted-foreground">
              <th className="p-3">Supplier</th>
              <th className="p-3">Kind</th>
              <th className="p-3">Purpose</th>
              <th className="p-3">Phone</th>
              <th className="p-3 text-right">Balance</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No suppliers</td></tr>
            ) : filtered.map(s => {
              const bal = balances.get(s.id) ?? 0;
              return (
                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="p-3 font-medium">{s.name}</td>
                  <td className="p-3">
                    {s.kind === "external" ? <Badge variant="secondary">External</Badge>
                     : s.kind === "labour_supplier" ? <Badge className="bg-amber-500 text-amber-950">Labour supplier</Badge>
                     : s.kind === "internal_shop" ? <Badge className="bg-status-diagnosed text-primary-foreground">Nairobi shop</Badge>
                     : <Badge className="bg-gradient-primary text-primary-foreground">Garage store</Badge>}
                  </td>
                  <td className="p-3 text-muted-foreground">{s.purpose ?? "—"}</td>
                  <td className="p-3 text-muted-foreground">{s.phone ?? "—"}</td>
                  <td className={`p-3 text-right font-bold ${bal > 0 ? "text-destructive" : bal < 0 ? "text-status-diagnosed" : ""}`}>
                    {bal === 0 ? "—" : fmt(bal)}
                  </td>
                  <td className="p-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => setOpenCharge(s)}>+ Owed / Charge</Button>
                    <Button size="sm" className="ml-2 bg-gradient-primary" onClick={() => setOpenPay(s)}>Pay</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </Card>

      {/* Payment dialog */}
      <Dialog open={!!openPay} onOpenChange={(o) => !o && setOpenPay(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record payment to {openPay?.name}</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date</Label><Input type="date" value={txnForm.date} onChange={e => setTxnForm({ ...txnForm, date: e.target.value })} /></div>
              <div><Label>Amount (KSh)</Label><Input type="number" value={txnForm.amount} onChange={e => setTxnForm({ ...txnForm, amount: e.target.value })} /></div>
            </div>
            <div>
              <Label>Assign car / job (optional)</Label>
              <Select value={txnForm.job_id} onValueChange={v => setTxnForm({ ...txnForm, job_id: v })}>
                <SelectTrigger><SelectValue placeholder="No car assigned" /></SelectTrigger>
                <SelectContent>
                  {jobs.map((job) => (
                    <SelectItem key={job.id} value={job.id}>
                      {job.plate} · {job.job_no} · {job.vehicle_label ?? job.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Reference</Label><Input value={txnForm.reference} onChange={e => setTxnForm({ ...txnForm, reference: e.target.value })} placeholder="M-Pesa code, cheque #" /></div>
            <div><Label>Note</Label><Textarea value={txnForm.note} onChange={e => setTxnForm({ ...txnForm, note: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenPay(null)}>Cancel</Button>
            <Button className="bg-gradient-primary" onClick={() => saveTxn("payment")}>Save payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Charge dialog */}
      <Dialog open={!!openCharge} onOpenChange={(o) => !o && setOpenCharge(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add charge for {openCharge?.name}</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-3 rounded-md border border-dashed border-amber-500/40 bg-amber-50/30 dark:bg-amber-950/20 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
                <Package className="h-3.5 w-3.5" /> Part charge — auto-adds to stock & tracks margin
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label>Part (optional — leave blank for non-parts charges)</Label>
                  <Select value={chargeForm.part_id} onValueChange={(v) => {
                    const p = chargeParts.find(x => x.id === v);
                    setChargeForm(f => ({
                      ...f, part_id: v,
                      buy_price: f.buy_price || (p?.unit_cost ? String(p.unit_cost) : ""),
                      sell_price: f.sell_price || (p?.unit_price ? String(p.unit_price) : ""),
                    }));
                  }}>
                    <SelectTrigger><SelectValue placeholder="— Not a part —" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {chargeParts.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.sku} · {p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {chargeForm.part_id && <>
                  <div><Label>Quantity</Label><Input type="number" min="1" value={chargeForm.qty} onChange={e => setChargeForm({ ...chargeForm, qty: e.target.value })} /></div>
                  <div>
                    <Label>Location</Label>
                    <Select value={chargeForm.location_id} onValueChange={v => setChargeForm({ ...chargeForm, location_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Garage store (default)" /></SelectTrigger>
                      <SelectContent>{locs.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div><Label>Buy price (each)</Label><Input type="number" value={chargeForm.buy_price} onChange={e => setChargeForm({ ...chargeForm, buy_price: e.target.value })} /></div>
                  <div><Label>Sell price (each)</Label><Input type="number" value={chargeForm.sell_price} onChange={e => setChargeForm({ ...chargeForm, sell_price: e.target.value })} /></div>
                  {chargeForm.qty && chargeForm.buy_price && (
                    <p className="col-span-2 text-xs text-muted-foreground">
                      Total charge: <b>KSh {(Number(chargeForm.qty) * Number(chargeForm.buy_price)).toLocaleString()}</b>
                      {chargeForm.sell_price && <> · Margin per unit: <b className="text-success">KSh {(Number(chargeForm.sell_price) - Number(chargeForm.buy_price)).toLocaleString()}</b></>}
                    </p>
                  )}
                </>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Date</Label><Input type="date" value={txnForm.date} onChange={e => setTxnForm({ ...txnForm, date: e.target.value })} /></div>
              <div><Label>Amount (KSh)</Label><Input type="number" disabled={!!chargeForm.part_id} value={chargeForm.part_id ? String(Number(chargeForm.qty||0) * Number(chargeForm.buy_price||0) || "") : txnForm.amount} onChange={e => setTxnForm({ ...txnForm, amount: e.target.value })} placeholder={chargeForm.part_id ? "Auto from qty × buy price" : ""} /></div>
            </div>
            <div>
              <Label>Assign car / job (optional)</Label>
              <Select value={txnForm.job_id} onValueChange={v => setTxnForm({ ...txnForm, job_id: v })}>
                <SelectTrigger><SelectValue placeholder="No car assigned" /></SelectTrigger>
                <SelectContent>
                  {jobs.map((job) => (
                    <SelectItem key={job.id} value={job.id}>
                      {job.plate} · {job.job_no} · {job.vehicle_label ?? job.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Reference</Label><Input value={txnForm.reference} onChange={e => setTxnForm({ ...txnForm, reference: e.target.value })} placeholder="Invoice #, delivery note" /></div>
            <div><Label>Note</Label><Textarea value={txnForm.note} onChange={e => setTxnForm({ ...txnForm, note: e.target.value })} placeholder="What was supplied" /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenCharge(null)}>Cancel</Button>
            <Button className="bg-gradient-primary" onClick={() => saveTxn("charge")}>Save charge</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
