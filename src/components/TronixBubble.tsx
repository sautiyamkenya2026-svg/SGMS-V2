import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TronixChat } from "./TronixChat";
import { useAuth } from "@/lib/auth";

type BubblePosition = { x: number; y: number };

const BUTTON_SIZE = 56;
const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 560;
const EDGE_GAP = 16;
const STORAGE_KEY = "tronix-bubble-position";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getDefaultPosition = (): BubblePosition => ({
  x: Math.max(EDGE_GAP, window.innerWidth - BUTTON_SIZE - 24),
  y: Math.max(EDGE_GAP, window.innerHeight - BUTTON_SIZE - 24),
});

const clampPosition = (position: BubblePosition): BubblePosition => ({
  x: clamp(position.x, EDGE_GAP, Math.max(EDGE_GAP, window.innerWidth - BUTTON_SIZE - EDGE_GAP)),
  y: clamp(position.y, EDGE_GAP, Math.max(EDGE_GAP, window.innerHeight - BUTTON_SIZE - EDGE_GAP)),
});

export function TronixBubble() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<BubblePosition | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      setPosition(getDefaultPosition());
      return;
    }

    try {
      const parsed = JSON.parse(saved) as BubblePosition;
      setPosition(clampPosition(parsed));
    } catch {
      setPosition(getDefaultPosition());
    }
  }, []);

  useEffect(() => {
    if (!position) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
  }, [position]);

  useEffect(() => {
    const onResize = () => {
      setPosition((current) => clampPosition(current ?? getDefaultPosition()));
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!user || !position) return null;

  const panelWidth = Math.min(PANEL_WIDTH, window.innerWidth - EDGE_GAP * 2);
  const panelHeight = Math.min(PANEL_HEIGHT, window.innerHeight - EDGE_GAP * 2);
  const panelLeft = clamp(position.x + BUTTON_SIZE - panelWidth, EDGE_GAP, Math.max(EDGE_GAP, window.innerWidth - panelWidth - EDGE_GAP));
  const panelTop = clamp(position.y - panelHeight - 12, EDGE_GAP, Math.max(EDGE_GAP, window.innerHeight - panelHeight - EDGE_GAP));

  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = clampPosition({
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    });
    drag.moved = drag.moved || Math.abs(event.clientX - drag.startX) > 4 || Math.abs(event.clientY - drag.startY) > 4;
    setPosition(next);
  };

  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const shouldToggle = !drag.moved;
    dragRef.current = null;
    if (shouldToggle) {
      setOpen((current) => !current);
    }
  };

  return (
    <>
      {open && (
        <div
          className="fixed z-50 overflow-hidden rounded-lg shadow-2xl animate-fade-in"
          style={{ left: panelLeft, top: panelTop, width: panelWidth, maxWidth: `calc(100vw - ${EDGE_GAP * 2}px)`, height: panelHeight }}
        >
          <TronixChat className="h-full" />
        </div>
      )}
      <Button
        size="icon"
        className="fixed z-50 h-14 w-14 rounded-full bg-gradient-to-br from-primary to-accent shadow-lg transition hover:scale-105"
        style={{ left: position.x, top: position.y, touchAction: "none" }}
        aria-label="Open Tronix"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={() => { dragRef.current = null; }}
      >
        {open ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
      </Button>
    </>
  );
}
