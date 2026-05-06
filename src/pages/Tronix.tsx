import { TronixChat } from "@/components/TronixChat";
import { Sparkles } from "lucide-react";

export default function Tronix() {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent shadow-lg">
          <Sparkles className="h-6 w-6 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-display font-bold">Tronix</h1>
          <p className="text-sm text-muted-foreground">
            Golden Automotive Solutions AI assistant for diagnostics, workshop data, general questions, actions, and continuing chat history.
          </p>
        </div>
      </div>
      <TronixChat fullPage />
    </div>
  );
}
