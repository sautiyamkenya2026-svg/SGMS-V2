// Smart capture button: choose between "Take photo" (live camera) or "Choose file".
// On mobile the camera mode opens the rear camera in a fullscreen overlay; on
// desktop it uses the laptop/USB webcam via getUserMedia. Falls back gracefully.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Image as ImageIcon, X, RotateCcw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

interface Props {
  onPick: (file: File, dataUrl: string) => void;
  disabled?: boolean;
  size?: "sm" | "default" | "icon" | "lg";
  variant?: "outline" | "ghost" | "default" | "secondary";
  className?: string;
  label?: string;
  /** Force live camera only (skip the menu) */
  forceCamera?: boolean;
}

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

export function CameraInput({
  onPick, disabled, size = "icon", variant = "outline", className, label, forceCamera,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [camOpen, setCamOpen] = useState(false);

  const handleFile = async (file: File) => {
    const dataUrl = await readAsDataUrl(file);
    onPick(file, dataUrl);
  };

  const openCamera = () => setCamOpen(true);
  const openFiles = () => fileRef.current?.click();

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />

      {forceCamera ? (
        <Button
          type="button"
          size={size}
          variant={variant}
          disabled={disabled}
          onClick={openCamera}
          className={className}
          title="Take photo"
        >
          <Camera className="h-4 w-4" />
          {label && size !== "icon" && <span className="ml-2">{label}</span>}
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size={size}
              variant={variant}
              disabled={disabled}
              className={className}
              title="Take photo or choose from files"
            >
              <Camera className="h-4 w-4" />
              {label && size !== "icon" && <span className="ml-2">{label}</span>}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-[60]">
            <DropdownMenuItem onClick={openCamera}>
              <Camera className="h-4 w-4 mr-2" /> Take photo
            </DropdownMenuItem>
            <DropdownMenuItem onClick={openFiles}>
              <ImageIcon className="h-4 w-4 mr-2" /> Choose from files
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {camOpen && (
        <CameraDialog
          onClose={() => setCamOpen(false)}
          onCapture={async (file, dataUrl) => {
            onPick(file, dataUrl);
            setCamOpen(false);
          }}
        />
      )}
    </>
  );
}

function CameraDialog({
  onClose,
  onCapture,
}: {
  onClose: () => void;
  onCapture: (file: File, dataUrl: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
          setReady(true);
        }
      } catch (e: any) {
        setError(e?.message || "Could not access camera");
        toast.error("Camera unavailable — falling back to file picker");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing]);

  const snap = () => {
    const v = videoRef.current;
    if (!v) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      onCapture(file, dataUrl);
    }, "image/jpeg", 0.9);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      <div className="flex items-center justify-between p-3 text-white">
        <span className="text-sm font-medium">Take photo</span>
        <div className="flex gap-2">
          <Button size="icon" variant="ghost" className="text-white hover:bg-white/10"
            onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
            title="Switch camera"
          >
            <RotateCcw className="h-5 w-5" />
          </Button>
          <Button size="icon" variant="ghost" className="text-white hover:bg-white/10" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        {error ? (
          <div className="text-center text-white/80 p-8">
            <p className="font-semibold mb-2">Camera unavailable</p>
            <p className="text-sm">{error}</p>
            <Button className="mt-4" variant="secondary" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <video ref={videoRef} playsInline muted className="max-h-full max-w-full" />
        )}
      </div>
      <div className="p-6 flex items-center justify-center">
        <button
          type="button"
          disabled={!ready || !!error}
          onClick={snap}
          className="h-16 w-16 rounded-full bg-white border-4 border-white/40 disabled:opacity-50 active:scale-95 transition-transform"
          aria-label="Capture"
        />
      </div>
    </div>
  );
}
