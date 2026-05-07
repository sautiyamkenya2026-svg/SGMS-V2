import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Hammer, UserPlus, ClipboardCheck, AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { CameraInput } from "@/components/CameraInput";

type Tool = { id: string; code: string; name: string; category: string | null; condition: string; photo_url: string | null; notes: string | null };
type Mechanic = { id: string; name: string; phone: string | null; active: boolean; specialties: string[]; level: string; roles: string[]; other_specialisations: string | null };

const SPECIALTY_OPTIONS = [
  "body", "paint", "electrical", "service", "general",
  "diagnostics", "road test", "AC", "transmission", "engine", "alignment",
] as const;
const LEVEL_OPTIONS = ["intern", "junior", "senior"] as const;
const ROLE_OPTIONS = ["road_test", "diagnostician", "service_lead", "qc_inspector"] as const;
type Assignment = { id: string; tool_id: string; mechanic_id: string; assigned_at: string; returned_at: string | null };
type Checkin = { id: string; tool_id: string; mechanic_id: string | null; period: string; status: string; notes: string | null };

const period = () => new Date().toISOString().slice(0, 7); // YYYY-MM

export default function Tools() {
  const { hasRole, user } = useAuth();
  const canEdit = hasRole("admin") || hasRole("storekeeper");
  const [tools, setTools] = useState<Tool[]>([]);
  const [mechanics, setMechanics] = useState<Mechanic[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPeriod, setCurrentPeriod] = useState(period());

  const [toolDlg, setToolDlg] = useState(false);
  const [mechDlg, setMechDlg] = useState(false);
  const [assignDlg, setAssignDlg] = useState<Tool | null>(null);
  const [toolForm, setToolForm] = useState({ code: "", name: "", category: "", condition: "good", notes: "", photo: "" });
  const [mechForm, setMechForm] = useState<{ name: string; phone: string; specialties: string[]; level: string; roles: string[]; other_specialisations: string }>({ name: "", phone: "", specialties: [], level: "junior", roles: [], other_specialisations: "" });
  const [assignForm, setAssignForm] = useState({ mechanic_id: "", note: "" });

  const load = async () => {
    setLoading(true);
    const [t, m, a, c] = await Promise.all([
      supabase.from("tools").select("*").order("name"),
      supabase.from("mechanics").select("*").eq("active", true).order("name"),
      supabase.from("tool_assignments").select("*").is("returned_at", null),
      supabase.from("tool_checkins").select("*").eq("period", currentPeriod),
    ]);
    setTools((t.data ?? []) as Tool[]);
    setMechanics((m.data ?? []) as Mechanic[]);
    setAssignments((a.data ?? []) as Assignment[]);
    setCheckins((c.data ?? []) as Checkin[]);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [currentPeriod]);

  const holderOf = (toolId: string) => {
    const a = assignments.find(x => x.tool_id === toolId);
    if (!a) return null;
    return mechanics.find(m => m.id === a.mechanic_id) ?? null;
  };
  const checkinOf = (toolId: string) => checkins.find(c => c.tool_id === toolId);

  const stats = useMemo(() => {
    const checkedIds = new Set(checkins.map(c => c.tool_id));
    return {
      total: tools.length,
      assigned: assignments.length,
      checked: checkedIds.size,
      missing: checkins.filter(c => c.status === "missing").length,
      damaged: checkins.filter(c => c.status === "damaged").length,
      pending: tools.filter(t => !checkedIds.has(t.id)).length,
    };
  }, [tools, assignments, checkins]);

  const saveTool = async () => {
    if (!toolForm.code || !toolForm.name) { toast({ title: "Code and name required", variant: "destructive" }); return; }
    const { error } = await supabase.from("tools").insert({
      code: toolForm.code, name: toolForm.name,
      category: toolForm.category || null, condition: toolForm.condition,
      notes: toolForm.notes || null, photo_url: toolForm.photo || null,
    });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Tool added" });
    setToolDlg(false); setToolForm({ code: "", name: "", category: "", condition: "good", notes: "", photo: "" });
    load();
  };

  const saveMechanic = async () => {
    if (!mechForm.name) { toast({ title: "Name required", variant: "destructive" }); return; }
    if (mechForm.specialties.length === 0) { toast({ title: "Pick at least one specialty", variant: "destructive" }); return; }
    const { error } = await supabase.from("mechanics").insert({
      name: mechForm.name,
      phone: mechForm.phone || null,
      specialties: mechForm.specialties as any,
      level: mechForm.level,
      roles: mechForm.roles as any,
      other_specialisations: mechForm.other_specialisations.trim() || null,
    } as any);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Mechanic added" });
    setMechDlg(false); setMechForm({ name: "", phone: "", specialties: [], level: "junior", roles: [], other_specialisations: "" });
    load();
  };

  const toggleSpecialty = (s: string) => {
    setMechForm(f => ({
      ...f,
      specialties: f.specialties.includes(s) ? f.specialties.filter(x => x !== s) : [...f.specialties, s],
    }));
  };
  const toggleRole = (r: string) => {
    setMechForm(f => ({
      ...f,
      roles: f.roles.includes(r) ? f.roles.filter(x => x !== r) : [...f.roles, r],
    }));
  };

  const assign = async () => {
    if (!assignDlg || !assignForm.mechanic_id) return;
    const { error } = await supabase.from("tool_assignments").insert({
      tool_id: assignDlg.id, mechanic_id: assignForm.mechanic_id, note: assignForm.note || null,
    });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Assigned" });
    setAssignDlg(null); setAssignForm({ mechanic_id: "", note: "" });
    load();
  };

  const returnTool = async (toolId: string) => {
    const a = assignments.find(x => x.tool_id === toolId);
    if (!a) return;
    const { error } = await supabase.from("tool_assignments").update({ returned_at: new Date().toISOString() }).eq("id", a.id);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Tool returned" }); load();
  };

  const recordCheckin = async (tool: Tool, status: string, notes?: string) => {
    const holder = holderOf(tool.id);
    const payload = {
      tool_id: tool.id,
      mechanic_id: holder?.id ?? null,
      period: currentPeriod,
      status,
      notes: notes ?? null,
      checked_by: user?.id ?? null,
      checked_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("tool_checkins").upsert(payload, { onConflict: "tool_id,period" });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Marked ${status}` }); load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tools Tracking</h1>
          <p className="text-sm text-muted-foreground">Assign tools to mechanics · monthly check-ups</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Dialog open={mechDlg} onOpenChange={setMechDlg}>
              <DialogTrigger asChild><Button variant="outline" size="sm"><UserPlus className="h-4 w-4 mr-2" />Mechanic</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add mechanic</DialogTitle></DialogHeader>
                <div className="grid gap-3 py-2">
                  <div><Label>Name</Label><Input value={mechForm.name} onChange={e => setMechForm({ ...mechForm, name: e.target.value })} /></div>
                  <div><Label>Phone</Label><Input value={mechForm.phone} onChange={e => setMechForm({ ...mechForm, phone: e.target.value })} /></div>
                  <div>
                    <Label>Level</Label>
                    <Select value={mechForm.level} onValueChange={v => setMechForm({ ...mechForm, level: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LEVEL_OPTIONS.map(l => <SelectItem key={l} value={l} className="capitalize">{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                    <div>
                      <Label>Specialties (pick all that apply)</Label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {SPECIALTY_OPTIONS.map(s => {
                          const on = mechForm.specialties.includes(s);
                          return (
                            <button
                              key={s}
                              type="button"
                              onClick={() => toggleSpecialty(s)}
                              className={`px-3 py-1 rounded-full text-xs border transition capitalize ${on ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 hover:bg-muted"}`}
                            >{s}</button>
                          );
                        })}
                      </div>
                    </div>
                  <div>
                    <Label>Special roles (optional)</Label>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {ROLE_OPTIONS.map(r => {
                        const on = mechForm.roles.includes(r);
                        return (
                          <button key={r} type="button" onClick={() => toggleRole(r)}
                            className={`px-3 py-1 rounded-full text-xs border transition ${on ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 hover:bg-muted"}`}
                          >{r.replace("_", " ")}</button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <Label>Other specialisations (free text)</Label>
                    <Input placeholder="e.g. Mazda Skyactiv specialist, hybrid systems"
                      value={mechForm.other_specialisations}
                      onChange={e => setMechForm({ ...mechForm, other_specialisations: e.target.value })} />
                  </div>
                </div>
                <DialogFooter><Button onClick={saveMechanic} className="bg-gradient-primary">Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={toolDlg} onOpenChange={setToolDlg}>
              <DialogTrigger asChild><Button size="sm" className="bg-gradient-primary"><Plus className="h-4 w-4 mr-2" />Tool</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add tool</DialogTitle></DialogHeader>
                <div className="grid gap-3 py-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Code</Label><Input value={toolForm.code} onChange={e => setToolForm({ ...toolForm, code: e.target.value })} placeholder="e.g. SPN-001" /></div>
                    <div><Label>Category</Label><Input value={toolForm.category} onChange={e => setToolForm({ ...toolForm, category: e.target.value })} placeholder="e.g. Spanner" /></div>
                  </div>
                  <div><Label>Name</Label><Input value={toolForm.name} onChange={e => setToolForm({ ...toolForm, name: e.target.value })} /></div>
                  <div><Label>Condition</Label>
                    <Select value={toolForm.condition} onValueChange={v => setToolForm({ ...toolForm, condition: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">New</SelectItem>
                        <SelectItem value="good">Good</SelectItem>
                        <SelectItem value="fair">Fair</SelectItem>
                        <SelectItem value="damaged">Damaged</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Notes</Label><Textarea rows={2} value={toolForm.notes} onChange={e => setToolForm({ ...toolForm, notes: e.target.value })} /></div>
                  <div className="flex items-center gap-2">
                    <Label>Photo</Label>
                    <CameraInput onPick={(_f, dataUrl) => setToolForm({ ...toolForm, photo: dataUrl })} />
                    {toolForm.photo && <img src={toolForm.photo} alt="" className="h-12 w-12 rounded object-cover" />}
                  </div>
                </div>
                <DialogFooter><Button onClick={saveTool} className="bg-gradient-primary">Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card className="p-4"><p className="text-xs text-muted-foreground">Total tools</p><p className="text-2xl font-bold">{stats.total}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Assigned</p><p className="text-2xl font-bold">{stats.assigned}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Checked ({currentPeriod})</p><p className="text-2xl font-bold text-success">{stats.checked}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Pending</p><p className="text-2xl font-bold text-warning">{stats.pending}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">Missing / Damaged</p><p className="text-2xl font-bold text-destructive">{stats.missing + stats.damaged}</p></Card>
      </div>

      <Tabs defaultValue="register">
        <TabsList>
          <TabsTrigger value="register"><Hammer className="h-4 w-4 mr-2" />Register</TabsTrigger>
          <TabsTrigger value="checkup"><ClipboardCheck className="h-4 w-4 mr-2" />Monthly Check-up</TabsTrigger>
        </TabsList>

        <TabsContent value="register" className="mt-4">
          <Card>
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="p-3">Code</th><th className="p-3">Tool</th><th className="p-3">Category</th><th className="p-3">Condition</th><th className="p-3">Held by</th>{canEdit && <th className="p-3 text-right">Actions</th>}
              </tr></thead>
              <tbody>
                {loading ? <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
                : tools.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No tools yet</td></tr>
                : tools.map(t => {
                  const holder = holderOf(t.id);
                  return (
                    <tr key={t.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="p-3 font-mono text-xs">{t.code}</td>
                      <td className="p-3 font-medium">{t.name}</td>
                      <td className="p-3 text-muted-foreground">{t.category ?? "—"}</td>
                      <td className="p-3 capitalize">{t.condition}</td>
                      <td className="p-3">
                        {holder ? (
                          <div className="flex flex-col gap-1">
                            <Badge>{holder.name}</Badge>
                            {holder.specialties && holder.specialties.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {holder.specialties.map(s => (
                                  <span key={s} className="text-[10px] capitalize text-muted-foreground">{s}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : <Badge variant="secondary">Store</Badge>}
                      </td>
                      {canEdit && (
                        <td className="p-3 text-right">
                          {holder
                            ? <Button size="sm" variant="outline" onClick={() => returnTool(t.id)}><RotateCcw className="h-3.5 w-3.5 mr-1" />Return</Button>
                            : <Button size="sm" variant="outline" onClick={() => setAssignDlg(t)}>Assign</Button>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </TabsContent>

        <TabsContent value="checkup" className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <Label>Period</Label>
            <Input type="month" value={currentPeriod} onChange={e => setCurrentPeriod(e.target.value)} className="w-40" />
          </div>
          <Card>
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="p-3">Tool</th><th className="p-3">Held by</th><th className="p-3">Status</th>{canEdit && <th className="p-3 text-right">Mark</th>}
              </tr></thead>
              <tbody>
                {tools.map(t => {
                  const holder = holderOf(t.id);
                  const ci = checkinOf(t.id);
                  return (
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="p-3"><div className="font-medium">{t.name}</div><div className="text-xs text-muted-foreground font-mono">{t.code}</div></td>
                      <td className="p-3">{holder?.name ?? <span className="text-muted-foreground">Store</span>}</td>
                      <td className="p-3">
                        {!ci && <Badge variant="secondary">Pending</Badge>}
                        {ci?.status === "present" && <Badge className="bg-success text-success-foreground"><CheckCircle2 className="h-3 w-3 mr-1" />Present</Badge>}
                        {ci?.status === "missing" && <Badge className="bg-destructive text-destructive-foreground"><AlertTriangle className="h-3 w-3 mr-1" />Missing</Badge>}
                        {ci?.status === "damaged" && <Badge className="bg-warning text-warning-foreground">Damaged</Badge>}
                      </td>
                      {canEdit && (
                        <td className="p-3 text-right space-x-1">
                          <Button size="sm" variant="outline" onClick={() => recordCheckin(t, "present")}>Present</Button>
                          <Button size="sm" variant="outline" onClick={() => recordCheckin(t, "damaged")}>Damaged</Button>
                          <Button size="sm" variant="outline" onClick={() => recordCheckin(t, "missing")}>Missing</Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!assignDlg} onOpenChange={(o) => !o && setAssignDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign {assignDlg?.name}</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label>Mechanic</Label>
              <Select value={assignForm.mechanic_id} onValueChange={v => setAssignForm({ ...assignForm, mechanic_id: v })}>
                <SelectTrigger><SelectValue placeholder="Pick mechanic" /></SelectTrigger>
                <SelectContent>{mechanics.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Note</Label><Textarea rows={2} value={assignForm.note} onChange={e => setAssignForm({ ...assignForm, note: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={assign} className="bg-gradient-primary">Assign</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
