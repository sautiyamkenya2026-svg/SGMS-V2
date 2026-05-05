import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ArrowLeft, Bluetooth, CheckCircle2, ClipboardList, Cpu, Loader2, Plug, Sparkles, X, Wrench, Disc, Zap, Car } from "lucide-react";
import { CameraInput } from "@/components/CameraInput";
import { toast } from "sonner";
import { INSPECTION_TREE, INSPECTION_CATEGORIES, type Finding, type FindingStatus, type Severity, type InspectionCategory } from "@/lib/inspection-tree";
import {
  connectSerial, connectBluetooth, fullScan,
  isWebBluetoothSupported, isWebSerialSupported,
  type DtcCode, type ObdConnection, type ScanResult,
} from "@/lib/obd-elm327";

interface Props {
  jobId: string;
  plate: string;
  vehicle: string;
  onClose: () => void;
  onFinished: (summary: { findings: Finding[]; codes: DtcCode[] }) => void;
  onAutoDiagnosed?: () => void; // called when wizard saves the first findings, to move job → diagnosed
}

type Mode = "choose" | "category" | "manual" | "obd" | "summary";
type ObdStage = "pick-transport" | "connecting" | "ready" | "scanning" | "done" | "error";

export function InspectionWizard({ jobId, plate, vehicle, onClose, onFinished, onAutoDiagnosed }: Props) {
  const [inspectionId, setInspectionId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("choose");
  const [doBoth, setDoBoth] = useState(false);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [codes, setCodes] = useState<DtcCode[]>([]);
  const [activeCategory, setActiveCategory] = useState<InspectionCategory["key"] | null>(null);
  const [activeSystem, setActiveSystem] = useState(INSPECTION_TREE[0].key);

  // Real OBD state
  const [obdStage, setObdStage] = useState<ObdStage>("pick-transport");
  const [obdError, setObdError] = useState<string | null>(null);
  const [conn, setConn] = useState<ObdConnection | null>(null);
  const [scanLog, setScanLog] = useState<string[]>([]);
  const [scanInfo, setScanInfo] = useState<Pick<ScanResult, "vin" | "voltage" | "protocol"> | null>(null);

  // Create inspection row when wizard opens
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("inspections")
        .insert({ job_ref: jobId, plate, vehicle })
        .select()
        .single();
      if (error) { toast.error("Could not start inspection: " + error.message); return; }
      setInspectionId(data.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setItem = (system: string, part: string, subpart: string | null, patch: Partial<Finding>) => {
    setFindings(prev => {
      const i = prev.findIndex(f => f.system === system && f.part === part && (f.subpart ?? null) === subpart);
      if (i === -1) return [...prev, { system, part, subpart, status: "ok", ...patch } as Finding];
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  };

  const getItem = (system: string, part: string, subpart: string | null): Finding | undefined =>
    findings.find(f => f.system === system && f.part === part && (f.subpart ?? null) === subpart);

  const issuesCount = findings.filter(f => f.status !== "ok").length;

  async function uploadPhoto(file: File): Promise<string | null> {
    if (!inspectionId) return null;
    const path = `${inspectionId}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("inspection-photos").upload(path, file);
    if (error) { toast.error("Upload failed: " + error.message); return null; }
    const { data } = supabase.storage.from("inspection-photos").getPublicUrl(path);
    return data.publicUrl;
  }

  async function finishManual() {
    if (!inspectionId) return;
    const issues = findings.filter(f => f.status !== "ok");
    if (issues.length > 0) {
      const { error } = await supabase.from("inspection_findings").insert(
        issues.map(f => ({ inspection_id: inspectionId, ...f }))
      );
      if (error) { toast.error(error.message); return; }
    }
    await supabase.from("inspections").update({ manual_done: true }).eq("id", inspectionId);
    toast.success(`Manual inspection saved · ${issues.length} issue(s)`);
    onAutoDiagnosed?.();
    if (doBoth && !codes.length) setMode("obd");
    else setMode("summary");
  }

  async function connectObd(transport: "serial" | "bluetooth") {
    setObdError(null);
    setObdStage("connecting");
    try {
      const c = transport === "serial" ? await connectSerial() : await connectBluetooth();
      setConn(c);
      setObdStage("ready");
      toast.success(`Connected via ${transport === "serial" ? "USB cable" : "Bluetooth"} — ${c.deviceLabel}`);
    } catch (e: any) {
      setObdError(e?.message ?? String(e));
      setObdStage("error");
    }
  }

  async function runRealScan() {
    if (!inspectionId || !conn) return;
    setObdStage("scanning");
    setScanLog([]);
    try {
      const result = await fullScan(conn, (line) => setScanLog((p) => [...p, line]));
      const merged = [...result.storedCodes, ...result.pendingCodes];
      setCodes(merged);
      setScanInfo({ vin: result.vin, voltage: result.voltage, protocol: result.protocol });
      const { data: scan, error: e1 } = await supabase
        .from("obd_scans")
        .insert({ inspection_id: inspectionId, source: conn.transport })
        .select().single();
      if (e1) { toast.error(e1.message); setObdStage("error"); setObdError(e1.message); return; }
      if (merged.length > 0) {
        await supabase.from("obd_codes").insert(merged.map(c => ({ scan_id: scan.id, ...c })));
      }
      await supabase.from("inspections").update({ obd_done: true }).eq("id", inspectionId);
      onAutoDiagnosed?.();
      toast.success(`OBD scan complete — ${merged.length} code(s)`);
      setObdStage("done");
    } catch (e: any) {
      setObdError(e?.message ?? String(e));
      setObdStage("error");
    }
  }

  async function disconnectObd() {
    try { await conn?.close(); } catch { /* */ }
    setConn(null);
    setObdStage("pick-transport");
  }

  async function finishAll() {
    if (!inspectionId) return;
    await supabase.from("inspections").update({ status: "finished" }).eq("id", inspectionId);
    onFinished({ findings: findings.filter(f => f.status !== "ok"), codes });
  }

  // ---- CHOOSE MODE ----
  if (mode === "choose") {
    return (
      <div className="space-y-5">
        <Header onClose={onClose} title="Diagnostics" subtitle={`${plate} · ${vehicle}`} />
        <div className="grid gap-4 md:grid-cols-3">
          <ChoiceCard
            icon={<ClipboardList className="h-6 w-6" />}
            title="Manual inspection"
            desc="Walk around the car and tick every system, part by part."
            onClick={() => { setDoBoth(false); setMode("category"); }}
          />
          <ChoiceCard
            icon={<Cpu className="h-6 w-6" />}
            title="Virtual (OBD-II)"
            desc="Plug in scanner, pull live trouble codes and meanings."
            onClick={() => { setDoBoth(false); setMode("obd"); }}
          />
          <ChoiceCard
            icon={<Sparkles className="h-6 w-6" />}
            title="Both"
            desc="Manual first, then OBD scan, merged into one summary."
            highlighted
            onClick={() => { setDoBoth(true); setMode("category"); }}
          />
        </div>
      </div>
    );
  }

  // ---- CATEGORY PICKER ----
  if (mode === "category") {
    const catIcon: Record<string, JSX.Element> = {
      service: <Wrench className="h-6 w-6" />,
      mechanical: <Disc className="h-6 w-6" />,
      electrical: <Zap className="h-6 w-6" />,
      body: <Car className="h-6 w-6" />,
    };
    return (
      <div className="space-y-5">
        <Header
          onClose={onClose}
          title="Pick an inspection area"
          subtitle={`${plate} · ${vehicle}`}
          right={
            <Button size="sm" variant="ghost" onClick={() => setMode("choose")}>
              <ArrowLeft className="h-4 w-4 mr-1" />Back
            </Button>
          }
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {INSPECTION_CATEGORIES.map((c) => {
            const issues = findings.filter(
              (f) => c.systems.includes(f.system) && f.status !== "ok",
            ).length;
            return (
              <ChoiceCard
                key={c.key}
                icon={catIcon[c.key]}
                title={c.label}
                desc={c.description}
                badge={issues > 0 ? `${issues} issue${issues > 1 ? "s" : ""}` : undefined}
                onClick={() => {
                  setActiveCategory(c.key);
                  const first = INSPECTION_TREE.find((s) => c.systems.includes(s.key));
                  if (first) setActiveSystem(first.key);
                  setMode("manual");
                }}
              />
            );
          })}
        </div>
        {findings.some((f) => f.status !== "ok") && (
          <div className="flex justify-end">
            <Button onClick={finishManual} className="bg-gradient-primary">
              <CheckCircle2 className="h-4 w-4 mr-2" />Save & continue
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ---- MANUAL MODE ----
  if (mode === "manual") {
    const cat = INSPECTION_CATEGORIES.find((c) => c.key === activeCategory);
    const systemsInCat = cat
      ? INSPECTION_TREE.filter((s) => cat.systems.includes(s.key))
      : INSPECTION_TREE;
    return (
      <div className="space-y-5">
        <Header
          onClose={onClose}
          title={cat ? `${cat.label} inspection` : "Manual inspection"}
          subtitle={`${plate} · ${vehicle}`}
          right={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setMode("category")}>
                <ArrowLeft className="h-4 w-4 mr-1" />Categories
              </Button>
              <Badge variant="secondary">{issuesCount} issue(s)</Badge>
              <Button onClick={finishManual} className="bg-gradient-primary">
                <CheckCircle2 className="h-4 w-4 mr-2" />Save & continue
              </Button>
            </div>
          }
        />

        <Tabs value={activeSystem} onValueChange={setActiveSystem}>
          <TabsList className="flex flex-wrap h-auto justify-start">
            {systemsInCat.map(s => (
              <TabsTrigger key={s.key} value={s.key} className="text-xs">
                {s.label}
                {findings.some(f => f.system === s.key && f.status !== "ok") && (
                  <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {systemsInCat.map(system => (
            <TabsContent key={system.key} value={system.key} className="mt-4">
              <Accordion type="multiple" className="space-y-2">
                {system.parts.map(part => {
                  const partIssues = findings.filter(f => f.system === system.key && f.part === part.label && f.status !== "ok").length;
                  return (
                    <AccordionItem key={part.key} value={part.key} className="border rounded-lg px-3">
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center gap-2 flex-1">
                          <span className="font-medium">{part.label}</span>
                          {partIssues > 0 && <Badge variant="destructive" className="h-5 text-[10px]">{partIssues}</Badge>}
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-3 pb-2">
                          {part.subparts.map(sub => {
                            const item = getItem(system.key, part.label, sub);
                            return (
                              <SubpartRow
                                key={sub}
                                label={sub}
                                value={item}
                                onChange={(patch) => setItem(system.key, part.label, sub, patch)}
                                onPhoto={async (file) => {
                                  const url = await uploadPhoto(file);
                                  if (url) setItem(system.key, part.label, sub, { photo_url: url });
                                }}
                              />
                            );
                          })}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    );
  }

  // ---- OBD MODE ----
  if (mode === "obd") {
    return (
      <div className="space-y-5">
        <Header onClose={onClose} title="Virtual OBD-II diagnostic" subtitle={`${plate} · ${vehicle}`} />
        <Card className="p-6 space-y-5">
          {obdStage === "pick-transport" && (
            <div className="space-y-4">
              <div className="text-center">
                <Cpu className="h-10 w-10 mx-auto text-primary mb-2" />
                <h3 className="font-semibold text-lg">Connect to the vehicle's ELM327 adapter</h3>
                <p className="text-sm text-muted-foreground">Turn the ignition to ON (engine off is fine). Choose how the adapter is connected.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => connectObd("serial")}
                  disabled={!isWebSerialSupported()}
                  className="rounded-lg border p-4 text-left hover:border-primary hover:bg-primary/5 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-2 mb-1"><Plug className="h-5 w-5 text-primary" /><span className="font-semibold">USB cable</span></div>
                  <p className="text-xs text-muted-foreground">
                    {isWebSerialSupported()
                      ? "Recommended. Works with USB ELM327 cables on Chrome/Edge desktop."
                      : "Not available in this browser. Use Chrome or Edge on desktop."}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => connectObd("bluetooth")}
                  disabled={!isWebBluetoothSupported()}
                  className="rounded-lg border p-4 text-left hover:border-primary hover:bg-primary/5 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-2 mb-1"><Bluetooth className="h-5 w-5 text-primary" /><span className="font-semibold">Bluetooth (BLE)</span></div>
                  <p className="text-xs text-muted-foreground">
                    Only works with BLE ELM327 dongles (e.g. Vgate iCar Pro BLE). Classic-Bluetooth ELM327 clones cannot pair from a browser — use the USB cable instead.
                  </p>
                </button>
              </div>
            </div>
          )}

          {obdStage === "connecting" && (
            <div className="text-center py-10 space-y-3">
              <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" />
              <p className="font-medium">Pairing with adapter…</p>
              <p className="text-xs text-muted-foreground">Approve the device in the browser prompt.</p>
            </div>
          )}

          {obdStage === "ready" && (
            <div className="text-center space-y-3 py-6">
              <CheckCircle2 className="h-10 w-10 mx-auto text-success" />
              <div>
                <p className="font-semibold">Connected{conn ? ` — ${conn.deviceLabel}` : ""}</p>
                <p className="text-xs text-muted-foreground">Initialise adapter, read VIN, then pull stored & pending DTCs.</p>
              </div>
              <div className="flex justify-center gap-2">
                <Button variant="outline" onClick={disconnectObd}>Disconnect</Button>
                <Button onClick={runRealScan} className="bg-gradient-primary">
                  <Cpu className="h-4 w-4 mr-2" />Start scan
                </Button>
              </div>
            </div>
          )}

          {obdStage === "scanning" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <p className="font-medium">Scanning ECU…</p>
              </div>
              <pre className="text-[11px] bg-muted/40 rounded-md p-3 max-h-48 overflow-auto whitespace-pre-wrap">
                {scanLog.join("\n") || "Initialising…"}
              </pre>
            </div>
          )}

          {obdStage === "error" && (
            <div className="space-y-3">
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <p className="font-semibold text-destructive">Could not complete OBD action</p>
                <p className="text-xs text-muted-foreground mt-1">{obdError}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setObdError(null); setObdStage("pick-transport"); }}>Try again</Button>
              </div>
            </div>
          )}

          {obdStage === "done" && (
            <div className="space-y-4">
              {scanInfo && (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-md bg-muted/40 p-2"><p className="text-muted-foreground">VIN</p><p className="font-mono">{scanInfo.vin ?? "—"}</p></div>
                  <div className="rounded-md bg-muted/40 p-2"><p className="text-muted-foreground">Protocol</p><p className="font-mono">{scanInfo.protocol ?? "—"}</p></div>
                  <div className="rounded-md bg-muted/40 p-2"><p className="text-muted-foreground">Battery</p><p className="font-mono">{scanInfo.voltage ?? "—"}</p></div>
                </div>
              )}
              <h3 className="font-semibold">{codes.length === 0 ? "No trouble codes — vehicle reports clean." : `Found ${codes.length} trouble code(s)`}</h3>
              <div className="space-y-2">
                {codes.map(c => <DtcRow key={c.code} dtc={c} />)}
              </div>
            </div>
          )}
        </Card>
        {(obdStage === "done") && (
          <div className="flex justify-end gap-2">
            {!doBoth && <Button variant="outline" onClick={() => setMode("manual")}>Also do manual</Button>}
            <Button variant="outline" onClick={disconnectObd}>Disconnect adapter</Button>
            <Button onClick={() => setMode("summary")} className="bg-gradient-primary">
              Continue to summary
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ---- SUMMARY MODE ----
  const issues = findings.filter(f => f.status !== "ok");
  const bySystem = issues.reduce<Record<string, Finding[]>>((acc, f) => {
    (acc[f.system] ??= []).push(f); return acc;
  }, {});

  return (
    <div className="space-y-5">
      <Header onClose={onClose} title="Diagnostic summary" subtitle={`${plate} · ${vehicle}`}
        right={
          <Button onClick={finishAll} className="bg-success hover:bg-success/90">
            <CheckCircle2 className="h-4 w-4 mr-2" />Finish & generate Job Card
          </Button>
        }
      />

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            Manual findings ({issues.length})
          </h3>
          {issues.length === 0 ? (
            <p className="text-sm text-muted-foreground">No issues recorded.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(bySystem).map(([sys, items]) => {
                const sysLabel = INSPECTION_TREE.find(s => s.key === sys)?.label ?? sys;
                return (
                  <div key={sys}>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{sysLabel}</p>
                    <ul className="space-y-1">
                      {items.map((f, i) => (
                        <li key={i} className="text-sm flex items-start gap-2">
                          <SeverityDot severity={f.severity ?? "low"} />
                          <span><strong>{f.part}</strong>{f.subpart ? ` · ${f.subpart}` : ""}: {f.note || (f.status === "faulty" ? "faulty" : "needs attention")}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Cpu className="h-4 w-4 text-primary" />
            OBD codes ({codes.length})
          </h3>
          {codes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No OBD scan run.</p>
          ) : (
            <div className="space-y-2">
              {codes.map(c => <DtcRow key={c.code} dtc={c} compact />)}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------- subcomponents ----------

function Header({ onClose, title, subtitle, right }: { onClose: () => void; title: string; subtitle: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onClose}><ArrowLeft className="h-4 w-4" /></Button>
        <div>
          <h1 className="text-xl font-bold">{title}</h1>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {right}
    </div>
  );
}

function ChoiceCard({ icon, title, desc, highlighted, badge, onClick }: { icon: React.ReactNode; title: string; desc: string; highlighted?: boolean; badge?: string; onClick: () => void }) {
  return (
    <Card
      onClick={onClick}
      className={`p-5 cursor-pointer hover:shadow-lg hover:border-primary transition-all ${highlighted ? "border-primary bg-primary/5" : ""}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">{icon}</div>
        {badge && <Badge variant="destructive" className="text-[10px]">{badge}</Badge>}
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground mt-1">{desc}</p>
    </Card>
  );
}

function SubpartRow({ label, value, onChange, onPhoto }: {
  label: string;
  value?: Finding;
  onChange: (patch: Partial<Finding>) => void;
  onPhoto: (file: File) => void;
}) {
  const status = value?.status ?? "ok";
  const showDetails = status !== "ok";

  return (
    <div className="rounded-md border p-3 space-y-2 bg-muted/30">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex gap-1">
          {(["ok", "attention", "faulty"] as FindingStatus[]).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => onChange({ status: s })}
              className={`px-2.5 py-1 text-xs rounded-md border transition ${
                status === s
                  ? s === "ok" ? "bg-success text-success-foreground border-success"
                    : s === "attention" ? "bg-yellow-500 text-white border-yellow-500"
                    : "bg-destructive text-destructive-foreground border-destructive"
                  : "bg-background hover:bg-muted"
              }`}
            >
              {s === "ok" ? "OK" : s === "attention" ? "Attention" : "Faulty"}
            </button>
          ))}
        </div>
      </div>

      {showDetails && (
        <div className="space-y-2 pt-1">
          <div className="grid sm:grid-cols-[1fr_140px] gap-2">
            <Textarea
              placeholder="Describe the problem (e.g. window glass cracked, won't roll up)…"
              value={value?.note ?? ""}
              onChange={e => onChange({ note: e.target.value })}
              rows={2}
              className="text-sm"
            />
            <div className="flex flex-col gap-2">
              <Select value={value?.severity ?? "medium"} onValueChange={(v) => onChange({ severity: v as Severity })}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Severity" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
              <CameraInput
                size="sm"
                variant="outline"
                className="h-9"
                label={value?.photo_url ? "Replace photo" : "Add photo"}
                onPick={(file) => onPhoto(file)}
              />

            </div>
          </div>
          {value?.photo_url && (
            <div className="relative inline-block">
              <img src={value.photo_url} alt="Finding" className="h-20 rounded-md border" />
              <button type="button" onClick={() => onChange({ photo_url: null })}
                className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DtcRow({ dtc, compact }: { dtc: DtcCode; compact?: boolean }) {
  const sevColor = dtc.severity === "high" ? "bg-destructive text-destructive-foreground"
    : dtc.severity === "medium" ? "bg-yellow-500 text-white"
    : "bg-muted text-muted-foreground";
  return (
    <div className={`rounded-md border p-3 ${compact ? "" : "bg-muted/30"}`}>
      <div className="flex items-center gap-2 mb-1">
        <Badge className={sevColor}>{dtc.severity.toUpperCase()}</Badge>
        <span className="font-mono font-semibold">{dtc.code}</span>
        <Badge variant="outline" className="text-[10px]">{dtc.system}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{dtc.meaning}</p>
    </div>
  );
}

function SeverityDot({ severity }: { severity: Severity }) {
  const c = severity === "high" ? "bg-destructive" : severity === "medium" ? "bg-yellow-500" : "bg-muted-foreground";
  return <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${c}`} />;
}
