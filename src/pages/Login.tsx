import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { toast } from "@/hooks/use-toast";
import logo from "@/assets/golden-logo.png";

export function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await signIn(email, password);
    setBusy(false);
    if (res.error) {
      toast({ title: "Sign in failed", description: res.error, variant: "destructive" });
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between gradient-hero p-10 text-primary-foreground relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(42_88%_55%/0.35),transparent_60%)]" />
        <div className="relative z-10 flex items-center gap-3">
          <img src={logo} alt="Golden Automotive Solutions" className="h-14 w-auto drop-shadow-[0_4px_12px_rgba(212,160,23,0.4)]" />
          <div>
            <h1 className="font-display text-xl font-bold leading-tight">Golden Automotive Solutions</h1>
            <p className="text-xs text-white/70 uppercase tracking-wider">Management System</p>
          </div>
        </div>
        <div className="relative z-10 space-y-6">
          <h2 className="font-display text-5xl font-bold leading-tight">
            Run your garage like<br/><span className="text-accent">a control room.</span>
          </h2>
          <p className="text-white/70 max-w-md">
            One workspace for jobs, stock across Nairobi shop & garage store, suppliers, and full vehicle inspections.
          </p>
        </div>
        <p className="relative z-10 text-xs text-white/40">© 2026 Golden Automotive Solutions</p>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md space-y-6">
          <div className="flex flex-col items-center gap-2 lg:hidden">
            <img src={logo} alt="Golden Automotive Solutions" className="h-16 w-auto" />
            <p className="font-display text-base font-semibold text-center">Golden Automotive Solutions</p>
          </div>
          <div className="space-y-2 text-center lg:text-left">
            <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
            <p className="text-sm text-muted-foreground">Sign in to manage your garage. Accounts are created by an administrator.</p>
          </div>

          <form onSubmit={submit} className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
            </div>
            <Button type="submit" disabled={busy} className="w-full bg-gradient-primary hover:opacity-90 shadow-md">
              {busy ? "Please wait…" : "Sign in"}
            </Button>
            <p className="text-xs text-center text-muted-foreground pt-2">
              Don't have an account? Ask your administrator to create one for you.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

export default Login;
