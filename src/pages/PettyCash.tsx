import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CameraInput } from "@/components/CameraInput";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Wallet, TrendingDown, ArrowUpCircle, Search, Download, Sparkles, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { generatePettyCashReportPDF } from "@/lib/pdf-templates";
import { useAuth } from "@/lib/auth";
import { isEdgeFunctionUnavailable, readEdgeFunctionErrorMessage } from "@/lib/edge-function-error";
import { invokeEdgeFunction } from "@/lib/invoke-edge";
import {
  closeReservedDocumentWindow,
  openStoredDocumentUrl,
  reserveDocumentWindow,
  storeGeneratedPdfFile,
} from "@/lib/document-storage";
import {
  buildPettyCashDailyLedger,
  calculatePettyCashRangeSummary,
  sortPettyCashEntriesNewestFirst,
} from "@/lib/petty-cash";

type Entry = {
  id: string;
  created_at: string;
  date: string;
  type: "opening_balance" | "payment" | "topup";
  payee: string | null;
  details: string | null;
  amount: number;
  transaction_cost: number;
  payment_mode?: string | null;
  payment_reference?: string | null;
  contact?: string | null;
  transaction_time?: string | null;
  staff_user_id?: string | null;
};

type StaffRoleRow = {
  user_id: string;
  role: string;
};

type StaffDirectoryEntry = {
  id: string;
  display_name: string | null;
  phone: string | null;
  roles: string[];
};

type RangePreset = "today" | "yesterday" | "this_month" | "last_month" | "all" | "custom";

type PettyCashAISuggestion = {
  direction?: "sent" | "received" | "unknown";
  payee?: string;
  contact?: string;
  amount?: number;
  transaction_cost?: number;
  payment_reference?: string;
  transaction_date?: string;
  transaction_time?: string;
  payment_mode?: string;
  summary?: string;
  confidence?: number;
};

const fmt = (n: number) => `KSh ${Number(n).toLocaleString()}`;
const normalizePaymentReference = (value: string | null | undefined) =>
  String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
const normalizeTransactionTime = (value: string | null | undefined) =>
  String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
const isMpesaMode = (value: string | null | undefined) => String(value ?? "").trim().toLowerCase() === "mpesa";
const isDuplicateTransactionError = (error: { code?: string | null; message?: string | null } | null | undefined) =>
  error?.code === "23505" || String(error?.message ?? "").toLowerCase().includes("transaction already exists");
const toDateInputValue = (value = new Date()) => value.toLocaleDateString("en-CA");
const normalizePhoneKey = (value: string | null | undefined) => String(value ?? "").replace(/\D/g, "").slice(-9);
const normalizeNameKey = (value: string | null | undefined) =>
  String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const entryDelta = (entry: Pick<Entry, "type" | "amount" | "transaction_cost">) => {
  const amount = Number(entry.amount || 0);
  const cost = Number(entry.transaction_cost || 0);
  if (entry.type === "opening_balance") return amount;
  if (entry.type === "topup") return amount - cost;
  return -(amount + cost);
};

function getRangeFromPreset(preset: Exclude<RangePreset, "custom">) {
  const today = new Date();
  const todayValue = toDateInputValue(today);
  if (preset === "all") return { from: "", to: "" };
  if (preset === "today") return { from: todayValue, to: todayValue };
  if (preset === "yesterday") {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const value = toDateInputValue(yesterday);
    return { from: value, to: value };
  }
  if (preset === "this_month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: toDateInputValue(start), to: todayValue };
  }
  const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const end = new Date(today.getFullYear(), today.getMonth(), 0);
  return { from: toDateInputValue(start), to: toDateInputValue(end) };
}

function sortEntriesNewestFirst<T extends Pick<Entry, "date" | "created_at">>(rows: T[]) {
  return [...rows].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

// Contact is appended into details as "Contact: …" — parse it back out for display & PDF.
function splitContact(details: string | null): { details: string | null; contact: string | null } {
  if (!details) return { details: null, contact: null };
  const m = details.match(/(?:^|·\s*)Contact:\s*([^·]+)\s*$/);
  if (!m) return { details, contact: null };
  const contact = m[1].trim();
  const cleaned = details.replace(/(?:\s*·\s*)?Contact:\s*[^·]+\s*$/, "").trim();
  return { details: cleaned || null, contact };
}

export default function PettyCash() {
  const { user } = useAuth();
  const initialRange = getRangeFromPreset("today");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [staffDirectory, setStaffDirectory] = useState<StaffDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [rangePreset, setRangePreset] = useState<RangePreset>("today");
  const [fromDate, setFromDate] = useState<string>(initialRange.from);
  const [toDate, setToDate] = useState<string>(initialRange.to);
  const [form, setForm] = useState({
    date: initialRange.to || toDateInputValue(),
    type: "payment" as Entry["type"],
    payee: "",
    contact: "",
    details: "",
    amount: "",
    transaction_cost: "",
    transaction_time: "",
    payment_mode: "cash",
    payment_reference: "",
  });
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPreview, setAiPreview] = useState("");
  const [aiSourceText, setAiSourceText] = useState("");
  const [aiSummary, setAiSummary] = useState("");

  const resetAiAssistant = () => {
    setAiPreview("");
    setAiSourceText("");
    setAiSummary("");
  };

  const load = async () => {
    setLoading(true);
    const [{ data, error }, { data: profiles }, { data: roles }] = await Promise.all([
      supabase
        .from("petty_cash_entries")
        .select("*")
        .order("date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, display_name, phone"),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    if (error) toast({ title: "Could not load", description: error.message, variant: "destructive" });
    else setEntries(sortPettyCashEntriesNewestFirst((data ?? []) as Entry[]));

    const roleMap = new Map<string, string[]>();
    ((roles ?? []) as StaffRoleRow[]).forEach((row) => {
      roleMap.set(row.user_id, [...(roleMap.get(row.user_id) ?? []), row.role]);
    });
    setStaffDirectory(
      ((profiles ?? []) as Array<{ id: string; display_name: string | null; phone: string | null }>)
        .map((profile) => ({
          ...profile,
          roles: roleMap.get(profile.id) ?? [],
        }))
        .filter((profile) => profile.roles.length > 0 && !profile.roles.includes("client")),
    );
    setLoading(false);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("petty-cash-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "petty_cash_entries" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const staffById = useMemo(
    () => new Map(staffDirectory.map((member) => [member.id, member])),
    [staffDirectory],
  );

  const applyRangePreset = (preset: Exclude<RangePreset, "custom">) => {
    const range = getRangeFromPreset(preset);
    setRangePreset(preset);
    setFromDate(range.from);
    setToDate(range.to);
  };

  const findMatchingStaffMember = (payee: string, contact: string) => {
    const phoneKey = normalizePhoneKey(contact);
    const nameKey = normalizeNameKey(payee);
    if (phoneKey && nameKey) {
      const exact = staffDirectory.find((member) =>
        normalizePhoneKey(member.phone) === phoneKey && normalizeNameKey(member.display_name) === nameKey,
      );
      if (exact) return exact;
    }
    if (phoneKey) {
      const byPhone = staffDirectory.find((member) => normalizePhoneKey(member.phone) === phoneKey);
      if (byPhone) return byPhone;
    }
    if (nameKey) {
      const byName = staffDirectory.find((member) => normalizeNameKey(member.display_name) === nameKey);
      if (byName) return byName;
    }
    return null;
  };

  const ensureOpeningBalanceForDate = async (targetDate: string) => {
    if (!targetDate) return null;
    const existingOpening = entries.find((entry) => entry.type === "opening_balance" && entry.date === targetDate);
    if (existingOpening) return existingOpening;

    const priorDays = buildPettyCashDailyLedger(entries).filter((day) => day.date < targetDate);
    if (priorDays.length === 0) return null;

    const lastCoveredDay = priorDays[priorDays.length - 1];
    const openingAmount = lastCoveredDay.closing;
    const lastCoveredDate = lastCoveredDay.date;

    const { data, error } = await supabase
      .from("petty_cash_entries")
      .insert({
        date: targetDate,
        type: "opening_balance",
        payee: null,
        details: `Auto opening balance carried forward from ${lastCoveredDate}`,
        amount: openingAmount,
        transaction_cost: 0,
        payment_mode: "cash",
        payment_reference: null,
        contact: null,
        transaction_time: null,
        staff_user_id: null,
      })
      .select("*")
      .single();
    if (error) throw error;
    if (data) {
      setEntries((current) => sortPettyCashEntriesNewestFirst([data as Entry, ...current]));
      return data as Entry;
    }
    return null;
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return entries.filter(e => {
      if (fromDate && e.date < fromDate) return false;
      if (toDate && e.date > toDate) return false;
      if (!q) return true;
        return (
          (e.payee ?? "").toLowerCase().includes(q) ||
          (e.details ?? "").toLowerCase().includes(q) ||
          (e.contact ?? "").toLowerCase().includes(q) ||
          (e.transaction_time ?? "").toLowerCase().includes(q) ||
          (e.payment_reference ?? "").toLowerCase().includes(q)
        );
    });
  }, [entries, search, fromDate, toDate]);
  const hasFilters = Boolean(search.trim() || fromDate || toDate);

  const totals = useMemo(
    () => calculatePettyCashRangeSummary(entries, { fromDate, toDate }),
    [entries, fromDate, toDate],
  );

  const submit = async () => {
    if (!form.amount) { toast({ title: "Amount required", variant: "destructive" }); return; }
    const normalizedAmount = Number(form.amount);
    const normalizedPaymentMode = form.type === "opening_balance" ? "cash" : String(form.payment_mode || "cash").toLowerCase();
    const normalizedPaymentReference = isMpesaMode(normalizedPaymentMode)
      ? normalizePaymentReference(form.payment_reference)
      : String(form.payment_reference ?? "").trim();
    const normalizedTransactionTime = normalizeTransactionTime(form.transaction_time);
    const matchedStaff = form.type === "payment"
      ? findMatchingStaffMember(form.payee, form.contact)
      : null;

    if (form.type !== "opening_balance") {
      try {
        await ensureOpeningBalanceForDate(form.date);
      } catch (error: any) {
        toast({ title: "Opening balance failed", description: error?.message ?? "Could not carry forward the opening balance.", variant: "destructive" });
        return;
      }
    }

    if (isMpesaMode(normalizedPaymentMode) && normalizedPaymentReference) {
      let duplicateQuery = supabase
        .from("petty_cash_entries")
        .select("id")
        .eq("payment_mode", "mpesa")
        .eq("payment_reference", normalizedPaymentReference)
        .eq("amount", normalizedAmount)
        .limit(1);

      const { data: existingDuplicate, error: duplicateLookupError } = normalizedTransactionTime
        ? await duplicateQuery.eq("transaction_time", normalizedTransactionTime).maybeSingle()
        : await duplicateQuery.is("transaction_time", null).maybeSingle();

      if (duplicateLookupError) {
        toast({ title: "Could not verify transaction", description: duplicateLookupError.message, variant: "destructive" });
        return;
      }
      if (existingDuplicate?.id) {
        toast({ title: "Transaction already exists", description: "This M-PESA transaction is already saved.", variant: "destructive" });
        return;
      }
    }

    const payload = {
      date: form.date,
      type: form.type,
      payee: form.payee || null,
      contact: form.contact || null,
      details: form.details || null,
      amount: normalizedAmount,
      transaction_cost: Number(form.transaction_cost || 0),
      transaction_time: normalizedTransactionTime || null,
      payment_mode: normalizedPaymentMode,
      payment_reference: normalizedPaymentReference || null,
      staff_user_id: matchedStaff?.id ?? null,
    };
    const { data: inserted, error } = await supabase
      .from("petty_cash_entries")
      .insert(payload)
      .select("*")
      .single();
    if (error) {
      if (isDuplicateTransactionError(error)) {
        toast({ title: "Transaction already exists", description: "This M-PESA transaction is already saved.", variant: "destructive" });
      } else {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
      }
      return;
    }
    if (inserted) {
      setEntries((current) => sortPettyCashEntriesNewestFirst([inserted as Entry, ...current]));
    }
    toast({
      title: "Entry saved",
      description: matchedStaff ? `${matchedStaff.display_name ?? matchedStaff.phone ?? "Staff member"} will be deducted automatically in payroll.` : undefined,
    });
    setOpen(false);
    setForm({
      ...form,
      payee: "",
      contact: "",
      details: "",
      amount: "",
      transaction_cost: "",
      transaction_time: "",
      payment_reference: "",
    });
    resetAiAssistant();
    await load();
  };

  const scanWithAi = async () => {
    if (!aiPreview && !aiSourceText.trim()) {
      toast({ title: "Add a screenshot or message first", variant: "destructive" });
      return;
    }

    setAiBusy(true);
    try {
      const { data, error, response } = await invokeEdgeFunction<PettyCashAISuggestion>("petty-cash-ai", {
        body: {
          images: aiPreview ? [aiPreview] : [],
          text: aiSourceText.trim(),
        },
      });
      if (error || (data as any)?.error) {
        if (isEdgeFunctionUnavailable(error, response)) {
          toast({
            title: "AI scan unavailable",
            description: "The petty cash AI helper is offline right now. You can still fill the entry manually and save it.",
            variant: "destructive",
          });
          return;
        }
        const message = (data as any)?.error
          ?? await readEdgeFunctionErrorMessage(error, response, "AI scan failed.");
        toast({ title: "AI scan failed", description: message, variant: "destructive" });
        return;
      }

      const suggestion = data ?? {};
      setAiSummary(suggestion.summary ?? "");
      setForm((current) => ({
        ...current,
        date: suggestion.transaction_date || current.date,
        type:
          suggestion.direction === "received"
            ? "topup"
            : suggestion.direction === "sent"
              ? "payment"
              : current.type,
        payee: suggestion.payee || current.payee,
        contact: suggestion.contact || current.contact,
        amount: suggestion.amount != null && Number(suggestion.amount) > 0 ? String(suggestion.amount) : current.amount,
        transaction_cost: suggestion.transaction_cost != null ? String(suggestion.transaction_cost) : current.transaction_cost,
        transaction_time: suggestion.transaction_time || current.transaction_time,
        payment_mode: suggestion.payment_mode && suggestion.payment_mode !== "unknown" ? suggestion.payment_mode : current.payment_mode,
        payment_reference: suggestion.payment_reference || current.payment_reference,
      }));
      toast({ title: "AI fields filled", description: "Add only what the payment was for, then save." });
    } finally {
      setAiBusy(false);
    }
  };

  const downloadReport = async () => {
    const target = reserveDocumentWindow();
    try {
      const reportFrom = fromDate || "All dates";
      const reportTo = toDate || "All dates";
      const pdf = await generatePettyCashReportPDF({
        from: reportFrom,
        to: reportTo,
        generated_by: user?.displayName,
        opening_balance: totals.opening,
        closing_balance: totals.balance,
        total_topups: totals.topups,
        total_payments: totals.payments,
        total_bank_charges: totals.bankCharges,
        total_payment_txn_cost: totals.paymentTxnCost,
        total_expenditure: totals.totalExpenditure,
        rows: filtered.map((entry) => {
          const parts = splitContact(entry.details);
          return {
            date: entry.date,
            transaction_time: entry.transaction_time ?? null,
            type: entry.type,
            payee: entry.payee,
            contact: entry.contact ?? parts.contact,
            details: parts.details,
            payment_mode: entry.payment_mode ?? null,
            payment_reference: entry.payment_reference ?? null,
            amount: Number(entry.amount),
            transaction_cost: Number(entry.transaction_cost || 0),
          };
        }),
      }, { mode: "blob" });
      const stored = await storeGeneratedPdfFile({
        path: `reports/petty-cash/petty-cash-${reportFrom}_to_${reportTo}.pdf`,
        pdf,
      });
      openStoredDocumentUrl(stored.url, target);
    } catch (error: any) {
      closeReservedDocumentWindow(target);
      toast({ title: "Download failed", description: error?.message ?? "Unknown error", variant: "destructive" });
    }
  };

  const legacyDownloadReport = async () => {
    try {
      await generatePettyCashReportPDF({
        from: fromDate || "—",
        to: toDate || "—",
        generated_by: user?.displayName,
        rows: filtered.map(e => {
          const parts = splitContact(e.details);
          return {
            date: e.date,
            transaction_time: e.transaction_time ?? null,
            type: e.type,
            payee: e.payee,
            contact: e.contact ?? parts.contact,
            details: parts.details,
            payment_mode: e.payment_mode ?? null,
            payment_reference: e.payment_reference ?? null,
            amount: Number(e.amount),
            transaction_cost: Number(e.transaction_cost || 0),
          };
        }),
      });
    } catch (err: any) {
      toast({ title: "Download failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Petty Cash Book</h1>
          <p className="text-sm text-muted-foreground">Daily cash in / cash out · transaction costs tracked</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setOpen(true)}>
            <Sparkles className="h-4 w-4 mr-2" /> Scan with AI
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-primary"><Plus className="h-4 w-4 mr-2" />New entry</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>New petty cash entry</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="rounded-md border bg-muted/20 p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Fill with AI</p>
                    <p className="text-xs text-muted-foreground">Upload an M-PESA screenshot, payment photo, or paste the message text and we’ll fill the details.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={resetAiAssistant} disabled={aiBusy}>
                      <RefreshCw className="h-3.5 w-3.5 mr-2" /> Refresh
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={scanWithAi} disabled={aiBusy}>
                      {aiBusy ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-2" />}
                      {aiBusy ? "Scanning..." : "Scan with AI"}
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-[120px,1fr]">
                  <div className="space-y-2">
                    <Label>Screenshot</Label>
                    <div className="flex flex-col gap-2">
                      <CameraInput
                        size="sm"
                        label="Add image"
                        onPick={(_, preview) => setAiPreview(preview)}
                      />
                      {aiPreview ? (
                        <img src={aiPreview} alt="Payment scan preview" className="h-24 w-full rounded-md border object-cover" />
                      ) : (
                        <div className="flex h-24 items-center justify-center rounded-md border border-dashed text-[11px] text-muted-foreground">
                          No image yet
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Message text (optional)</Label>
                    <Textarea
                      rows={4}
                      value={aiSourceText}
                      onChange={e => setAiSourceText(e.target.value)}
                      placeholder="Paste the M-PESA or bank message here if you have it as text."
                    />
                    {aiSummary && <p className="text-xs text-muted-foreground">AI summary: {aiSummary}</p>}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div><Label>Date</Label><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
                <div><Label>Time</Label><Input value={form.transaction_time} onChange={e => setForm({ ...form, transaction_time: e.target.value })} placeholder="e.g. 08:43 AM" /></div>
                <div>
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(v: Entry["type"]) => setForm({ ...form, type: v, payee: "", details: "", transaction_cost: "", transaction_time: form.transaction_time })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="opening_balance">Opening balance</SelectItem>
                      <SelectItem value="topup">Top-up (cash in)</SelectItem>
                      <SelectItem value="payment">Payment (cash out)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {form.type === "opening_balance" && (
                <>
                  <p className="text-xs text-muted-foreground -mt-1">
                    Set the cash in the box at the start of the period. No payee or transaction cost needed.
                  </p>
                  <div><Label>Notes (optional)</Label><Textarea value={form.details} onChange={e => setForm({ ...form, details: e.target.value })} placeholder="e.g. Opening balance for May 2026" rows={2} /></div>
                  <div><Label>Opening amount (KSh)</Label><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
                </>
              )}

              {form.type === "topup" && (
                <>
                  <p className="text-xs text-muted-foreground -mt-1">
                    Cash being added to the petty cash float (e.g. from bank, M-PESA, owner top-up).
                  </p>
                  <div><Label>Source</Label><Input value={form.payee} onChange={e => setForm({ ...form, payee: e.target.value })} placeholder="e.g. M-PESA, Bank withdrawal, Owner" /></div>
                  <div><Label>Contact (phone)</Label><Input value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} placeholder="e.g. 0710 723529" /></div>
                  <div><Label>Reference / details</Label><Textarea value={form.details} onChange={e => setForm({ ...form, details: e.target.value })} rows={2} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Amount (KSh)</Label><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
                    <div><Label>Transaction cost</Label><Input type="number" value={form.transaction_cost} onChange={e => setForm({ ...form, transaction_cost: e.target.value })} placeholder="0" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Mode of payment</Label>
                      <Select value={form.payment_mode} onValueChange={v => setForm({ ...form, payment_mode: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="mpesa">M-PESA</SelectItem>
                          <SelectItem value="bank">Bank transfer</SelectItem>
                          <SelectItem value="card">Card</SelectItem>
                          <SelectItem value="cheque">Cheque</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>Payment reference</Label><Input value={form.payment_reference} onChange={e => setForm({ ...form, payment_reference: e.target.value })} placeholder="M-Pesa code, cheque #" /></div>
                  </div>
                </>
              )}

              {form.type === "payment" && (
                <>
                  <div><Label>Payee</Label><Input value={form.payee} onChange={e => setForm({ ...form, payee: e.target.value })} placeholder="e.g. Ester Ndungu" /></div>
                  <div><Label>Contact (phone)</Label><Input value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} placeholder="e.g. 0712 345678" /></div>
                  <div><Label>What was paid for</Label><Textarea value={form.details} onChange={e => setForm({ ...form, details: e.target.value })} rows={2} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Amount (KSh)</Label><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
                    <div><Label>Transaction cost</Label><Input type="number" value={form.transaction_cost} onChange={e => setForm({ ...form, transaction_cost: e.target.value })} placeholder="0" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Mode of payment</Label>
                      <Select value={form.payment_mode} onValueChange={v => setForm({ ...form, payment_mode: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="mpesa">M-PESA</SelectItem>
                          <SelectItem value="bank">Bank transfer</SelectItem>
                          <SelectItem value="card">Card</SelectItem>
                          <SelectItem value="cheque">Cheque</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>Payment reference</Label><Input value={form.payment_reference} onChange={e => setForm({ ...form, payment_reference: e.target.value })} placeholder="M-Pesa code, cheque #" /></div>
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit} className="bg-gradient-primary">Save entry</Button>
            </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="border-dashed bg-muted/20 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium">Upload with AI</p>
            <p className="text-xs text-muted-foreground">
              Add an M-PESA screenshot, payment proof photo, or pasted message and the system will read the payee, phone, amount, cost, time, and reference for you.
            </p>
          </div>
          <Button variant="outline" onClick={() => setOpen(true)}>
            <Sparkles className="h-4 w-4 mr-2" /> Open AI payment scan
          </Button>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground"><Wallet className="h-3.5 w-3.5" />Cash balance</div>
          <p className={`mt-1 text-2xl font-bold ${totals.balance < 0 ? "text-destructive" : ""}`}>{fmt(totals.balance)}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground"><Wallet className="h-3.5 w-3.5" />Opening balance</div>
          <p className="mt-1 text-2xl font-bold">{fmt(totals.opening)}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground"><ArrowUpCircle className="h-3.5 w-3.5" />Top-ups (cash in)</div>
          <p className="mt-1 text-2xl font-bold">{fmt(totals.topups)}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground"><TrendingDown className="h-3.5 w-3.5" />Payments</div>
          <p className="mt-1 text-2xl font-bold">{fmt(totals.payments)}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground"><TrendingDown className="h-3.5 w-3.5" />Bank / txn charges</div>
          <p className="mt-1 text-2xl font-bold">{fmt(totals.txnCost)}</p>
          <p className="text-[11px] text-muted-foreground">bank {fmt(totals.bankCharges)} · pay {fmt(totals.paymentTxnCost)}</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-2">
          <Button variant={rangePreset === "today" ? "default" : "outline"} onClick={() => applyRangePreset("today")}>Today</Button>
          <Button variant={rangePreset === "yesterday" ? "default" : "outline"} onClick={() => applyRangePreset("yesterday")}>Yesterday</Button>
          <Button variant={rangePreset === "this_month" ? "default" : "outline"} onClick={() => applyRangePreset("this_month")}>This month</Button>
          <Button variant={rangePreset === "last_month" ? "default" : "outline"} onClick={() => applyRangePreset("last_month")}>Last month</Button>
          <Button variant={rangePreset === "all" ? "default" : "outline"} onClick={() => applyRangePreset("all")}>All</Button>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search payee, contact, ref…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div>
          <Label className="text-xs">From</Label>
          <Input type="date" value={fromDate} onChange={e => { setRangePreset("custom"); setFromDate(e.target.value); }} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input type="date" value={toDate} onChange={e => { setRangePreset("custom"); setToDate(e.target.value); }} className="w-40" />
        </div>
        <Button variant="outline" onClick={() => { applyRangePreset("all"); setSearch(""); }}>Clear</Button>
        <Button onClick={downloadReport} className="bg-gradient-primary ml-auto">
          <Download className="h-4 w-4 mr-2" />Download report
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {hasFilters ? `Showing ${filtered.length} of ${entries.length} entries.` : `Showing all ${entries.length} entries.`} Leave the date filters blank to see the full petty cash book.
      </p>

      <Card>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-muted-foreground">
              <th className="p-3">Date</th>
              <th className="p-3">Type</th>
              <th className="p-3">Payee</th>
              <th className="p-3">Contact</th>
              <th className="p-3">Details</th>
              <th className="p-3">Mode</th>
              <th className="p-3 text-right">Amount</th>
              <th className="p-3 text-right">Txn cost</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">{entries.length === 0 ? "No entries" : "No entries match the current search/date filters."}</td></tr>
            ) : filtered.map(e => {
              const parts = splitContact(e.details);
              const contact = e.contact ?? parts.contact;
              return (
              <tr key={e.id} className="border-b last:border-0 hover:bg-muted/40">
                <td className="p-3 text-muted-foreground">
                  <div>{e.date}</div>
                  {e.transaction_time ? <div className="text-[11px]">{e.transaction_time}</div> : null}
                </td>
                <td className="p-3">
                  {e.type === "payment" && <Badge variant="secondary">Payment</Badge>}
                  {e.type === "opening_balance" && <Badge className="bg-status-diagnosed text-primary-foreground">Opening</Badge>}
                  {e.type === "topup" && <Badge className="bg-gradient-primary text-primary-foreground">Top-up</Badge>}
                </td>
                <td className="p-3 font-medium">{e.payee ?? "—"}</td>
                <td className="p-3 font-mono text-xs text-muted-foreground">
                  {contact ?? "—"}
                  {e.staff_user_id ? (
                    <div className="mt-1 text-[10px] uppercase text-primary">
                      Payroll advance · {staffById.get(e.staff_user_id)?.display_name ?? "Staff"}
                    </div>
                  ) : null}
                </td>
                <td className="p-3 text-muted-foreground">{parts.details ?? "—"}</td>
                <td className="p-3 text-xs uppercase text-muted-foreground">
                  {e.payment_mode ?? "—"}
                  {e.payment_reference ? <div className="font-mono text-[10px] normal-case">{e.payment_reference}</div> : null}
                </td>
                <td className={`p-3 text-right font-bold ${e.type === "payment" ? "text-destructive" : ""}`}>
                  {e.type === "payment" ? "-" : "+"}{fmt(Number(e.amount))}
                </td>
                <td className="p-3 text-right text-muted-foreground">{e.transaction_cost ? fmt(Number(e.transaction_cost)) : "—"}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </Card>
    </div>
  );
}
