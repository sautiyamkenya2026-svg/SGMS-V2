import { TronixChat } from "@/components/TronixChat";
import { Sparkles } from "lucide-react";

export default function Tronix() {
  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent shadow-lg">
          <Sparkles className="h-6 w-6 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-display font-bold">Tronix</h1>
          <p className="text-sm text-muted-foreground">Golden Automotive Solutions AI assistant — diagnostics, data answers, and role-gated actions.</p>
        </div>
      </div>
      <TronixChat fullPage />
    </div>
  );
}
