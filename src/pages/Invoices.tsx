import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, FileText, DollarSign, Clock, CheckCircle2, Download, Receipt, FileSignature, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  closeReservedDocumentWindow,
  openStoredDocumentUrl,
  reserveDocumentWindow,
  storeInvoiceDocumentPdf,
} from "@/lib/document-storage";
import { useIsMobile } from "@/hooks/use-mobile";
import { canonicalizeDocuments } from "@/lib/generated-records";

type DocumentType = "quotation" | "deposit_invoice" | "invoice" | "receipt";

type InvoiceItem = {
  id: string;
  kind: string;
  description: string;
  qty: number;
  unit_price: number;
};

type DocumentRow = {
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
  doc_type: DocumentType;
  payment_mode: string | null;
  payment_reference: string | null;
  payer_type: string | null;
  payer_name: string | null;
  invoice_items?: InvoiceItem[];
};

const DOC_LABELS: Record<DocumentType, string> = {
  quotation: "Quotation",
  deposit_invoice: "Deposit invoice",
  invoice: "Invoice",
  receipt: "Receipt",
};

const fmt = (n: number) => `KSh ${Number(n || 0).toLocaleString()}`;
const fmtTime = (s: string | null) => s ? new Date(s).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "-";
const documentOutstanding = (doc: Pick<DocumentRow, "doc_type" | "amount" | "amount_paid">) =>
  doc.doc_type === "invoice" ? Math.max(0, Number(doc.amount || 0) - Number(doc.amount_paid || 0)) : 0;

const EMPTY_FORM = {
  doc_type: "invoice" as DocumentType,
  invoice_no: "",
  invoice_book_no: "",
  plate: "",
  service_type: "mechanical",
  parts_source: "shop",
  time_in: "",
  time_out: "",
  date: new Date().toISOString().slice(0, 10),
  amount: "",
  discount: "",
  discount_by: "",
  amount_paid: "",
  technicians: "",
  customer_phone: "",
  status: "draft",
  notes: "",
  payer_type: "client",
  payer_name: "",
  payment_mode: "cash",
  payment_reference: "",
};

function buildPdfData(doc: DocumentRow) {
  const lines = (doc.invoice_items ?? []).length > 0
    ? (doc.invoice_items ?? []).map((item) => ({
        description: item.description,
        qty: Number(item.qty || 0),
        unit_price: Number(item.unit_price || 0),
      }))
    : [{
        description: `${DOC_LABELS[doc.doc_type]} - ${doc.notes ?? doc.service_type ?? "Workshop services"}`,
        qty: 1,
        unit_price: Number(doc.amount || 0),
      }];

  return {
    doc_no: doc.invoice_no ?? undefined,
    date: doc.date,
    customer_name: doc.payer_name ?? undefined,
    customer_phone: doc.customer_phone ?? undefined,
    plate: doc.plate ?? undefined,
    lines,
    discount: Number(doc.discount || 0),
    amount_paid: Number(doc.amount_paid || 0),
    notes: doc.notes ?? undefined,
    served_by: doc.technicians ?? undefined,
    vat: false,
  };
}

async function openDocument(doc: DocumentRow) {
  const target = reserveDocumentWindow();
  try {
    const stored = await storeInvoiceDocumentPdf({
      invoiceId: doc.id,
      kind: doc.doc_type,
      data: buildPdfData(doc),
      paymentMode: doc.payment_mode,
      receivedFrom: doc.payer_name,
    });
    openStoredDocumentUrl(stored.url, target);
  } catch (error: any) {
    closeReservedDocumentWindow(target);
    toast({
      title: "Could not open PDF",
      description: error?.message ?? "The document link could not be prepared.",
      variant: "destructive",
    });
  }
}

export default function Invoices() {
  const isMobile = useIsMobile();
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [docTypeFilter, setDocTypeFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentRow | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("invoices")
      .select("*, invoice_items(*)")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) toast({ title: "Could not load documents", description: error.message, variant: "destructive" });
    else setDocuments(canonicalizeDocuments((data ?? []) as DocumentRow[]));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let list = documents;
    if (statusFilter !== "all") list = list.filter((doc) => doc.status === statusFilter);
    if (docTypeFilter !== "all") list = list.filter((doc) => doc.doc_type === docTypeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((doc) =>
        (doc.plate ?? "").toLowerCase().includes(q) ||
        (doc.invoice_no ?? "").toLowerCase().includes(q) ||
        (doc.payer_name ?? "").toLowerCase().includes(q) ||
        (doc.technicians ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [documents, search, statusFilter, docTypeFilter]);

  const totals = useMemo(() => {
    const finalInvoices = documents.filter((doc) => doc.doc_type === "invoice");
    const deposits = documents.filter((doc) => doc.doc_type === "deposit_invoice");
    const receipts = documents.filter((doc) => doc.doc_type === "receipt");
    return {
      count: documents.length,
      invoiceCount: finalInvoices.length,
      depositRequested: deposits.reduce((sum, doc) => sum + Number(doc.amount || 0), 0),
      paymentsRecorded: deposits.reduce((sum, doc) => sum + Number(doc.amount_paid || 0), 0) + receipts.reduce((sum, doc) => sum + Number(doc.amount_paid || 0), 0),
      outstanding: finalInvoices.reduce((sum, doc) => sum + documentOutstanding(doc), 0),
    };
  }, [documents]);

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setOpen(true);
  };

  const openEdit = (doc: DocumentRow) => {
    setEditing(doc);
    setForm({
      doc_type: doc.doc_type,
      invoice_no: doc.invoice_no ?? "",
      invoice_book_no: doc.invoice_book_no ?? "",
      plate: doc.plate ?? "",
      service_type: doc.service_type ?? "mechanical",
      parts_source: doc.parts_source ?? "shop",
      time_in: doc.time_in ? doc.time_in.slice(0, 16) : "",
      time_out: doc.time_out ? doc.time_out.slice(0, 16) : "",
      date: doc.date,
      amount: String(doc.amount ?? 0),
      discount: String(doc.discount ?? 0),
      discount_by: doc.discount_by ?? "",
      amount_paid: String(doc.amount_paid ?? 0),
      technicians: doc.technicians ?? "",
      customer_phone: doc.customer_phone ?? "",
      status: doc.status,
      notes: doc.notes ?? "",
      payer_type: doc.payer_type ?? "client",
      payer_name: doc.payer_name ?? "",
      payment_mode: doc.payment_mode ?? "cash",
      payment_reference: doc.payment_reference ?? "",
    });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.plate.trim()) {
      toast({ title: "Plate required", variant: "destructive" });
      return;
    }
    const payload: any = {
      doc_type: form.doc_type,
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
      payer_type: form.payer_type,
      payer_name: form.payer_name || null,
      payment_mode: form.payment_mode || "cash",
      payment_reference: form.payment_reference || null,
    };
    const { error } = editing
      ? await supabase.from("invoices").update(payload).eq("id", editing.id)
      : await supabase.from("invoices").insert(payload);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: editing ? "Document updated" : "Document created" });
    setOpen(false);
    load();
  };

  const statusBadge = (status: string) => {
    if (status === "paid") return <Badge className="bg-status-diagnosed text-primary-foreground">Paid</Badge>;
    if (status === "issued") return <Badge className="bg-status-repair text-primary-foreground">Issued</Badge>;
    if (status === "bypassed") return <Badge className="bg-amber-500 text-amber-950">Bypassed</Badge>;
    if (status === "cancelled") return <Badge className="bg-destructive text-destructive-foreground">Cancelled</Badge>;
    return <Badge variant="secondary">Draft</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground">One documents register for quotations, deposit invoices, invoices, and receipts.</p>
        </div>
        <Button className="w-full bg-gradient-primary sm:w-auto" onClick={openNew}><Plus className="h-4 w-4 mr-2" />New document</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground"><FileText className="h-3.5 w-3.5" />Documents</div>
          <p className="mt-1 text-2xl font-bold">{totals.count}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground"><FileSignature className="h-3.5 w-3.5" />Final invoices</div>
          <p className="mt-1 text-2xl font-bold">{totals.invoiceCount}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground"><DollarSign className="h-3.5 w-3.5" />Deposits requested</div>
          <p className="mt-1 text-2xl font-bold">{fmt(totals.depositRequested)}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5" />Payments recorded</div>
          <p className="mt-1 text-2xl font-bold text-status-diagnosed">{fmt(totals.paymentsRecorded)}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground"><Clock className="h-3.5 w-3.5" />Open invoice balance</div>
          <p className="mt-1 text-2xl font-bold text-destructive">{fmt(totals.outstanding)}</p>
        </Card>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <div className="relative w-full min-w-0 sm:flex-1 sm:min-w-64 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search plate, doc #, payer, technician..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={docTypeFilter} onValueChange={setDocTypeFilter}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All document types</SelectItem>
            <SelectItem value="quotation">Quotation</SelectItem>
            <SelectItem value="deposit_invoice">Deposit invoice</SelectItem>
            <SelectItem value="invoice">Invoice</SelectItem>
            <SelectItem value="receipt">Receipt</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="issued">Issued</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="bypassed">Bypassed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden">
        {isMobile ? (
          <div className="space-y-3 p-4">
            {loading ? (
              <p className="py-8 text-center text-muted-foreground">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">No documents found</p>
            ) : filtered.map((doc) => (
              <div key={doc.id} className="rounded-lg border p-4">
                <button className="w-full text-left" onClick={() => openEdit(doc)}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Badge variant="outline">{DOC_LABELS[doc.doc_type]}</Badge>
                      <p className="mt-2 font-mono text-sm">{doc.invoice_no ?? "-"}{doc.invoice_book_no ? ` / bk${doc.invoice_book_no}` : ""}</p>
                    </div>
                    {statusBadge(doc.status)}
                  </div>
                  <div className="mt-3 space-y-1">
                    <p className="font-bold">{doc.plate ?? "-"}</p>
                    <p className="text-xs text-muted-foreground">{doc.payer_name ?? "-"}</p>
                    <p className="text-xs text-muted-foreground">{doc.date} • {fmtTime(doc.time_in)} {"->"} {fmtTime(doc.time_out)}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-md bg-muted/40 p-3">
                      <p className="text-[11px] text-muted-foreground">Amount</p>
                      <p className="font-bold">{fmt(doc.amount)}</p>
                    </div>
                    <div className="rounded-md bg-muted/40 p-3">
                      <p className="text-[11px] text-muted-foreground">Paid</p>
                      <p className="font-bold">{fmt(doc.amount_paid)}</p>
                    </div>
                  </div>
                </button>
                <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => openDocument(doc)}>
                  <Download className="mr-1 h-3.5 w-3.5" />Open PDF
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="p-3">Date</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Doc #</th>
                  <th className="p-3">Plate / payer</th>
                  <th className="p-3">Time in / out</th>
                  <th className="p-3 text-right">Amount</th>
                  <th className="p-3 text-right">Paid</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Open</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Loading...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">No documents found</td></tr>
                ) : filtered.map((doc) => (
                  <tr key={doc.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="cursor-pointer p-3 text-muted-foreground" onClick={() => openEdit(doc)}>{doc.date}</td>
                    <td className="cursor-pointer p-3" onClick={() => openEdit(doc)}>
                      <Badge variant="outline">{DOC_LABELS[doc.doc_type]}</Badge>
                    </td>
                    <td className="cursor-pointer p-3 font-mono" onClick={() => openEdit(doc)}>
                      {doc.invoice_no ?? "-"}{doc.invoice_book_no ? ` / bk${doc.invoice_book_no}` : ""}
                    </td>
                    <td className="cursor-pointer p-3" onClick={() => openEdit(doc)}>
                      <p className="font-bold">{doc.plate ?? "-"}</p>
                      <p className="text-xs text-muted-foreground">{doc.payer_name ?? "-"}</p>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{fmtTime(doc.time_in)} {"->"} {fmtTime(doc.time_out)}</td>
                    <td className="p-3 text-right font-bold">{fmt(doc.amount)}</td>
                    <td className="p-3 text-right">{fmt(doc.amount_paid)}</td>
                    <td className="p-3">{statusBadge(doc.status)}</td>
                    <td className="p-3 text-right">
                      <Button size="sm" variant="outline" onClick={() => openDocument(doc)}>
                        <Download className="mr-1 h-3.5 w-3.5" />Open PDF
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl overflow-hidden">
          <DialogHeader><DialogTitle>{editing ? "Edit document" : "New document"}</DialogTitle></DialogHeader>
          <div className="grid max-h-[70vh] gap-3 overflow-y-auto py-2 pr-1">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Document type</Label>
                <Select value={form.doc_type} onValueChange={(value: DocumentType) => setForm({ ...form, doc_type: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quotation">Quotation</SelectItem>
                    <SelectItem value="deposit_invoice">Deposit invoice</SelectItem>
                    <SelectItem value="invoice">Invoice</SelectItem>
                    <SelectItem value="receipt">Receipt</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
              <div><Label>Doc #</Label><Input value={form.invoice_no} onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div><Label>Book #</Label><Input value={form.invoice_book_no} onChange={(e) => setForm({ ...form, invoice_book_no: e.target.value })} /></div>
              <div><Label>Plate</Label><Input value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} /></div>
              <div><Label>Payer type</Label><Select value={form.payer_type} onValueChange={(value) => setForm({ ...form, payer_type: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="client">Client</SelectItem><SelectItem value="insurance">Insurance</SelectItem></SelectContent></Select></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Payer name</Label><Input value={form.payer_name} onChange={(e) => setForm({ ...form, payer_name: e.target.value })} /></div>
              <div><Label>Customer phone</Label><Input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Service type</Label>
                <Select value={form.service_type} onValueChange={(value) => setForm({ ...form, service_type: value })}>
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
                <Select value={form.parts_source} onValueChange={(value) => setForm({ ...form, parts_source: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="own">Own (customer)</SelectItem>
                    <SelectItem value="shop">Shop</SelectItem>
                    <SelectItem value="both">Both</SelectItem>
                    <SelectItem value="job_card">Job card</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Technicians</Label><Input value={form.technicians} onChange={(e) => setForm({ ...form, technicians: e.target.value })} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Time in</Label><Input type="datetime-local" value={form.time_in} onChange={(e) => setForm({ ...form, time_in: e.target.value })} /></div>
              <div><Label>Time out</Label><Input type="datetime-local" value={form.time_out} onChange={(e) => setForm({ ...form, time_out: e.target.value })} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><Label>Amount</Label><Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
              <div><Label>Discount</Label><Input type="number" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} /></div>
              <div><Label>Discount by</Label><Input value={form.discount_by} onChange={(e) => setForm({ ...form, discount_by: e.target.value })} /></div>
              <div><Label>Paid</Label><Input type="number" value={form.amount_paid} onChange={(e) => setForm({ ...form, amount_paid: e.target.value })} /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="issued">Issued</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="bypassed">Bypassed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Payment mode</Label>
                <Select value={form.payment_mode} onValueChange={(value) => setForm({ ...form, payment_mode: value })}>
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
              <div><Label>Payment reference</Label><Input value={form.payment_reference} onChange={(e) => setForm({ ...form, payment_reference: e.target.value })} /></div>
            </div>
            <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
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
