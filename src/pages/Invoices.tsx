import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, FileText, DollarSign, Clock, CheckCircle2, Download, Receipt, FileSignature } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { generateInvoicePDF, generateQuotationPDF, generateReceiptPDF } from "@/lib/pdf-templates";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Invoice = {
  id: string;
  invoice_no: string | null;
  invoice_book_no: string | null;
  plate: string | null;
  service_type: string | null;
  parts_source: string | null;
  time_in: string | null;
  time_out: string | null;
  date: string;
  amount: number;
  discount: number;
  discount_by: string | null;
  amount_paid: number;
  technicians: string | null;
  customer_phone: string | null;
  status: string;
  notes: string | null;
};

const fmt = (n: number) => `KSh ${Number(n).toLocaleString()}`;
const invoiceNetAmount = (invoice: Pick<Invoice, "amount" | "discount">) =>
  Math.max(0, Number(invoice.amount || 0) - Number(invoice.discount || 0));
const fmtTime = (s: string | null) => s ? new Date(s).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "—";

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const blank = {
    invoice_no: "", invoice_book_no: "", plate: "",
    service_type: "mechanical", parts_source: "shop",
    time_in: "", time_out: "",
    date: new Date().toISOString().slice(0, 10),
    amount: "", discount: "", discount_by: "",
    amount_paid: "", technicians: "", customer_phone: "",
    status: "draft", notes: "",
  };
  const [form, setForm] = useState(blank);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("invoices")
      .select("*")
      .eq("doc_type", "invoice")
      .order("date", { ascending: false })
      .order("time_in", { ascending: false });
    if (error) toast({ title: "Could not load", description: error.message, variant: "destructive" });
    else setInvoices((data ?? []) as Invoice[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let list = invoices;
    if (statusFilter !== "all") list = list.filter(i => i.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(i =>
        (i.plate ?? "").toLowerCase().includes(q) ||
        (i.invoice_no ?? "").toLowerCase().includes(q) ||
        (i.technicians ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [invoices, search, statusFilter]);

  const totals = useMemo(() => {
    let billed = 0, paid = 0, outstanding = 0;
    for (const i of invoices) {
      const net = invoiceNetAmount(i);
      billed += net;
      paid += Number(i.amount_paid);
      outstanding += Math.max(0, net - Number(i.amount_paid));
    }
    return { billed, paid, outstanding, count: invoices.length };
  }, [invoices]);

  const openNew = () => { setEditing(null); setForm(blank); setOpen(true); };
  const openEdit = (i: Invoice) => {
    setEditing(i);
    setForm({
      invoice_no: i.invoice_no ?? "",
      invoice_book_no: i.invoice_book_no ?? "",
      plate: i.plate ?? "",
      service_type: i.service_type ?? "mechanical",
      parts_source: i.parts_source ?? "shop",
      time_in: i.time_in ? i.time_in.slice(0, 16) : "",
      time_out: i.time_out ? i.time_out.slice(0, 16) : "",
      date: i.date,
      amount: String(i.amount),
      discount: String(i.discount),
      discount_by: i.discount_by ?? "",
      amount_paid: String(i.amount_paid),
      technicians: i.technicians ?? "",
      customer_phone: i.customer_phone ?? "",
      status: i.status,
      notes: i.notes ?? "",
    });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.plate.trim()) { toast({ title: "Plate required", variant: "destructive" }); return; }
    const payload: any = {
      invoice_no: form.invoice_no || null,
      invoice_book_no: form.invoice_book_no || null,
      plate: form.plate.toUpperCase(),
      service_type: form.service_type,
      parts_source: form.parts_source,
      time_in: form.time_in || null,
      time_out: form.time_out || null,
      date: form.date,
      amount: Number(form.amount || 0),
      discount: Number(form.discount || 0),
      discount_by: form.discount_by || null,
      amount_paid: Number(form.amount_paid || 0),
      technicians: form.technicians || null,
      customer_phone: form.customer_phone || null,
      status: form.status,
      notes: form.notes || null,
    };
    const { error } = editing
      ? await supabase.from("invoices").update(payload).eq("id", editing.id)
      : await supabase.from("invoices").insert(payload);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: editing ? "Invoice updated" : "Invoice created" });
    setOpen(false);
    load();
  };

  const statusBadge = (s: string) => {
    if (s === "paid") return <Badge className="bg-status-diagnosed text-primary-foreground">Paid</Badge>;
    if (s === "issued") return <Badge className="bg-status-repair text-primary-foreground">Issued</Badge>;
    if (s === "cancelled") return <Badge className="bg-destructive text-destructive-foreground">Cancelled</Badge>;
    return <Badge variant="secondary">Draft</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground">All invoiced vehicles · time in/out, amounts, payments</p>
        </div>
        <Button className="bg-gradient-primary" onClick={openNew}><Plus className="h-4 w-4 mr-2" />New invoice</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground"><FileText className="h-3.5 w-3.5" />Total invoices</div>
          <p className="mt-1 text-2xl font-bold">{totals.count}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground"><DollarSign className="h-3.5 w-3.5" />Billed</div>
          <p className="mt-1 text-2xl font-bold">{fmt(totals.billed)}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5" />Paid</div>
          <p className="mt-1 text-2xl font-bold text-status-diagnosed">{fmt(totals.paid)}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground"><Clock className="h-3.5 w-3.5" />Outstanding</div>
          <p className="mt-1 text-2xl font-bold text-destructive">{fmt(totals.outstanding)}</p>
        </Card>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-64 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search plate, invoice #, technician…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="issued">Issued</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="p-3">Date</th>
                <th className="p-3">Inv #</th>
                <th className="p-3">Plate</th>
                <th className="p-3">Service</th>
                <th className="p-3">Time in / out</th>
                <th className="p-3">Technicians</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3 text-right">Paid</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Print</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">No invoices</td></tr>
              ) : filtered.map(i => {
                const buildData = () => ({
                  doc_no: i.invoice_no ?? undefined,
                  date: i.date,
                  customer_name: i.technicians ?? undefined,
                  customer_phone: i.customer_phone ?? undefined,
                  plate: i.plate ?? undefined,
                  lines: [{ description: `${i.service_type ?? "Service"} — ${i.notes ?? "Workshop services"}`, qty: 1, unit_price: Number(i.amount) }],
                  discount: Number(i.discount),
                  amount_paid: Number(i.amount_paid),
                  notes: i.notes ?? undefined,
                  served_by: i.technicians ?? undefined,
                  vat: false,
                });
                return (
                <tr key={i.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="p-3 text-muted-foreground cursor-pointer" onClick={() => openEdit(i)}>{i.date}</td>
                  <td className="p-3 font-mono cursor-pointer" onClick={() => openEdit(i)}>{i.invoice_no ?? "—"}{i.invoice_book_no ? ` · bk${i.invoice_book_no}` : ""}</td>
                  <td className="p-3 font-bold cursor-pointer" onClick={() => openEdit(i)}>{i.plate}</td>
                  <td className="p-3 capitalize text-muted-foreground">{i.service_type ?? "—"}</td>
                  <td className="p-3 text-xs text-muted-foreground">{fmtTime(i.time_in)} → {fmtTime(i.time_out)}</td>
                  <td className="p-3 text-muted-foreground">{i.technicians ?? "—"}</td>
                  <td className="p-3 text-right font-bold">{fmt(invoiceNetAmount(i))}</td>
                  <td className="p-3 text-right">{fmt(Number(i.amount_paid))}</td>
                  <td className="p-3">{statusBadge(i.status)}</td>
                  <td className="p-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="outline" onClick={(e) => e.stopPropagation()}>
                          <Download className="h-3.5 w-3.5 mr-1" />PDF
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); generateInvoicePDF(buildData()); }}>
                          <FileText className="h-4 w-4 mr-2" />Invoice
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); generateQuotationPDF(buildData()); }}>
                          <FileSignature className="h-4 w-4 mr-2" />Quotation
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); generateReceiptPDF({ ...buildData(), payment_mode: "CASH" }); }}>
                          <Receipt className="h-4 w-4 mr-2" />Receipt
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "Edit invoice" : "New invoice"}</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2 max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Date</Label><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
              <div><Label>Invoice #</Label><Input value={form.invoice_no} onChange={e => setForm({ ...form, invoice_no: e.target.value })} /></div>
              <div><Label>Book #</Label><Input value={form.invoice_book_no} onChange={e => setForm({ ...form, invoice_book_no: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Plate</Label><Input value={form.plate} onChange={e => setForm({ ...form, plate: e.target.value })} /></div>
              <div>
                <Label>Service type</Label>
                <Select value={form.service_type} onValueChange={v => setForm({ ...form, service_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="service">Service</SelectItem>
                    <SelectItem value="mechanical">Mechanical</SelectItem>
                    <SelectItem value="body">Body</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Parts source</Label>
                <Select value={form.parts_source} onValueChange={v => setForm({ ...form, parts_source: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="own">Own (customer)</SelectItem>
                    <SelectItem value="shop">Shop</SelectItem>
                    <SelectItem value="both">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Time in</Label><Input type="datetime-local" value={form.time_in} onChange={e => setForm({ ...form, time_in: e.target.value })} /></div>
              <div><Label>Time out</Label><Input type="datetime-local" value={form.time_out} onChange={e => setForm({ ...form, time_out: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Technicians</Label><Input value={form.technicians} onChange={e => setForm({ ...form, technicians: e.target.value })} placeholder="HUSSEIN/GEOFFERY" /></div>
              <div><Label>Customer phone</Label><Input value={form.customer_phone} onChange={e => setForm({ ...form, customer_phone: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div><Label>Amount</Label><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
              <div><Label>Discount</Label><Input type="number" value={form.discount} onChange={e => setForm({ ...form, discount: e.target.value })} /></div>
              <div><Label>Discount by</Label><Input value={form.discount_by} onChange={e => setForm({ ...form, discount_by: e.target.value })} /></div>
              <div><Label>Paid</Label><Input type="number" value={form.amount_paid} onChange={e => setForm({ ...form, amount_paid: e.target.value })} /></div>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="issued">Issued</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} className="bg-gradient-primary">{editing ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
