import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, ShieldCheck, ShieldAlert, KeyRound, Trash2, CircleDot, Fingerprint, Upload, User as UserIcon, Loader2, Eye, EyeOff, Pencil, Wrench } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAuth, type Role } from "@/lib/auth";
import { readEdgeFunctionErrorMessage } from "@/lib/edge-function-error";

type Profile = { id: string; email: string | null; display_name: string | null; avatar_url?: string | null; phone?: string | null; national_id?: string | null; address?: string | null; notes?: string | null };
type RoleRow = { user_id: string; role: Role };
type AIProvider = "gemini" | "groq";
type AIKey = { id: string; provider: string; label: string; api_key: string; active: boolean; last_used_at: string | null; failure_count: number };
type CredCount = Record<string, number>;

const EMPTY_FORM = {
  email: "",
  password: "",
  display_name: "",
  phone: "",
  national_id: "",
  address: "",
  notes: "",
  role: "reception" as Role,
  avatar_url: "",
  enrol_fingerprint: false,
  // Mechanic-only
  mech_level: "junior" as "junior" | "mid" | "senior" | "lead",
  mech_specialties: "" as string, // comma-separated
};

const SPECIALTY_OPTIONS = [
  "Engine", "Transmission", "Electrical", "Suspension", "Brakes",
  "Body & Paint", "Diagnostics / OBD", "AC / Cooling", "Tyres & Alignment", "General",
];

const AI_SETTING_DEFAULTS = {
  gemini_api_key: "",
  groq_api_key: "",
  ai_default_provider: "groq" as AIProvider,
  ai_chat_provider: "groq" as AIProvider,
  ai_analysis_provider: "groq" as AIProvider,
  ai_image_provider: "groq" as AIProvider,
};

const AI_PROVIDER_OPTIONS: Array<{ value: AIProvider; label: string }> = [
  { value: "groq", label: "Groq" },
  { value: "gemini", label: "Gemini" },
];

function normalizeProvider(value: string | null | undefined, fallback: AIProvider): AIProvider {
  return value === "groq" || value === "gemini" ? value : fallback;
}

export default function Users() {
  const { hasRole, user } = useAuth();
  const isSuper = hasRole("super_admin");
  const isAdmin = hasRole("admin") || isSuper;
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [editForm, setEditForm] = useState({ display_name: "", phone: "", email: "", national_id: "", address: "", notes: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [aiSettings, setAiSettings] = useState({ ...AI_SETTING_DEFAULTS });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showNewApiKey, setShowNewApiKey] = useState(false);
  const [savingAiSettings, setSavingAiSettings] = useState(false);
  const [aiKeys, setAiKeys] = useState<AIKey[]>([]);
  const [keyForm, setKeyForm] = useState<{ provider: AIProvider; label: string; api_key: string }>({
    provider: "groq",
    label: "",
    api_key: "",
  });
  const [credCounts, setCredCounts] = useState<CredCount>({});

  const load = async () => {
    const [{ data: p }, { data: r }, { data: w }] = await Promise.all([
      supabase.from("profiles").select("id, email, display_name, avatar_url, phone, national_id, address, notes"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("webauthn_credentials").select("user_id"),
    ]);
    setProfiles((p ?? []) as Profile[]);
    setRoles((r ?? []) as RoleRow[]);
    const counts: CredCount = {};
    (w ?? []).forEach((row: any) => { counts[row.user_id] = (counts[row.user_id] ?? 0) + 1; });
    setCredCounts(counts);
  };
  useEffect(() => { load(); }, []);

  // AI keys (super admin only)
  const loadAiKeys = async () => {
    const { data } = await supabase.from("ai_keys").select("*").order("created_at");
    setAiKeys((data ?? []) as AIKey[]);
  };
  useEffect(() => { if (isSuper) loadAiKeys(); }, [isSuper]);

  const addAiKey = async () => {
    if (!keyForm.label.trim() || !keyForm.api_key.trim()) {
      toast({ title: "Label and key required", variant: "destructive" }); return;
    }
    const { error } = await supabase.from("ai_keys").insert({ ...keyForm, api_key: keyForm.api_key.trim() });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Key added — will be used in rotation" });
    setKeyForm({ provider: keyForm.provider, label: "", api_key: "" });
    loadAiKeys();
  };

  const toggleAiKey = async (k: AIKey) => {
    await supabase.from("ai_keys").update({ active: !k.active }).eq("id", k.id);
    loadAiKeys();
  };
  const deleteAiKey = async (id: string) => {
    await supabase.from("ai_keys").delete().eq("id", id);
    loadAiKeys();
  };

  // Load AI routing and fallback keys (only super_admin RLS allows these rows).
  useEffect(() => {
    if (!isSuper) return;
    (async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("key, value")
        .in("key", Object.keys(AI_SETTING_DEFAULTS));
      const next = { ...AI_SETTING_DEFAULTS };
      (data ?? []).forEach((row: any) => {
        if (row?.key === "gemini_api_key") next.gemini_api_key = row.value ?? "";
        if (row?.key === "groq_api_key") next.groq_api_key = row.value ?? "";
        if (row?.key === "ai_default_provider") next.ai_default_provider = normalizeProvider(row.value, next.ai_default_provider);
        if (row?.key === "ai_chat_provider") next.ai_chat_provider = normalizeProvider(row.value, next.ai_chat_provider);
        if (row?.key === "ai_analysis_provider") next.ai_analysis_provider = normalizeProvider(row.value, next.ai_analysis_provider);
        if (row?.key === "ai_image_provider") next.ai_image_provider = normalizeProvider(row.value, next.ai_image_provider);
      });
      setAiSettings(next);
      setSettingsLoaded(true);
    })();
  }, [isSuper]);

  const saveAiSettings = async () => {
    setSavingAiSettings(true);
    const payload = Object.entries(aiSettings).map(([key, value]) => ({
      key,
      value: typeof value === "string" ? value.trim() : String(value),
    }));
    const { error } = await supabase.from("app_settings").upsert(payload);
    setSavingAiSettings(false);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "AI routing and fallback keys updated" });
  };

  // Keep the UI aligned with the edge-function rules:
  // only super_admins can create director/admin/super_admin accounts.
  const allRoles: Role[] = isSuper
    ? ["reception", "mechanic", "storekeeper", "gateman", "manager", "director", "admin", "super_admin"]
    : ["reception", "mechanic", "storekeeper", "gateman", "manager", "admin"];

  // Filter visible users: hide super_admins from normal admins
  const visible = profiles.filter(p => {
    const userRoles = roles.filter(r => r.user_id === p.id).map(r => r.role);
    if (!isSuper && userRoles.includes("super_admin")) return false;
    return true;
  });

  const onPickPhoto = (f: File | null) => {
    setPhotoFile(f);
    setPhotoPreview(f ? URL.createObjectURL(f) : "");
  };

  const resetForm = () => {
    setForm({ ...EMPTY_FORM });
    setPhotoFile(null);
    setPhotoPreview("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const create = async () => {
    if (!form.email || !form.password || !form.display_name) {
      toast({ title: "Name, email and password are required", variant: "destructive" }); return;
    }
    if (form.password.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" }); return;
    }
    if (form.role === "super_admin" && !isSuper) {
      toast({ title: "Forbidden", variant: "destructive" }); return;
    }
    setCreating(true);
    try {
      const { data, error, response } = await supabase.functions.invoke("admin-create-user", {
        body: {
          email: form.email,
          password: form.password,
          display_name: form.display_name,
          role: form.role,
        },
      });
      if (error || (data as any)?.error) {
        const message = (data as any)?.error
          ?? await readEdgeFunctionErrorMessage(error, response, "Create failed");
        toast({ title: "Create failed", description: message, variant: "destructive" });
        return;
      }
      const newId = (data as any)?.user_id as string | undefined;

      // upload avatar if chosen
      let avatarUrl: string | null = null;
      if (newId && photoFile) {
        const ext = photoFile.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${newId}/avatar-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("avatars").upload(path, photoFile, { upsert: true });
        if (upErr) {
          toast({ title: "Photo upload failed", description: upErr.message, variant: "destructive" });
        } else {
          const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
          avatarUrl = pub.publicUrl;
        }
      }

      // attach extra profile fields
      if (newId) {
        await supabase.from("profiles").update({
          display_name: form.display_name,
          phone: form.phone || null,
          national_id: form.national_id || null,
          address: form.address || null,
          notes: form.notes || null,
          ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        }).eq("id", newId);
      }

      // If they're a mechanic, also create their entry in the mechanics roster
      // so they show up for assignment in jobs and their specialties are recorded.
      if (newId && form.role === "mechanic") {
        const specs = form.mech_specialties.split(",").map(s => s.trim()).filter(Boolean);
        await supabase.from("mechanics").insert({
          name: form.display_name,
          phone: form.phone || null,
          level: form.mech_level,
          specialties: specs,
          roles: ["mechanic"],
          active: true,
        });
      }

      toast({
        title: "User created ✓",
        description: `${form.display_name} can sign in as ${form.role.replace("_", " ")}.`,
      });

      // Optionally enrol fingerprint right after creation, on this device
      if (form.enrol_fingerprint && newId) {
        await enrolFingerprint({ id: newId, email: form.email, display_name: form.display_name } as Profile);
      }

      setOpen(false);
      resetForm();
      load();
    } finally {
      setCreating(false);
    }
  };

  const addRole = async (userId: string, role: Role) => {
    if (role === "super_admin" && !isSuper) return;
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Role added" });
    load();
  };

  const removeRole = async (userId: string, role: Role) => {
    if (role === "super_admin" && !isSuper) return;
    const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Role removed" });
    load();
  };

  const enrolFingerprint = async (p: Profile) => {
    if (!("credentials" in navigator) || !window.PublicKeyCredential) {
      toast({ title: "Not supported", description: "This device has no fingerprint / Face ID.", variant: "destructive" });
      return;
    }
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge, rp: { name: "Golden Automotive Solutions" },
          user: {
            id: new TextEncoder().encode(p.id),
            name: p.email ?? p.id,
            displayName: p.display_name ?? p.email ?? "Staff",
          },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
          authenticatorSelection: { userVerification: "required" },
          timeout: 60_000, attestation: "none",
        } as any,
      }) as PublicKeyCredential | null;
      if (!cred) throw new Error("No credential returned");
      const idB64 = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
      const { error } = await supabase.from("webauthn_credentials").insert({
        user_id: p.id,
        credential_id: idB64,
        device_label: navigator.userAgent.slice(0, 120),
        enrolled_by: user?.id ?? null,
      });
      if (error) throw error;
      toast({ title: "Fingerprint enrolled", description: `${p.display_name ?? p.email} can now check in on this device.` });
      load();
    } catch (e: any) {
      toast({ title: "Enrolment failed", description: e?.message ?? "Try again.", variant: "destructive" });
    }
  };

  const openEdit = (p: Profile) => {
    setEditing(p);
    setEditForm({
      display_name: p.display_name ?? "",
      phone: p.phone ?? "",
      email: p.email ?? "",
      national_id: p.national_id ?? "",
      address: p.address ?? "",
      notes: p.notes ?? "",
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    const { error } = await supabase.from("profiles").update({
      display_name: editForm.display_name || null,
      phone: editForm.phone || null,
      email: editForm.email || null,
      national_id: editForm.national_id || null,
      address: editForm.address || null,
      notes: editForm.notes || null,
    }).eq("id", editing.id);
    setSavingEdit(false);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    const userRoles = roles.filter(r => r.user_id === editing.id).map(r => r.role);
    if (userRoles.includes("mechanic") && editing.display_name) {
      await supabase.from("mechanics").update({
        name: editForm.display_name || editing.display_name,
        phone: editForm.phone || null,
      }).eq("name", editing.display_name);
    }
    toast({ title: "Updated ✓" });
    setEditing(null);
    load();
  };

  if (!isAdmin) {
    return (
      <Card className="p-8 text-center">
        <ShieldAlert className="h-10 w-10 mx-auto text-destructive mb-2" />
        <p className="font-semibold">Restricted</p>
        <p className="text-sm text-muted-foreground">Only admins can access user management.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            User Management
            {isSuper && <Badge className="bg-amber-500 text-amber-950"><ShieldCheck className="h-3 w-3 mr-1" />Super Admin</Badge>}
          </h1>
          <p className="text-sm text-muted-foreground">Add staff and assign roles. {isSuper ? "You can create every role, including other super admins." : "Admins can create staff and other admin accounts."}</p>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
          <DialogTrigger asChild><Button className="bg-gradient-primary"><Plus className="h-4 w-4 mr-2" />Add user</Button></DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add a new staff member</DialogTitle>
              <p className="text-xs text-muted-foreground">
                The account is created instantly with the role you choose. They can sign in straight away — no email confirmation needed.
              </p>
            </DialogHeader>

            <div className="grid gap-5 py-2">
              {/* Photo */}
              <div className="flex items-center gap-4">
                <Avatar className="h-20 w-20 ring-2 ring-amber-500/40">
                  {photoPreview ? <AvatarImage src={photoPreview} alt="preview" /> : null}
                  <AvatarFallback className="bg-muted">
                    <UserIcon className="h-8 w-8 text-muted-foreground" />
                  </AvatarFallback>
                </Avatar>
                <div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    capture="user"
                    className="hidden"
                    onChange={(e) => onPickPhoto(e.target.files?.[0] ?? null)}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                    <Upload className="h-4 w-4 mr-2" />{photoFile ? "Change photo" : "Upload / take photo"}
                  </Button>
                  <p className="text-[11px] text-muted-foreground mt-1">JPEG / PNG. Phone camera works too.</p>
                </div>
              </div>

              {/* Identity */}
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label>Full name *</Label>
                  <Input value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} placeholder="Jane Mwangi" />
                </div>
                <div>
                  <Label>Phone</Label>
                  <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="07XX XXX XXX" />
                </div>
                <div>
                  <Label>Email *</Label>
                  <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="jane@goldenauto.co.ke" />
                </div>
                <div>
                  <Label>National ID</Label>
                  <Input value={form.national_id} onChange={e => setForm({ ...form, national_id: e.target.value })} placeholder="ID number" />
                </div>
                <div className="sm:col-span-2">
                  <Label>Address</Label>
                  <Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Estate / town" />
                </div>
              </div>

              {/* Access */}
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label>Role *</Label>
                  <Select value={form.role} onValueChange={(v: Role) => setForm({ ...form, role: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{allRoles.map(r => <SelectItem key={r} value={r} className="capitalize">{r.replace("_"," ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Temporary password *</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={form.password}
                      onChange={e => setForm({ ...form, password: e.target.value })}
                      placeholder="≥ 6 characters"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(s => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {form.role === "mechanic" && (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-3">
                  <p className="text-sm font-semibold flex items-center gap-1.5"><Wrench className="h-4 w-4 text-primary" />Mechanic profile</p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <Label>Experience level</Label>
                      <Select value={form.mech_level} onValueChange={(v: any) => setForm({ ...form, mech_level: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="junior">Junior</SelectItem>
                          <SelectItem value="mid">Mid-level</SelectItem>
                          <SelectItem value="senior">Senior</SelectItem>
                          <SelectItem value="lead">Lead / Foreman</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>Specialties <span className="text-xs text-muted-foreground font-normal">(tap to toggle)</span></Label>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {SPECIALTY_OPTIONS.map(s => {
                        const list = form.mech_specialties.split(",").map(x => x.trim()).filter(Boolean);
                        const on = list.includes(s);
                        return (
                          <button key={s} type="button"
                            onClick={() => {
                              const next = on ? list.filter(x => x !== s) : [...list, s];
                              setForm({ ...form, mech_specialties: next.join(", ") });
                            }}
                            className={`px-2.5 py-1 rounded-full text-xs border transition ${on ? "bg-primary text-primary-foreground border-primary" : "bg-muted/40 hover:bg-muted"}`}
                          >{s}</button>
                        );
                      })}
                    </div>
                    <Input className="mt-2" placeholder="Other (comma-separated)" value={form.mech_specialties} onChange={e => setForm({ ...form, mech_specialties: e.target.value })} />
                  </div>
                </div>
              )}

              <div>
                <Label>Notes</Label>
                <Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Anything useful — shift, languages, emergency contact…" />
              </div>

              <label className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.enrol_fingerprint}
                  onChange={e => setForm({ ...form, enrol_fingerprint: e.target.checked })}
                  className="mt-1"
                />
                <div>
                  <p className="text-sm font-medium flex items-center gap-1"><Fingerprint className="h-4 w-4" /> Enrol fingerprint on this device after creating</p>
                  <p className="text-xs text-muted-foreground">Tick this if the new staff member is here now and you're using their reception tablet / phone.</p>
                </div>
              </label>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setOpen(false); resetForm(); }}>Cancel</Button>
              <Button onClick={create} disabled={creating} className="bg-gradient-primary">
                {creating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating…</> : "Create user"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isSuper && (
        <Card className="p-5 border-amber-500/40">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="h-4 w-4 text-amber-500" />
            <h3 className="font-semibold">AI Routing <span className="text-xs text-muted-foreground font-normal">(super admin only)</span></h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Route fast chat, structured analysis, and image tasks to the provider you prefer. These settings are read by the edge functions at runtime.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Default provider</Label>
              <Select
                value={aiSettings.ai_default_provider}
                onValueChange={(value: AIProvider) => setAiSettings({ ...aiSettings, ai_default_provider: value })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AI_PROVIDER_OPTIONS.map((provider) => (
                    <SelectItem key={provider.value} value={provider.value}>{provider.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Chat route</Label>
              <Select
                value={aiSettings.ai_chat_provider}
                onValueChange={(value: AIProvider) => setAiSettings({ ...aiSettings, ai_chat_provider: value })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AI_PROVIDER_OPTIONS.map((provider) => (
                    <SelectItem key={provider.value} value={provider.value}>{provider.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Analysis route</Label>
              <Select
                value={aiSettings.ai_analysis_provider}
                onValueChange={(value: AIProvider) => setAiSettings({ ...aiSettings, ai_analysis_provider: value })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AI_PROVIDER_OPTIONS.map((provider) => (
                    <SelectItem key={provider.value} value={provider.value}>{provider.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Image route</Label>
              <Select
                value={aiSettings.ai_image_provider}
                onValueChange={(value: AIProvider) => setAiSettings({ ...aiSettings, ai_image_provider: value })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AI_PROVIDER_OPTIONS.map((provider) => (
                    <SelectItem key={provider.value} value={provider.value}>{provider.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>
      )}

      {isSuper && (
        <Card className="p-5 border-amber-500/40">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound className="h-4 w-4 text-amber-500" />
            <h3 className="font-semibold">Fallback AI Keys</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            These single provider keys are used only when no active rotation key exists for that provider. You can still keep the real secrets in Supabase env vars if you prefer.
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <Label>Gemini fallback key</Label>
              <Input
                type={showGeminiKey ? "text" : "password"}
                value={aiSettings.gemini_api_key}
                onChange={(e) => setAiSettings({ ...aiSettings, gemini_api_key: e.target.value })}
                placeholder={settingsLoaded ? "AIza..." : "Loading..."}
                className="font-mono text-xs"
              />
            </div>
            <div className="flex items-end">
              <Button variant="outline" type="button" onClick={() => setShowGeminiKey((s) => !s)}>
                {showGeminiKey ? "Hide" : "Show"}
              </Button>
            </div>
            <div>
              <Label>Groq fallback key</Label>
              <Input
                type={showGroqKey ? "text" : "password"}
                value={aiSettings.groq_api_key}
                onChange={(e) => setAiSettings({ ...aiSettings, groq_api_key: e.target.value })}
                placeholder={settingsLoaded ? "gsk_..." : "Loading..."}
                className="font-mono text-xs"
              />
            </div>
            <div className="flex items-end">
              <Button variant="outline" type="button" onClick={() => setShowGroqKey((s) => !s)}>
                {showGroqKey ? "Hide" : "Show"}
              </Button>
            </div>
          </div>
          <div className="mt-4">
            <Button onClick={saveAiSettings} disabled={savingAiSettings} className="bg-gradient-primary">
              {savingAiSettings ? "Saving..." : "Save AI settings"}
            </Button>
          </div>
        </Card>
      )}

      {isSuper && (
        <Card className="p-5 border-amber-500/40">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound className="h-4 w-4 text-amber-500" />
            <h3 className="font-semibold">AI Key Rotation Pool</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Add several API keys. When one hits its quota or fails, Tronix automatically rotates to the next active key — and starts back at the top once they've all been tried.
          </p>
          <div className="grid gap-2 sm:grid-cols-[160px_1fr_2fr_auto] mb-4">
            <Select value={keyForm.provider} onValueChange={(value: AIProvider) => setKeyForm({ ...keyForm, provider: value })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {AI_PROVIDER_OPTIONS.map((provider) => (
                  <SelectItem key={provider.value} value={provider.value}>{provider.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder={`Label (e.g. '${keyForm.provider === "groq" ? "Groq" : "Gemini"} #1')`} value={keyForm.label} onChange={e => setKeyForm({ ...keyForm, label: e.target.value })} />
            <div className="relative">
              <Input
                placeholder="API key"
                type={showNewApiKey ? "text" : "password"}
                className="font-mono text-xs pr-10"
                value={keyForm.api_key}
                onChange={e => setKeyForm({ ...keyForm, api_key: e.target.value })}
              />
              <button
                type="button"
                onClick={() => setShowNewApiKey(s => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showNewApiKey ? "Hide API key" : "Show API key"}
              >
                {showNewApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button onClick={addAiKey} className="bg-gradient-primary"><Plus className="h-4 w-4 mr-1" />Add</Button>
          </div>
          {aiKeys.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No rotation keys yet. Without a pool, the AI layer falls back to the single provider keys above or to Supabase secrets.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="p-2">Provider</th><th className="p-2">Label</th><th className="p-2">Last used</th><th className="p-2">Failures</th><th className="p-2 text-right">Actions</th>
              </tr></thead>
              <tbody>
                {aiKeys.map(k => (
                  <tr key={k.id} className="border-b last:border-0">
                    <td className="p-2 capitalize">{k.provider}</td>
                    <td className="p-2 font-medium">{k.label}</td>
                    <td className="p-2 text-xs text-muted-foreground">{k.last_used_at ? new Date(k.last_used_at).toLocaleString("en-GB") : "—"}</td>
                    <td className="p-2">{k.failure_count}</td>
                    <td className="p-2 text-right space-x-1">
                      <Button size="sm" variant="outline" onClick={() => toggleAiKey(k)}>
                        <CircleDot className={`h-3 w-3 mr-1 ${k.active ? "text-success" : "text-muted-foreground"}`} />
                        {k.active ? "Active" : "Disabled"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => deleteAiKey(k.id)}><Trash2 className="h-3 w-3" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <Card>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs uppercase text-muted-foreground">
            <th className="p-3">Staff</th><th className="p-3">Contact</th><th className="p-3">Roles</th><th className="p-3">Fingerprint</th><th className="p-3 text-right">Actions</th>
          </tr></thead>
          <tbody>
            {visible.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No users.</td></tr>
              : visible.map(p => {
                const userRoles = roles.filter(r => r.user_id === p.id).map(r => r.role);
                return (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8">
                          {p.avatar_url && <AvatarImage src={p.avatar_url} alt={p.display_name ?? ""} />}
                          <AvatarFallback className="bg-gradient-primary text-[10px] font-bold text-primary-foreground">
                            {(p.display_name ?? p.email ?? "?").split(" ").map(n => n[0]).join("").slice(0,2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{p.display_name ?? "—"}</span>
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground">
                      <div>{p.email ?? "—"}</div>
                      {p.phone && <div className="text-xs">{p.phone}</div>}
                    </td>
                    <td className="p-3 space-x-1">
                      {userRoles.length === 0 && <Badge variant="secondary">none</Badge>}
                      {userRoles.map(r => (
                        <Badge key={r} variant="secondary" className="capitalize cursor-pointer hover:bg-destructive/20"
                          onClick={() => removeRole(p.id, r)} title="Click to remove">
                          {r.replace("_"," ")} ✕
                        </Badge>
                      ))}
                    </td>
                    <td className="p-3">
                      <Button size="sm" variant="outline" onClick={() => enrolFingerprint(p)}>
                        <Fingerprint className="h-3 w-3 mr-1" />
                        Enrol {credCounts[p.id] ? `(${credCounts[p.id]})` : ""}
                      </Button>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => openEdit(p)} title="Edit details">
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Select onValueChange={(v: Role) => addRole(p.id, v)}>
                          <SelectTrigger className="w-36"><SelectValue placeholder="+ add role" /></SelectTrigger>
                          <SelectContent>
                            {allRoles.filter(r => !userRoles.includes(r)).map(r => (
                              <SelectItem key={r} value={r} className="capitalize">{r.replace("_"," ")}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit user details</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid sm:grid-cols-2 gap-3">
              <div><Label>Full name</Label><Input value={editForm.display_name} onChange={e => setEditForm({ ...editForm, display_name: e.target.value })} /></div>
              <div><Label>Phone</Label><Input value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} /></div>
              <div className="sm:col-span-2"><Label>Email</Label><Input type="email" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} /></div>
              <div><Label>National ID</Label><Input value={editForm.national_id} onChange={e => setEditForm({ ...editForm, national_id: e.target.value })} /></div>
              <div><Label>Address</Label><Input value={editForm.address} onChange={e => setEditForm({ ...editForm, address: e.target.value })} /></div>
            </div>
            <div><Label>Notes</Label><Textarea rows={3} value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} /></div>
            <p className="text-[11px] text-muted-foreground">To change the password, ask the user to use "Forgot password" on the login screen.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={savingEdit} className="bg-gradient-primary">
              {savingEdit ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
