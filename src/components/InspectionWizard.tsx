import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ArrowLeft, Bluetooth, Car, CheckCircle2, ClipboardList, Cpu, Loader2, Palette, Plug, Sparkles, Wrench, X, Zap } from "lucide-react";
import { CameraInput } from "@/components/CameraInput";
import { toast } from "sonner";
import {
  FINDING_STATUS_OPTIONS,
  INSPECTION_CATEGORIES,
  INSPECTION_TREE,
  getInspectionCategoryKeyForSystem,
  getInspectionSystemLabel,
  isServiceCategory,
  type Finding,
  type FindingStatus,
  type InspectionCategory,
  type Severity,
} from "@/lib/inspection-tree";
import {
  connectBluetooth,
  connectSerial,
  fullScan,
  isWebBluetoothSupported,
  isWebSerialSupported,
  type DtcCode,
  type ObdConnection,
  type ScanResult,
} from "@/lib/obd-elm327";

interface Props {
  jobId: string;
  plate: string;
  vehicle: string;
  onClose: () => void;
  onFinished: (summary: { findings: Finding[]; codes: DtcCode[] }) => void;
  onAutoDiagnosed?: () => void;
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
  const [visitedCategories, setVisitedCategories] = useState<InspectionCategory["key"][]>([]);
  const [activeSystem, setActiveSystem] = useState(INSPECTION_TREE[0].key);

  const [obdStage, setObdStage] = useState<ObdStage>("pick-transport");
  const [obdError, setObdError] = useState<string | null>(null);
  const [conn, setConn] = useState<ObdConnection | null>(null);
  const [scanLog, setScanLog] = useState<string[]>([]);
  const [scanInfo, setScanInfo] = useState<Pick<ScanResult, "vin" | "voltage" | "protocol"> | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("inspections")
        .insert({ job_ref: jobId, plate, vehicle })
        .select()
        .single();

      if (error) {
        toast.error("Could not start inspection: " + error.message);
        return;
      }

      setInspectionId(data.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setItem = (system: string, part: string, subpart: string | null, patch: Partial<Finding>) => {
    setFindings((prev) => {
      const category = getInspectionCategoryKeyForSystem(system);
      const index = prev.findIndex(
        (item) => item.system === system && item.part === part && (item.subpart ?? null) === subpart,
      );

      if (index === -1) {
        return [
          ...prev,
          {
            category,
            system,
            part,
            subpart,
            status: "ok",
            client_authorized: false,
            ...patch,
          } as Finding,
        ];
      }

      const next = [...prev];
      next[index] = { ...next[index], category, ...patch };
      return next;
    });
  };

  const getItem = (system: string, part: string, subpart: string | null): Finding | undefined =>
    findings.find(
      (item) => item.system === system && item.part === part && (item.subpart ?? null) === subpart,
    );

  const issuesCount = findings.filter((item) => item.status !== "ok").length;

  const manualCategoryKeys = visitedCategories.length > 0
    ? visitedCategories
    : activeCategory
      ? [activeCategory]
      : [];

  function buildManualPayload(): Finding[] {
    if (manualCategoryKeys.length === 0) return [];

    const systemsToPersist = INSPECTION_TREE.filter((system) =>
      manualCategoryKeys.some((categoryKey) =>
        INSPECTION_CATEGORIES.find((category) => category.key === categoryKey)?.systems.includes(system.key),
      ),
    );

    return systemsToPersist.flatMap((system) =>
      system.parts.flatMap((part) =>
        part.subparts.map((subpart) => {
          const current = getItem(system.key, part.label, subpart);
          const category = getInspectionCategoryKeyForSystem(system.key);
          const isService = isServiceCategory(category);
          const status = current?.status ?? "ok";
          const isIssue = status !== "ok";

          return {
            category,
            system: system.key,
            part: part.label,
            subpart,
            status,
            severity: isService ? null : isIssue ? current?.severity ?? "medium" : null,
            last_service: isService ? current?.last_service?.trim() || null : null,
            next_due: isService ? current?.next_due?.trim() || null : null,
            note: isService ? current?.note?.trim() || null : isIssue ? current?.note?.trim() || null : null,
            action_required: isService ? null : isIssue ? current?.action_required?.trim() || null : null,
            estimated_cost: isService ? null : isIssue ? current?.estimated_cost ?? null : null,
            assigned_technician: isService ? null : isIssue ? current?.assigned_technician?.trim() || null : null,
            time_estimate_minutes: isService ? null : isIssue ? current?.time_estimate_minutes ?? null : null,
            client_authorized: isService ? false : isIssue ? current?.client_authorized === true : false,
            photo_url: isService ? null : isIssue ? current?.photo_url ?? null : null,
          } satisfies Finding;
        }),
      ),
    );
  }

  async function uploadPhoto(file: File): Promise<string | null> {
    if (!inspectionId) return null;

    const path = `${inspectionId}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("inspection-photos").upload(path, file);
    if (error) {
      toast.error("Upload failed: " + error.message);
      return null;
    }

    const { data } = supabase.storage.from("inspection-photos").getPublicUrl(path);
    return data.publicUrl;
  }

  async function finishManual() {
    if (!inspectionId) return;

    const payload = buildManualPayload();
    if (payload.length === 0) {
      toast.error("Pick at least one inspection area before saving.");
      return;
    }

    const { error } = await supabase.from("inspection_findings").insert(
      payload.map((finding) => ({ inspection_id: inspectionId, ...finding })),
    );
    if (error) {
      toast.error(error.message);
      return;
    }

    const issues = payload.filter((finding) => finding.status !== "ok");
    await supabase.from("inspections").update({ manual_done: true }).eq("id", inspectionId);

    toast.success(`Manual inspection saved - ${issues.length} issue(s) across ${payload.length} checkpoints`);
    onAutoDiagnosed?.();

    if (doBoth && codes.length === 0) setMode("obd");
    else setMode("summary");
  }

  async function connectObd(transport: "serial" | "bluetooth") {
    setObdError(null);
    setObdStage("connecting");

    try {
      const nextConn = transport === "serial" ? await connectSerial() : await connectBluetooth();
      setConn(nextConn);
      setObdStage("ready");
      toast.success(`Connected via ${transport === "serial" ? "USB cable" : "Bluetooth"} - ${nextConn.deviceLabel}`);
    } catch (error: any) {
      setObdError(error?.message ?? String(error));
      setObdStage("error");
    }
  }

  async function runRealScan() {
    if (!inspectionId || !conn) return;

    setObdStage("scanning");
    setScanLog([]);

    try {
      const result = await fullScan(conn, (line) => setScanLog((prev) => [...prev, line]));
      const merged = [...result.storedCodes, ...result.pendingCodes];
      setCodes(merged);
      setScanInfo({ vin: result.vin, voltage: result.voltage, protocol: result.protocol });

      const { data: scan, error } = await supabase
        .from("obd_scans")
        .insert({ inspection_id: inspectionId, source: conn.transport })
        .select()
        .single();

      if (error) {
        toast.error(error.message);
        setObdStage("error");
        setObdError(error.message);
        return;
      }

      if (merged.length > 0) {
        await supabase.from("obd_codes").insert(merged.map((code) => ({ scan_id: scan.id, ...code })));
      }

      await supabase.from("inspections").update({ obd_done: true }).eq("id", inspectionId);
      onAutoDiagnosed?.();
      toast.success(`OBD scan complete - ${merged.length} code(s)`);
      setObdStage("done");
    } catch (error: any) {
      setObdError(error?.message ?? String(error));
      setObdStage("error");
    }
  }

  async function disconnectObd() {
    try {
      await conn?.close();
    } catch {
      // Ignore adapter close errors during cleanup.
    }

    setConn(null);
    setObdStage("pick-transport");
  }

  async function finishAll() {
    if (!inspectionId) return;

    await supabase.from("inspections").update({ status: "finished" }).eq("id", inspectionId);
    onFinished({ findings: findings.filter((finding) => finding.status !== "ok"), codes });
  }

  if (mode === "choose") {
    return (
      <div className="space-y-5">
        <Header onClose={onClose} title="Diagnostics" subtitle={`${plate} - ${vehicle}`} />
        <div className="grid gap-4 md:grid-cols-3">
          <ChoiceCard
            icon={<ClipboardList className="h-6 w-6" />}
            title="Manual inspection"
            desc="Walk through the vehicle and mark each checkpoint in the inspection matrix."
            onClick={() => {
              setDoBoth(false);
              setMode("category");
            }}
          />
          <ChoiceCard
            icon={<Cpu className="h-6 w-6" />}
            title="Virtual (OBD-II)"
            desc="Plug in the scanner and pull live trouble codes from the vehicle ECU."
            onClick={() => {
              setDoBoth(false);
              setMode("obd");
            }}
          />
          <ChoiceCard
            icon={<Sparkles className="h-6 w-6" />}
            title="Both"
            desc="Run the manual matrix first, then merge it with the OBD scan summary."
            highlighted
            onClick={() => {
              setDoBoth(true);
              setMode("category");
            }}
          />
        </div>
      </div>
    );
  }

  if (mode === "category") {
    const catIcon: Record<InspectionCategory["key"], JSX.Element> = {
      service: <ClipboardList className="h-6 w-6" />,
      mechanical: <Wrench className="h-6 w-6" />,
      electrical: <Zap className="h-6 w-6" />,
      bodywork: <Car className="h-6 w-6" />,
      paint: <Palette className="h-6 w-6" />,
    };

    return (
      <div className="space-y-5">
        <Header
          onClose={onClose}
          title="Pick an inspection area"
          subtitle={`${plate} - ${vehicle}`}
          right={(
            <Button size="sm" variant="ghost" onClick={() => setMode("choose")}>
              <ArrowLeft className="mr-1 h-4 w-4" />Back
            </Button>
          )}
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {INSPECTION_CATEGORIES.map((category) => {
            const issues = findings.filter(
              (finding) => category.systems.includes(finding.system) && finding.status !== "ok",
            ).length;
            const visited = visitedCategories.includes(category.key);

            return (
              <ChoiceCard
                key={category.key}
                icon={catIcon[category.key]}
                title={category.label}
                desc={category.description}
                badge={
                  issues > 0
                    ? `${issues} issue${issues > 1 ? "s" : ""}`
                    : visited
                      ? "inspected"
                      : undefined
                }
                onClick={() => {
                  setActiveCategory(category.key);
                  setVisitedCategories((prev) =>
                    prev.includes(category.key) ? prev : [...prev, category.key],
                  );
                  const firstSystem = INSPECTION_TREE.find((system) => category.systems.includes(system.key));
                  if (firstSystem) setActiveSystem(firstSystem.key);
                  setMode("manual");
                }}
              />
            );
          })}
        </div>

        {visitedCategories.length > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
            <p className="text-sm text-muted-foreground">
              {visitedCategories.length} area(s) opened, {issuesCount} issue(s) flagged.
            </p>
            <Button onClick={finishManual} className="bg-gradient-primary">
              <CheckCircle2 className="mr-2 h-4 w-4" />Save & continue
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (mode === "manual") {
    const category = INSPECTION_CATEGORIES.find((item) => item.key === activeCategory);
    const systemsInCategory = category
      ? INSPECTION_TREE.filter((system) => category.systems.includes(system.key))
      : INSPECTION_TREE;

    return (
      <div className="space-y-5">
        <Header
          onClose={onClose}
          title={category ? `${category.label} inspection` : "Manual inspection"}
          subtitle={`${plate} - ${vehicle}`}
          right={(
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setMode("category")}>
                <ArrowLeft className="mr-1 h-4 w-4" />Categories
              </Button>
              <Badge variant="secondary">
                {issuesCount} issue(s) · {visitedCategories.length || 1} area(s)
              </Badge>
              <Button onClick={finishManual} className="bg-gradient-primary">
                <CheckCircle2 className="mr-2 h-4 w-4" />Save & continue
              </Button>
            </div>
          )}
        />

        <Tabs value={activeSystem} onValueChange={setActiveSystem}>
          <TabsList className="flex h-auto flex-wrap justify-start">
            {systemsInCategory.map((system) => (
              <TabsTrigger key={system.key} value={system.key} className="text-xs">
                {system.label}
                {findings.some((finding) => finding.system === system.key && finding.status !== "ok") && (
                  <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {systemsInCategory.map((system) => (
            <TabsContent key={system.key} value={system.key} className="mt-4">
              <Accordion type="multiple" className="space-y-2">
                {system.parts.map((part) => {
                  const partIssues = findings.filter(
                    (finding) => finding.system === system.key && finding.part === part.label && finding.status !== "ok",
                  ).length;

                  return (
                    <AccordionItem key={part.key} value={part.key} className="rounded-lg border px-3">
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex flex-1 items-center gap-2">
                          <span className="font-medium">{part.label}</span>
                          {partIssues > 0 && (
                            <Badge variant="destructive" className="h-5 text-[10px]">
                              {partIssues}
                            </Badge>
                          )}
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-3 pb-2">
                          {part.subparts.map((subpart) => {
                            const item = getItem(system.key, part.label, subpart);
                            const categoryKey = getInspectionCategoryKeyForSystem(system.key);

                            return (
                              <SubpartRow
                                key={subpart}
                                label={subpart}
                                isService={isServiceCategory(categoryKey)}
                                value={item}
                                onChange={(patch) => setItem(system.key, part.label, subpart, patch)}
                                onPhoto={async (file) => {
                                  const url = await uploadPhoto(file);
                                  if (url) setItem(system.key, part.label, subpart, { photo_url: url });
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

  if (mode === "obd") {
    return (
      <div className="space-y-5">
        <Header onClose={onClose} title="Virtual OBD-II diagnostic" subtitle={`${plate} - ${vehicle}`} />

        <Card className="space-y-5 p-6">
          {obdStage === "pick-transport" && (
            <div className="space-y-4">
              <div className="text-center">
                <Cpu className="mx-auto mb-2 h-10 w-10 text-primary" />
                <h3 className="text-lg font-semibold">Connect to the vehicle's ELM327 adapter</h3>
                <p className="text-sm text-muted-foreground">
                  Turn the ignition to ON. Choose how the adapter is connected.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => connectObd("serial")}
                  disabled={!isWebSerialSupported()}
                  className="rounded-lg border p-4 text-left transition hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <Plug className="h-5 w-5 text-primary" />
                    <span className="font-semibold">USB cable</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {isWebSerialSupported()
                      ? "Recommended. Works with USB ELM327 cables on Chrome or Edge desktop."
                      : "Not available in this browser. Use Chrome or Edge on desktop."}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => connectObd("bluetooth")}
                  disabled={!isWebBluetoothSupported()}
                  className="rounded-lg border p-4 text-left transition hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <Bluetooth className="h-5 w-5 text-primary" />
                    <span className="font-semibold">Bluetooth (BLE)</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Only works with BLE ELM327 dongles. Classic Bluetooth clones should use the USB cable option.
                  </p>
                </button>
              </div>
            </div>
          )}

          {obdStage === "connecting" && (
            <div className="space-y-3 py-10 text-center">
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
              <p className="font-medium">Pairing with adapter...</p>
              <p className="text-xs text-muted-foreground">Approve the device in the browser prompt.</p>
            </div>
          )}

          {obdStage === "ready" && (
            <div className="space-y-3 py-6 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
              <div>
                <p className="font-semibold">Connected{conn ? ` - ${conn.deviceLabel}` : ""}</p>
                <p className="text-xs text-muted-foreground">
                  Initialize the adapter, read the VIN, then pull stored and pending DTCs.
                </p>
              </div>
              <div className="flex justify-center gap-2">
                <Button variant="outline" onClick={disconnectObd}>Disconnect</Button>
                <Button onClick={runRealScan} className="bg-gradient-primary">
                  <Cpu className="mr-2 h-4 w-4" />Start scan
                </Button>
              </div>
            </div>
          )}

          {obdStage === "scanning" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <p className="font-medium">Scanning ECU...</p>
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-[11px]">
                {scanLog.join("\n") || "Initializing..."}
              </pre>
            </div>
          )}

          {obdStage === "error" && (
            <div className="space-y-3">
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <p className="font-semibold text-destructive">Could not complete the OBD action</p>
                <p className="mt-1 text-xs text-muted-foreground">{obdError}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setObdError(null);
                    setObdStage("pick-transport");
                  }}
                >
                  Try again
                </Button>
              </div>
            </div>
          )}

          {obdStage === "done" && (
            <div className="space-y-4">
              {scanInfo && (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-md bg-muted/40 p-2">
                    <p className="text-muted-foreground">VIN</p>
                    <p className="font-mono">{scanInfo.vin ?? "-"}</p>
                  </div>
                  <div className="rounded-md bg-muted/40 p-2">
                    <p className="text-muted-foreground">Protocol</p>
                    <p className="font-mono">{scanInfo.protocol ?? "-"}</p>
                  </div>
                  <div className="rounded-md bg-muted/40 p-2">
                    <p className="text-muted-foreground">Battery</p>
                    <p className="font-mono">{scanInfo.voltage ?? "-"}</p>
                  </div>
                </div>
              )}

              <h3 className="font-semibold">
                {codes.length === 0 ? "No trouble codes - vehicle reports clean." : `Found ${codes.length} trouble code(s)`}
              </h3>

              <div className="space-y-2">
                {codes.map((code) => <DtcRow key={code.code} dtc={code} />)}
              </div>
            </div>
          )}
        </Card>

        {obdStage === "done" && (
          <div className="flex justify-end gap-2">
            {!doBoth && (
              <Button variant="outline" onClick={() => setMode("category")}>
                Also do manual
              </Button>
            )}
            <Button variant="outline" onClick={disconnectObd}>Disconnect adapter</Button>
            <Button onClick={() => setMode("summary")} className="bg-gradient-primary">
              Continue to summary
            </Button>
          </div>
        )}
      </div>
    );
  }

  const manualPayload = buildManualPayload();
  const issues = manualPayload.filter(
    (finding) => finding.status !== "ok" && !isServiceCategory(finding.category),
  );
  const serviceChecks = manualPayload.filter((finding) => isServiceCategory(finding.category));
  const serviceHighlights = serviceChecks.filter(
    (finding) => finding.status !== "ok" || finding.last_service || finding.next_due || finding.note,
  );
  const issuesByCategory = INSPECTION_CATEGORIES
    .map((category) => ({
      category,
      items: issues.filter(
        (finding) => (finding.category ?? getInspectionCategoryKeyForSystem(finding.system)) === category.key,
      ),
    }))
    .filter(({ items }) => items.length > 0);

  return (
    <div className="space-y-5">
      <Header
        onClose={onClose}
        title="Diagnostic summary"
        subtitle={`${plate} - ${vehicle}`}
        right={(
          <Button onClick={finishAll} className="bg-success hover:bg-success/90">
            <CheckCircle2 className="mr-2 h-4 w-4" />Finish & generate Job Card
          </Button>
        )}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-3 flex items-center gap-2 font-semibold">
            <ClipboardList className="h-4 w-4 text-primary" />
            Diagnostic findings ({issues.length})
          </h3>

          {issues.length === 0 ? (
            <p className="text-sm text-muted-foreground">No issues recorded.</p>
          ) : (
            <div className="space-y-4">
              {issuesByCategory.map(({ category, items }) => (
                <div key={category.key}>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{category.label}</p>
                  <ul className="space-y-2">
                    {items.map((finding, index) => (
                      <li key={`${finding.system}-${finding.part}-${finding.subpart ?? "item"}-${index}`} className="flex items-start gap-2 text-sm">
                        <SeverityDot severity={finding.severity ?? "low"} />
                        <span>
                          <strong>{getInspectionSystemLabel(finding.system)}</strong>
                          {finding.subpart ? ` - ${finding.subpart}` : ""}
                          {`: ${finding.status.toUpperCase()}`}
                          {finding.note ? ` | ${finding.note}` : ""}
                          {finding.action_required ? ` | Action: ${finding.action_required}` : ""}
                          {finding.assigned_technician ? ` | Tech: ${finding.assigned_technician}` : ""}
                          {finding.estimated_cost != null ? ` | Est. cost: ${finding.estimated_cost}` : ""}
                          {finding.time_estimate_minutes != null ? ` | ${finding.time_estimate_minutes} min` : ""}
                          {finding.client_authorized ? " | Client approved" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 flex items-center gap-2 font-semibold">
            <ClipboardList className="h-4 w-4 text-primary" />
            Regular service ({serviceHighlights.length})
          </h3>
          {serviceHighlights.length === 0 ? (
            <p className="text-sm text-muted-foreground">No service checklist recorded.</p>
          ) : (
            <div className="space-y-2">
              {serviceHighlights.map((finding, index) => (
                <div
                  key={`${finding.system}-${finding.part}-${finding.subpart ?? "item"}-${index}`}
                  className="rounded-md border bg-muted/30 p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">
                      {getInspectionSystemLabel(finding.system)}
                      {finding.subpart ? ` - ${finding.subpart}` : ""}
                    </p>
                    <Badge
                      variant="outline"
                      className={
                        finding.status === "faulty"
                          ? "border-destructive text-destructive"
                          : finding.status === "attention"
                            ? "border-yellow-500 text-yellow-700"
                            : ""
                      }
                    >
                      {finding.status.toUpperCase()}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[
                      finding.last_service ? `Last service: ${finding.last_service}` : null,
                      finding.next_due ? `Next due: ${finding.next_due}` : null,
                      finding.note ? `Remarks: ${finding.note}` : null,
                    ].filter(Boolean).join(" | ") || "No interval notes added."}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="mb-3 flex items-center gap-2 font-semibold">
          <Cpu className="h-4 w-4 text-primary" />
          OBD codes ({codes.length})
        </h3>
        {codes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No OBD scan run.</p>
        ) : (
          <div className="space-y-2">
            {codes.map((code) => <DtcRow key={code.code} dtc={code} compact />)}
          </div>
        )}
      </Card>
    </div>
  );
}

function Header({
  onClose,
  title,
  subtitle,
  right,
}: {
  onClose: () => void;
  title: string;
  subtitle: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onClose}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">{title}</h1>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {right}
    </div>
  );
}

function ChoiceCard({
  icon,
  title,
  desc,
  highlighted,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  highlighted?: boolean;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <Card
      onClick={onClick}
      className={`cursor-pointer p-5 transition-all hover:border-primary hover:shadow-lg ${highlighted ? "border-primary bg-primary/5" : ""}`}
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        {badge && <Badge variant="destructive" className="text-[10px]">{badge}</Badge>}
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
    </Card>
  );
}

function SubpartRow({
  label,
  isService,
  value,
  onChange,
  onPhoto,
}: {
  label: string;
  isService: boolean;
  value?: Finding;
  onChange: (patch: Partial<Finding>) => void;
  onPhoto: (file: File) => void;
}) {
  const status = value?.status ?? "ok";
  const showDetails = isService || status !== "ok";

  const applyStatus = (nextStatus: FindingStatus) => {
    if (nextStatus === "ok") {
      onChange({
        status: "ok",
        ...(isService
          ? {}
          : {
              severity: null,
              note: null,
              action_required: null,
              estimated_cost: null,
              assigned_technician: null,
              time_estimate_minutes: null,
              client_authorized: false,
              photo_url: null,
            }),
      });
      return;
    }

    onChange({
      status: nextStatus,
      ...(isService
        ? {}
        : {
            severity: value?.severity ?? "medium",
            client_authorized: value?.client_authorized ?? false,
          }),
    });
  };

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex gap-1">
          {FINDING_STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => applyStatus(option.value)}
              className={`rounded-md border px-2.5 py-1 text-xs transition ${
                status === option.value
                  ? option.value === "ok"
                    ? "border-success bg-success text-success-foreground"
                    : option.value === "attention"
                      ? "border-yellow-500 bg-yellow-500 text-white"
                      : "border-destructive bg-destructive text-destructive-foreground"
                  : "bg-background hover:bg-muted"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {showDetails && (
        <div className="space-y-3 pt-1">
          {isService ? (
            <div className="grid gap-2 lg:grid-cols-[180px_180px_minmax(0,1fr)]">
              <Input
                placeholder="Last service"
                value={value?.last_service ?? ""}
                onChange={(event) => onChange({ last_service: event.target.value })}
                className="h-9 text-sm"
              />
              <Input
                placeholder="Next due"
                value={value?.next_due ?? ""}
                onChange={(event) => onChange({ next_due: event.target.value })}
                className="h-9 text-sm"
              />
              <Textarea
                placeholder="Remarks (e.g. serviced 5,000 km ago, due again at 10,000 km)"
                value={value?.note ?? ""}
                onChange={(event) => onChange({ note: event.target.value })}
                rows={2}
                className="text-sm"
              />
            </div>
          ) : (
            <>
              <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div className="space-y-2">
                  <Textarea
                    placeholder="Remarks (e.g. oil leak around timing cover)"
                    value={value?.note ?? ""}
                    onChange={(event) => onChange({ note: event.target.value })}
                    rows={2}
                    className="text-sm"
                  />
                  <Input
                    placeholder="Action required (e.g. replace seal and refill oil)"
                    value={value?.action_required ?? ""}
                    onChange={(event) => onChange({ action_required: event.target.value })}
                    className="text-sm"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Select
                    value={value?.severity ?? "medium"}
                    onValueChange={(next) => onChange({ severity: next as Severity })}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Severity" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>

                  <Input
                    type="number"
                    min="0"
                    placeholder="Estimated cost"
                    value={value?.estimated_cost ?? ""}
                    onChange={(event) => onChange({
                      estimated_cost: event.target.value === "" ? null : Number(event.target.value),
                    })}
                    className="h-9 text-sm"
                  />

                  <Input
                    placeholder="Assigned technician"
                    value={value?.assigned_technician ?? ""}
                    onChange={(event) => onChange({ assigned_technician: event.target.value })}
                    className="h-9 text-sm"
                  />

                  <Input
                    type="number"
                    min="0"
                    placeholder="Time estimate (mins)"
                    value={value?.time_estimate_minutes ?? ""}
                    onChange={(event) => onChange({
                      time_estimate_minutes: event.target.value === "" ? null : Number(event.target.value),
                    })}
                    className="h-9 text-sm"
                  />

                  <CameraInput
                    size="sm"
                    variant="outline"
                    className="h-9"
                    label={value?.photo_url ? "Replace photo" : "Add photo"}
                    onPick={(file) => onPhoto(file)}
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={value?.client_authorized === true}
                  onCheckedChange={(checked) => onChange({ client_authorized: checked === true })}
                />
                Client authorization received for this repair item
              </label>

              {value?.photo_url && (
                <div className="relative inline-block">
                  <img src={value.photo_url} alt="Finding" className="h-20 rounded-md border" />
                  <button
                    type="button"
                    onClick={() => onChange({ photo_url: null })}
                    className="absolute -right-1 -top-1 rounded-full bg-destructive p-0.5 text-destructive-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DtcRow({ dtc, compact }: { dtc: DtcCode; compact?: boolean }) {
  const sevColor = dtc.severity === "high"
    ? "bg-destructive text-destructive-foreground"
    : dtc.severity === "medium"
      ? "bg-yellow-500 text-white"
      : "bg-muted text-muted-foreground";

  return (
    <div className={`rounded-md border p-3 ${compact ? "" : "bg-muted/30"}`}>
      <div className="mb-1 flex items-center gap-2">
        <Badge className={sevColor}>{dtc.severity.toUpperCase()}</Badge>
        <span className="font-mono font-semibold">{dtc.code}</span>
        <Badge variant="outline" className="text-[10px]">{dtc.system}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{dtc.meaning}</p>
    </div>
  );
}

function SeverityDot({ severity }: { severity: Severity }) {
  const color = severity === "high"
    ? "bg-destructive"
    : severity === "medium"
      ? "bg-yellow-500"
      : "bg-muted-foreground";

  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${color}`} />;
}
