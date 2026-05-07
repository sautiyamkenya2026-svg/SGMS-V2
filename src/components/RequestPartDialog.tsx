import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Search, Package, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { buildIdempotencyFingerprint, clearIdempotencyRequestId, getIdempotencyRequestId } from "@/lib/idempotency";

type Part = { id: string; sku: string; name: string; category: string | null; unit_price: number };

export function RequestPartDialog({
  open, onOpenChange, jobId, jobLabel, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jobId: string;
  jobLabel?: string;
  onCreated?: () => void;
}) {
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Part | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [customName, setCustomName] = useState("");
  const [qty, setQty] = useState("1");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(null); setCustomMode(false); setCustomName("");
    setSearch(""); setQty("1"); setNotes("");
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("parts")
        .select("id, sku, name, category, unit_price")
        .order("name", { ascending: true })
        .limit(500);
      if (error) toast.error(error.message);
      else setParts((data ?? []) as Part[]);
      setLoading(false);
    })();
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return parts.slice(0, 60);
    const q = search.toLowerCase();
    return parts.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      (p.category ?? "").toLowerCase().includes(q),
    ).slice(0, 80);
  }, [parts, search]);

  const submit = async () => {
    const item_name = customMode ? customName.trim() : selected?.name;
    if (!item_name) { toast.error("Pick a part or enter a custom name"); return; }
    const q = Number(qty);
    if (!q || q < 1) { toast.error("Quantity must be at least 1"); return; }
    const requestFingerprint = buildIdempotencyFingerprint([
      jobId,
      item_name,
      q,
      notes,
      customMode ? "custom" : selected?.id ?? "",
    ]);
    const requestId = getIdempotencyRequestId("part-request-dialog", requestFingerprint);
    setSubmitting(true);
    const { error } = await supabase.from("part_requests").upsert({
      job_id: jobId,
      kind: "part",
      item_name,
      qty: q,
      notes: notes || (jobLabel ? `For ${jobLabel}` : null),
      status: "pending",
      client_request_id: requestId,
    } as any, { onConflict: "client_request_id" });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    clearIdempotencyRequestId("part-request-dialog", requestFingerprint);
    toast.success("Part request sent to reception");
    onOpenChange(false);
    onCreated?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />Request a part
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {!customMode ? (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  placeholder="Search by name, SKU or category…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              <div className="border rounded-md max-h-64 overflow-y-auto divide-y">
                {loading ? (
                  <div className="p-4 text-sm text-muted-foreground text-center">Loading parts…</div>
                ) : filtered.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground text-center">
                    No matches. <button className="underline" onClick={() => { setCustomMode(true); setCustomName(search); }}>Request as custom item</button>
                  </div>
                ) : filtered.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelected(p)}
                    className={`w-full text-left p-2.5 hover:bg-muted/60 transition flex items-center justify-between gap-3 ${selected?.id === p.id ? "bg-primary/10" : ""}`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{p.sku}{p.category ? ` · ${p.category}` : ""}</div>
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                      KSh {Number(p.unit_price).toLocaleString()}
                    </div>
                  </button>
                ))}
              </div>

              <button type="button" onClick={() => setCustomMode(true)} className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
                <Plus className="h-3 w-3" />Can't find it? Request a custom item
              </button>
            </>
          ) : (
            <div>
              <Label>Custom item name</Label>
              <Input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="e.g. Brake pads (rear) — Toyota Premio" autoFocus />
              <button type="button" onClick={() => setCustomMode(false)} className="text-xs text-primary mt-2 hover:underline">
                ← Back to inventory search
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <Label>Quantity</Label>
              <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="urgent, brand pref…" />
            </div>
          </div>

          {selected && !customMode && (
            <div className="text-xs text-muted-foreground">
              Selected: <span className="font-medium text-foreground">{selected.name}</span> ({selected.sku})
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={submitting} className="bg-gradient-primary">
            {submitting ? "Sending…" : "Send request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
