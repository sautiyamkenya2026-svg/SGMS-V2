import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Send, X, Sparkles, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { CameraInput } from "@/components/CameraInput";
import { readEdgeFunctionErrorMessage } from "@/lib/edge-function-error";

type Msg = { role: "user" | "assistant"; content: string; image?: string };

interface Props {
  fullPage?: boolean;
  className?: string;
}

export function TronixChat({ fullPage = false, className }: Props) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content: "Hi, I'm **Tronix** ⚡ — your Golden Automotive Solutions AI. Ask me about jobs, stock, invoices, or upload a photo of a part / dashboard light and I'll diagnose it.",
    },
  ]);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const onPickImage = (file: File, dataUrl: string) => {
    if (file.size > 4 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Max 4MB.", variant: "destructive" });
      return;
    }
    setImage(dataUrl);
  };

  const send = async () => {
    if (!input.trim() && !image) return;
    const userMsg: Msg = { role: "user", content: input.trim() || "(see attached image)", image: image ?? undefined };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    const sentImage = image;
    setImage(null);
    setLoading(true);
    try {
      const { data, error, response } = await supabase.functions.invoke("tronix", {
        body: {
          messages: next.map(({ role, content }) => ({ role, content })),
          image: sentImage,
        },
      });
      if (error) {
        throw new Error(await readEdgeFunctionErrorMessage(error, response, "Tronix request failed."));
      }
      if (data?.error) throw new Error(data.error);
      setMessages((m) => [...m, { role: "assistant", content: data.reply ?? "(no reply)" }]);
    } catch (e: any) {
      toast({ title: "Tronix error", description: e.message ?? String(e), variant: "destructive" });
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${e.message ?? "Something went wrong."}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className={cn("flex flex-col bg-card", fullPage ? "h-[calc(100vh-8rem)]" : "h-[560px]", className)}>
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-primary to-accent">
          <Sparkles className="h-4 w-4 text-primary-foreground" />
        </div>
        <div>
          <p className="text-sm font-bold">Tronix</p>
          <p className="text-[11px] text-muted-foreground">Golden Automotive Solutions AI</p>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
              )}
            >
              {m.image && <img src={m.image} alt="upload" className="mb-2 max-h-48 rounded" />}
              {m.role === "assistant" ? (
                <div className="prose prose-sm dark:prose-invert max-w-none [&>*]:my-1">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{m.content}</p>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-3 py-2 text-sm flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
            </div>
          </div>
        )}
      </div>

      {image && (
        <div className="border-t px-4 py-2 flex items-center gap-2">
          <img src={image} alt="preview" className="h-12 w-12 rounded object-cover" />
          <span className="text-xs text-muted-foreground flex-1">Image attached</span>
          <Button size="icon" variant="ghost" onClick={() => setImage(null)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div className="border-t p-3 flex items-center gap-2">
        <CameraInput onPick={onPickImage} disabled={loading} />
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
          placeholder="Ask Tronix anything…"
          disabled={loading}
        />
        <Button size="icon" onClick={send} disabled={loading || (!input.trim() && !image)}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
