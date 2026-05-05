import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Fingerprint, KeyRound } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

/**
 * First time a user logs in on a given calendar day, we ask them to
 * confirm their identity with WebAuthn (Touch ID / Windows Hello).
 * They can also tap "I'll key in at reception" to defer.
 * The check-in is logged to staff_attendance and bumps profile.last_seen_at.
 */
export function BiometricGate() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    const todayKey = `gas_attendance_${user.id}_${new Date().toISOString().slice(0,10)}`;
    if (localStorage.getItem(todayKey)) return; // already prompted today
    setOpen(true);
  }, [user]);

  // heartbeat: bump last_seen every 60s while the tab is open
  useEffect(() => {
    if (!user) return;
    const ping = () => supabase.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", user.id);
    ping();
    const id = setInterval(ping, 60_000);
    return () => clearInterval(id);
  }, [user]);

  const recordCheckIn = async (method: "webauthn" | "pin" | "manual") => {
    if (!user) return;
    await supabase.from("staff_attendance").insert({
      user_id: user.id, event: "check_in", method,
      device_label: navigator.userAgent.slice(0, 120),
    });
    await supabase.from("profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", user.id);
    localStorage.setItem(`gas_attendance_${user.id}_${new Date().toISOString().slice(0,10)}`, "1");
  };

  const verifyBiometric = async () => {
    setBusy(true);
    try {
      if (!("credentials" in navigator) || !window.PublicKeyCredential) {
        throw new Error("This device does not support biometrics.");
      }
      // If the user has an enrolled credential on this device, do a 'get'
      // (proves possession). Otherwise fall back to 'create' (proof-of-
      // presence + auto-enrol the device for next time).
      const { data: creds } = await supabase
        .from("webauthn_credentials")
        .select("credential_id")
        .eq("user_id", user!.id);
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      if (creds && creds.length > 0) {
        await navigator.credentials.get({
          publicKey: {
            challenge,
            timeout: 30_000,
            userVerification: "required",
            allowCredentials: creds.map(c => ({
              id: Uint8Array.from(atob(c.credential_id), x => x.charCodeAt(0)),
              type: "public-key",
            })),
          } as any,
        });
      } else {
        const cred = await navigator.credentials.create({
          publicKey: {
            challenge, rp: { name: "Golden Automotive Solutions" },
            user: {
              id: new TextEncoder().encode(user!.id),
              name: user!.email, displayName: user!.displayName,
            },
            pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
            authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
            timeout: 30_000, attestation: "none",
          } as any,
        }) as PublicKeyCredential | null;
        if (cred) {
          const idB64 = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
          await supabase.from("webauthn_credentials").insert({
            user_id: user!.id,
            credential_id: idB64,
            device_label: navigator.userAgent.slice(0, 120),
          });
        }
      }
      await recordCheckIn("webauthn");
      toast({ title: "Checked in ✓", description: "Have a great shift." });
      setOpen(false);
    } catch (e: any) {
      toast({ title: "Biometric check failed", description: e?.message ?? "Try keying in at reception.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const deferToReception = async () => {
    await recordCheckIn("manual");
    toast({ title: "Reminder set", description: "Please key in at reception when you arrive." });
    setOpen(false);
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Fingerprint className="h-5 w-5 text-primary" /> Daily check-in</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Hi {user.displayName.split(" ")[0]} — please confirm you're on shift.
          Use your device's fingerprint / Face ID, or key in at reception.
        </p>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={deferToReception} disabled={busy}>
            <KeyRound className="h-4 w-4 mr-1" /> Key in at reception
          </Button>
          <Button onClick={verifyBiometric} disabled={busy} className="bg-gradient-primary">
            <Fingerprint className="h-4 w-4 mr-1" /> {busy ? "Verifying…" : "Use fingerprint"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}