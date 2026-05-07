import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CameraInput } from "@/components/CameraInput";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Search, AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, RefreshCw, Plus, Sparkles, Loader2, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { friendlyErrorMessage } from "@/lib/app-error";
import { canSeeCostPrices } from "@/lib/permissions";
import { toast } from "@/hooks/use-toast";
import { isEdgeFunctionUnavailable, readEdgeFunctionErrorMessage } from "@/lib/edge-function-error";
import { invokeEdgeFunction } from "@/lib/invoke-edge";

type Location = { id: string; name: string; kind: string };
type Part = { id: string; sku: string; name: string; unit_cost: number; unit_price: number; min_stock: number; category: string | null };
type Job = { id: string; job_no: string; plate: string };
type Stock = { part_id: string; location_id: string; qty: number };
type Daily = { part_id: string; location_id: string; opening: number; additional: number; sales: number };

type Row = Part & {
  qty: number;
  opening: number;
  additional: number;
  sales: number;
  total: number;
  closing: number;
};

type MovementType = "restock" | "sale" | "transfer_out";
type StockAiSuggestion = {
  name?: string;
  sku?: string;
  category?: string;
  qty?: number;
  unit_cost?: number;
  unit_price?: number;
  min_stock?: number;
  notes?: string;
  confidence?: number;
};

export default function Stock() {
  const { user, hasRole } = useAuth();
  const canEdit = hasRole("admin") || hasRole("storekeeper") || hasRole("super_admin");
  const showCost = canSeeCostPrices(user as any);

  const [locations, setLocations] = useState<Location[]>([]);
  const [activeLoc, setActiveLoc] = useState<string>("");
  const [parts, setParts] = useState<Part[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [daily, setDaily] = useState<Daily[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const [dialog, setDialog] = useState<null | { type: MovementType; part: Part }>(null);
  const [addPartOpen, setAddPartOpen] = useState(false);
  const [editPart, setEditPart] = useState<Part | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  const loadAll = async () => {
    setLoading(true);
    const [{ data: locs }, { data: pts }, { data: activeJobs }, { data: st }, { data: dl }] = await Promise.all([
      supabase.from("locations").select("id, name, kind").order("name"),
      supabase.from("parts").select("id, sku, name, unit_cost, unit_price, min_stock, category").order("name"),
      supabase.from("jobs").select("id, job_no, plate").in("status", ["diagnosis","diagnosed","diagnosis_approval","parts","parts_approval","repair","awaiting_approval","completed"]).order("created_at", { ascending: false }).limit(200),
      supabase.from("part_stock").select("part_id, location_id, qty"),
      supabase.from("stock_daily").select("part_id, location_id, opening, additional, sales").eq("day", today),
    ]);
    setLocations(locs ?? []);
    setParts(pts ?? []);
    setJobs((activeJobs ?? []) as Job[]);
    setStocks(st ?? []);
    setDaily(dl ?? []);
    if (!activeLoc && locs?.length) setActiveLoc(locs[0].id);
    setLoading(false);
  };

  useEffect(() => { loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const rows: Row[] = useMemo(() => {
    return parts
      .map((p) => {
        const s = stocks.find((x) => x.part_id === p.id && x.location_id === activeLoc);
        const d = daily.find((x) => x.part_id === p.id && x.location_id === activeLoc);
        const closing = s?.qty ?? 0;
        const opening = d?.opening ?? closing; // if no movement yet today, opening == current
        const additional = d?.additional ?? 0;
        const sales = d?.sales ?? 0;
        return {
          ...p,
          qty: closing,
          opening,
          additional,
          sales,
          total: opening + additional,
          closing,
        };
      })
      .filter((r) => {
        const q = search.toLowerCase().trim();
        if (!q) return true;
        return r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q);
      });
  }, [parts, stocks, daily, activeLoc, search]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.opening += r.opening;
        acc.additional += r.additional;
        acc.sales += r.sales;
        acc.closing += r.closing;
        acc.value += r.closing * Number(r.unit_price);
        if (r.closing < r.min_stock) acc.lowCount += 1;
        return acc;
      },
      { opening: 0, additional: 0, sales: 0, closing: 0, value: 0, lowCount: 0 },
    );
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stock</h1>
          <p className="text-sm text-muted-foreground">
            Daily stock card · opening, additional, total, sales & closing — per location
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <>
              <Button size="sm" variant="outline" onClick={() => setAddPartOpen(true)}>
                <Sparkles className="h-4 w-4 mr-2" /> Upload with AI
              </Button>
              <Button size="sm" className="bg-gradient-primary" onClick={() => setAddPartOpen(true)}>
                <Plus className="h-4 w-4 mr-2" /> Add Stock
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={loadAll} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {canEdit && (
        <Card className="border-dashed bg-muted/20 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium">Upload with AI</p>
              <p className="text-xs text-muted-foreground">
                Capture a part, label, shelf tag, or receipt and we’ll prefill the stock form for you.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setAddPartOpen(true)}>
              <Sparkles className="h-4 w-4 mr-2" /> Open AI stock scan
            </Button>
          </div>
        </Card>
      )}

      {/* Location switcher */}
      <Tabs value={activeLoc} onValueChange={setActiveLoc}>
        <TabsList>
          {locations.map((l) => (
            <TabsTrigger key={l.id} value={l.id}>
              {l.name}
              <Badge variant="secondary" className="ml-2 text-[10px] capitalize">
                {l.kind.replace("_", " ")}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="p-4"><p className="text-xs text-muted-foreground">Opening (today)</p><p className="text-2xl font-bold">{totals.opening}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Additional</p><p className="text-2xl font-bold text-status-completed">+{totals.additional}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Sales / Issued</p><p className="text-2xl font-bold text-destructive">−{totals.sales}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Closing</p><p className="text-2xl font-bold">{totals.closing}</p></Card>
        {showCost && (
          <Card className="p-4"><p className="text-xs text-muted-foreground">Stock value</p><p className="text-2xl font-bold">KSh {totals.value.toLocaleString()}</p>{totals.lowCount > 0 && <p className="text-[11px] text-destructive mt-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{totals.lowCount} low</p>}</Card>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search by name or SKU…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* Daily stock card table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground bg-muted/30">
                <th className="p-3">Part</th>
                <th className="p-3">SKU</th>
                <th className="p-3 text-right">Opening</th>
                <th className="p-3 text-right">Additional</th>
                <th className="p-3 text-right">Total</th>
                <th className="p-3 text-right">Sales</th>
                <th className="p-3 text-right">Closing</th>
                <th className="p-3 text-right">Min</th>
                <th className="p-3 text-right">Status</th>
                {canEdit && <th className="p-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={canEdit ? 10 : 9} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={canEdit ? 10 : 9} className="p-6 text-center text-muted-foreground">No parts.</td></tr>
              )}
              {rows.map((r) => {
                const low = r.closing < r.min_stock;
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="p-3 font-medium">{r.name}</td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">{r.sku}</td>
                    <td className="p-3 text-right">{r.opening}</td>
                    <td className="p-3 text-right text-status-completed">{r.additional ? `+${r.additional}` : "—"}</td>
                    <td className="p-3 text-right font-medium">{r.total}</td>
                    <td className="p-3 text-right text-destructive">{r.sales ? `−${r.sales}` : "—"}</td>
                    <td className="p-3 text-right font-bold">{r.closing}</td>
                    <td className="p-3 text-right text-muted-foreground">{r.min_stock}</td>
                    <td className="p-3 text-right">
                      {low ? (
                        <Badge className="bg-destructive text-destructive-foreground"><AlertTriangle className="h-3 w-3 mr-1" />Low</Badge>
                      ) : (
                        <Badge variant="secondary">OK</Badge>
                      )}
                    </td>
                    {canEdit && (
                      <td className="p-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="outline" size="sm" onClick={() => setEditPart(r)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setDialog({ type: "restock", part: r })}>
                            <ArrowDownToLine className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setDialog({ type: "sale", part: r })}>
                            <ArrowUpFromLine className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setDialog({ type: "transfer_out", part: r })}>
                            <ArrowLeftRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {!canEdit && user && (
        <p className="text-xs text-muted-foreground">
          You're signed in as <span className="capitalize font-medium">{user.roles[0] ?? "user"}</span>. Only admins and storekeepers can record stock movements.
        </p>
      )}

      {dialog && (
        <MovementDialog
          open
          onClose={() => setDialog(null)}
          type={dialog.type}
          part={dialog.part}
          fromLocation={activeLoc}
          locations={locations}
          jobs={jobs}
          onDone={loadAll}
        />
      )}

      {addPartOpen && (
        <AddPartDialog
          open
          onClose={() => setAddPartOpen(false)}
          locationId={activeLoc}
          onDone={loadAll}
        />
      )}

      {editPart && (
        <EditPartDialog
          open
          part={editPart}
          onClose={() => setEditPart(null)}
          onDone={loadAll}
        />
      )}
    </div>
  );
}

function AddPartDialog({ open, onClose, locationId, onDone }: {
  open: boolean; onClose: () => void; locationId: string; onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [minStock, setMinStock] = useState("0");
  const [openingQty, setOpeningQty] = useState("0");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPreview, setAiPreview] = useState("");
  const [aiNotes, setAiNotes] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState<StockAiSuggestion | null>(null);

  const resetAiFields = () => {
    setAiPreview("");
    setAiNotes("");
    setAiSuggestion(null);
  };

  const analyseWithAi = async () => {
    if (!aiPreview && !aiNotes.trim()) {
      toast({ title: "Add a photo or notes first", variant: "destructive" });
      return;
    }

    setAiBusy(true);
    try {
      const { data, error, response } = await invokeEdgeFunction<StockAiSuggestion>("stock-intake-ai", {
        body: {
          images: aiPreview ? [aiPreview] : [],
          text: aiNotes.trim(),
        },
      });
      if (error || (data as any)?.error) {
        if (isEdgeFunctionUnavailable(error, response)) {
          toast({
            title: "AI scan unavailable",
            description: "The stock AI helper is offline right now. You can still key the stock intake manually.",
            variant: "destructive",
          });
          return;
        }
        const message = (data as any)?.error
          ?? await readEdgeFunctionErrorMessage(error, response, "AI scan failed.");
        toast({ title: "AI scan failed", description: friendlyErrorMessage(message, "AI scan failed."), variant: "destructive" });
        return;
      }

      const suggestion = data ?? {};
      setAiSuggestion(suggestion);
      if (suggestion.name) setName(suggestion.name);
      if (suggestion.sku) setSku(suggestion.sku);
      if (suggestion.category) setCategory(suggestion.category);
      if (Number(suggestion.unit_cost || 0) > 0) setUnitCost(String(suggestion.unit_cost));
      if (Number(suggestion.unit_price || 0) > 0) setUnitPrice(String(suggestion.unit_price));
      if (suggestion.min_stock != null) setMinStock(String(suggestion.min_stock));
      if (Number(suggestion.qty || 0) > 0) setOpeningQty(String(suggestion.qty));
      toast({ title: "AI fields filled", description: "Review the values before saving." });
    } finally {
      setAiBusy(false);
    }
  };

  const submit = async () => {
    if (!name.trim() || !sku.trim()) {
      toast({ title: "Name and SKU are required", variant: "destructive" });
      return;
    }
    const qty = Number(openingQty || 0);
    if (qty > 0 && !locationId) {
      toast({ title: "Pick a stock location first", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { data: part, error } = await supabase
      .from("parts")
      .insert({
        name: name.trim(),
        sku: sku.trim(),
        category: category || null,
        unit_cost: Number(unitCost || 0),
        unit_price: Number(unitPrice || 0),
        min_stock: Number(minStock || 0),
      })
      .select()
      .single();
    if (error || !part) {
      setBusy(false);
      toast({ title: "Failed", description: friendlyErrorMessage(error, "Could not add that part."), variant: "destructive" });
      return;
    }
    if (qty > 0 && locationId) {
      const { data: { user } } = await supabase.auth.getUser();
      const { error: movementError } = await supabase.from("stock_movements").insert({
        part_id: part.id,
        location_id: locationId,
        type: "restock",
        qty,
        unit_price: Number(unitCost || 0),
        buy_price: Number(unitCost || 0),
        sell_price: Number(unitPrice || 0),
        reference: "Initial stock",
        created_by: user?.id ?? null,
      });
      if (movementError) {
        setBusy(false);
        toast({
          title: "Part created but stock was not added",
          description: friendlyErrorMessage(movementError, "The part was created, but the opening stock could not be added."),
          variant: "destructive",
        });
        return;
      }
    }
    setBusy(false);
    toast({ title: "Part added", description: `${name} created with ${qty} in stock.` });
    resetAiFields();
    onDone();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add new part / stock</DialogTitle>
          <DialogDescription>Register a new part and its opening quantity at this location.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="rounded-md border bg-muted/20 p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Fill with AI</p>
                <p className="text-xs text-muted-foreground">Capture a part, label, shelf tag, or receipt and we'll prefill the stock row.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={resetAiFields} disabled={aiBusy}>
                  <RefreshCw className="h-3.5 w-3.5 mr-2" /> Refresh
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={analyseWithAi} disabled={aiBusy}>
                  {aiBusy ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-2" />}
                  {aiBusy ? "Scanning..." : "Scan with AI"}
                </Button>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-[120px,1fr]">
              <div className="space-y-2">
                <Label>Photo</Label>
                <div className="flex flex-col gap-2">
                  <CameraInput
                    size="sm"
                    label="Add photo"
                    onPick={(_, preview) => setAiPreview(preview)}
                  />
                  {aiPreview ? (
                    <img src={aiPreview} alt="Stock scan preview" className="h-24 w-full rounded-md border object-cover" />
                  ) : (
                    <div className="flex h-24 items-center justify-center rounded-md border border-dashed text-[11px] text-muted-foreground">
                      No photo yet
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Extra notes (optional)</Label>
                <Textarea
                  rows={4}
                  value={aiNotes}
                  onChange={(e) => setAiNotes(e.target.value)}
                  placeholder="Optional hint, for example supplier name, receipt note, or what item you want extracted."
                />
                {aiSuggestion?.notes && (
                  <p className="text-xs text-muted-foreground">
                    AI note: {aiSuggestion.notes}
                    {typeof aiSuggestion.confidence === "number" ? ` · confidence ${Math.round(aiSuggestion.confidence * 100)}%` : ""}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Part name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Brake pad - front" /></div>
            <div><Label>SKU</Label><Input value={sku} onChange={e => setSku(e.target.value)} placeholder="BP-F-001" /></div>
          </div>
          <div><Label>Category</Label><Input value={category} onChange={e => setCategory(e.target.value)} placeholder="Brakes" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Buy price (cost)</Label><Input type="number" value={unitCost} onChange={e => setUnitCost(e.target.value)} /></div>
            <div><Label>Sell price</Label><Input type="number" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Min stock alert</Label><Input type="number" value={minStock} onChange={e => setMinStock(e.target.value)} /></div>
            <div><Label>Opening quantity</Label><Input type="number" value={openingQty} onChange={e => setOpeningQty(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy} className="bg-gradient-primary">{busy ? "Saving…" : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditPartDialog({ open, part, onClose, onDone }: {
  open: boolean;
  part: Part;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(part.name);
  const [sku, setSku] = useState(part.sku);
  const [category, setCategory] = useState(part.category ?? "");
  const [unitCost, setUnitCost] = useState(String(part.unit_cost ?? 0));
  const [unitPrice, setUnitPrice] = useState(String(part.unit_price ?? 0));
  const [minStock, setMinStock] = useState(String(part.min_stock ?? 0));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(part.name);
    setSku(part.sku);
    setCategory(part.category ?? "");
    setUnitCost(String(part.unit_cost ?? 0));
    setUnitPrice(String(part.unit_price ?? 0));
    setMinStock(String(part.min_stock ?? 0));
  }, [part]);

  const submit = async () => {
    if (!name.trim() || !sku.trim()) {
      toast({ title: "Name and SKU are required", variant: "destructive" });
      return;
    }

    setBusy(true);
    const { error } = await supabase
      .from("parts")
      .update({
        name: name.trim(),
        sku: sku.trim(),
        category: category.trim() || null,
        unit_cost: Number(unitCost || 0),
        unit_price: Number(unitPrice || 0),
        min_stock: Number(minStock || 0),
      })
      .eq("id", part.id);
    setBusy(false);

    if (error) {
      toast({
        title: "Update failed",
        description: friendlyErrorMessage(error, "Could not update this part."),
        variant: "destructive",
      });
      return;
    }

    toast({ title: "Part updated", description: `${name.trim()} was saved.` });
    onDone();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit part details</DialogTitle>
          <DialogDescription>Correct a name, SKU, category, or price without creating a new stock row.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Part name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>SKU</Label>
              <Input value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Category</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Buy price</Label>
              <Input type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
            </div>
            <div>
              <Label>Sell price</Label>
              <Input type="number" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Min stock alert</Label>
            <Input type="number" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy} className="bg-gradient-primary">
            {busy ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MovementDialog({
  open, onClose, type, part, fromLocation, locations, jobs, onDone,
}: {
  open: boolean;
  onClose: () => void;
  type: MovementType;
  part: Part;
  fromLocation: string;
  locations: Location[];
  jobs: Job[];
  onDone: () => void;
}) {
  const [qty, setQty] = useState("1");
  const [unitPrice, setUnitPrice] = useState(String(type === "restock" ? part.unit_cost : part.unit_price));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [jobId, setJobId] = useState("");
  const [toLocation, setToLocation] = useState<string>(locations.find((l) => l.id !== fromLocation)?.id ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setUnitPrice(String(type === "restock" ? part.unit_cost : part.unit_price));
    setJobId("");
    setReference("");
    setNote("");
  }, [part.id, part.unit_cost, part.unit_price, type]);

  const titles: Record<MovementType, string> = {
    restock: "Restock / Add stock",
    sale: "Record sale / issue",
    transfer_out: "Transfer to another location",
  };
  const descriptions: Record<MovementType, string> = {
    restock: "Adds quantity to this location and logs as 'additional' on today's stock card.",
    sale: "Reduces stock and logs as 'sales' on today's stock card. Use for both shop sales and parts issued to job cards.",
    transfer_out: "Moves stock from this location to another. Updates both daily cards.",
  };

  const submit = async () => {
    const q = parseInt(qty, 10);
    if (!q || q <= 0) {
      toast({ title: "Invalid quantity", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const baseRow = {
      part_id: part.id,
      qty: q,
      unit_price: unitPrice ? Number(unitPrice) : null,
      job_id: type === "sale" && jobId ? jobId : null,
      reference: reference || null,
      note: note || null,
      created_by: user?.id ?? null,
    };

    let error: string | null = null;
    if (type === "transfer_out") {
      if (!toLocation || toLocation === fromLocation) {
        toast({ title: "Pick a destination location", variant: "destructive" });
        setBusy(false);
        return;
      }
      const out = await supabase.from("stock_movements").insert({
        ...baseRow, location_id: fromLocation, type: "transfer_out",
      });
      const inn = out.error ? null : await supabase.from("stock_movements").insert({
        ...baseRow, location_id: toLocation, type: "transfer_in",
      });
      error = out.error?.message ?? inn?.error?.message ?? null;
    } else {
      const r = await supabase.from("stock_movements").insert({
        ...baseRow,
        location_id: fromLocation,
        type,
        buy_price: type === "sale" ? Number(part.unit_cost || 0) : Number(unitPrice || 0),
        sell_price: type === "sale" ? Number(unitPrice || 0) : Number(part.unit_price || 0),
      });
      error = r.error?.message ?? null;
    }

    setBusy(false);
    if (error) {
      toast({ title: "Failed", description: friendlyErrorMessage(error, "Could not save that stock movement."), variant: "destructive" });
    } else {
      toast({ title: "Saved", description: `${titles[type]} recorded.` });
      onDone();
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titles[type]}</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{part.name}</span> · {part.sku}
            <br />
            <span className="text-xs">{descriptions[type]}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid gap-2">
            <Label>Quantity</Label>
            <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          {type !== "transfer_out" && (
            <div className="grid gap-2">
              <Label>Unit {type === "restock" ? "cost" : "price"} (KSh)</Label>
              <Input type="number" min={0} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            </div>
          )}
          {type === "transfer_out" && (
            <div className="grid gap-2">
              <Label>Destination</Label>
              <Select value={toLocation} onValueChange={setToLocation}>
                <SelectTrigger><SelectValue placeholder="Pick location" /></SelectTrigger>
                <SelectContent>
                  {locations.filter((l) => l.id !== fromLocation).map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {type === "sale" && (
            <div className="grid gap-2">
              <Label>Link to job (optional)</Label>
              <Select value={jobId || "none"} onValueChange={(value) => setJobId(value === "none" ? "" : value)}>
                <SelectTrigger><SelectValue placeholder="Pick job card" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No linked job</SelectItem>
                  {jobs.map((job) => (
                    <SelectItem key={job.id} value={job.id}>{job.job_no} - {job.plate}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-2">
            <Label>Reference {type === "sale" && "(Job # or invoice)"}</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={type === "sale" ? "JOB-0444" : "Supplier invoice #"} />
          </div>
          <div className="grid gap-2">
            <Label>Note</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy} className="bg-gradient-primary">
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
