import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TronixChat } from "./TronixChat";
import { useAuth } from "@/lib/auth";
import { useLocation } from "react-router-dom";

export function TronixBubble() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!user) return null;
  if (pathname === "/tronix") return null; // hide on dedicated page

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[380px] max-w-[calc(100vw-3rem)] shadow-2xl rounded-lg overflow-hidden animate-fade-in">
          <TronixChat />
        </div>
      )}
      <Button
        onClick={() => setOpen((v) => !v)}
        size="icon"
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg bg-gradient-to-br from-primary to-accent hover:scale-105 transition"
        aria-label="Open Tronix"
      >
        {open ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
      </Button>
    </>
  );
}
