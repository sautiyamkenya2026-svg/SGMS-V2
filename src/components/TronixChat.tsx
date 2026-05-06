import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Send, X, Sparkles, Loader2, Images, History } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { CameraInput } from "@/components/CameraInput";
import { readEdgeFunctionErrorMessage } from "@/lib/edge-function-error";
import { invokeEdgeFunction } from "@/lib/invoke-edge";

type Msg = {
  role: "user" | "assistant";
  content: string;
  images?: string[];
  createdAt?: string;
};

interface Props {
  fullPage?: boolean;
  className?: string;
}

const MAX_IMAGE_SIZE = 4 * 1024 * 1024;
const MAX_IMAGE_COUNT = 6;

const WELCOME_MESSAGE: Msg = {
  role: "assistant",
  content: "Hi, I'm **Tronix**. Ask me anything. I can help with garage work, and I can also chat normally about everyday topics.",
};

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export function TronixChat({ fullPage = false, className }: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [messages, setMessages] = useState<Msg[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(fullPage);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    let alive = true;

    const loadHistory = async () => {
      const { data, error } = await supabase
        .from("tronix_messages")
        .select("role, content, created_at")
        .order("created_at", { ascending: true })
        .limit(120);

      if (!alive) return;
      if (error) {
        setHistoryLoading(false);
        return;
      }

      const history = (data ?? [])
        .filter((row: any) => row.role === "user" || row.role === "assistant")
        .map((row: any) => ({
          role: row.role as "user" | "assistant",
          content: row.content,
          createdAt: row.created_at,
        }));

      setMessages(history.length > 0 ? history : [WELCOME_MESSAGE]);
      setHistoryLoading(false);
    };

    loadHistory();
    return () => {
      alive = false;
    };
  }, []);

  const appendFiles = async (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;

    const remainingSlots = MAX_IMAGE_COUNT - images.length;
    if (remainingSlots <= 0) {
      toast({
        title: "Image limit reached",
        description: `You can attach up to ${MAX_IMAGE_COUNT} images at once.`,
        variant: "destructive",
      });
      return;
    }

    const nextFiles = incoming.slice(0, remainingSlots);
    const tooLarge = nextFiles.find((file) => file.size > MAX_IMAGE_SIZE);
    if (tooLarge) {
      toast({
        title: "Image too large",
        description: `${tooLarge.name} is above 4MB.`,
        variant: "destructive",
      });
      return;
    }

    const nextImages = await Promise.all(nextFiles.map((file) => readAsDataUrl(file)));
    setImages((prev) => [...prev, ...nextImages].slice(0, MAX_IMAGE_COUNT));
  };

  const onPickCameraImage = async (file: File) => {
    if (file.size > MAX_IMAGE_SIZE) {
      toast({ title: "Image too large", description: "Max 4MB.", variant: "destructive" });
      return;
    }
    const dataUrl = await readAsDataUrl(file);
    setImages((prev) => [...prev, dataUrl].slice(0, MAX_IMAGE_COUNT));
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
  };

  const historyTurns: Array<{ index: number; question: string; answer: string; createdAt?: string }> = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.role !== "user") continue;
    let answer = "";
    for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex++) {
      if (messages[nextIndex].role === "user") break;
      if (messages[nextIndex].role === "assistant") {
        answer = messages[nextIndex].content;
        break;
      }
    }
    historyTurns.push({
      index,
      question: message.content,
      answer,
      createdAt: message.createdAt,
    });
  }

  const jumpToMessage = (index: number) => {
    const target = messageRefs.current[index];
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const send = async () => {
    if (!input.trim() && images.length === 0) return;

    const userText = input.trim() || (images.length === 1 ? "(see attached image)" : "(see attached images)");
    const sentImages = [...images];
    const userMsg: Msg = {
      role: "user",
      content: userText,
      images: sentImages.length > 0 ? sentImages : undefined,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setImages([]);
    setLoading(true);

    try {
      const contextMessages = [...messages, userMsg]
        .filter((message) => message.content !== WELCOME_MESSAGE.content)
        .filter((message) => !(message.role === "assistant" && message.content.startsWith("I hit a snag:")))
        .slice(-12)
        .map((message) => ({
          role: message.role,
          content: message.content,
        }));

      const { data, error, response } = await invokeEdgeFunction("tronix", {
        body: {
          messages: contextMessages,
          images: sentImages,
        },
      });
      if (error) {
        throw new Error(await readEdgeFunctionErrorMessage(error, response, "Tronix request failed."));
      }
      if (data?.error) throw new Error(data.error);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.reply ?? "(no reply)",
        },
      ]);
    } catch (e: any) {
      toast({ title: "Tronix error", description: e.message ?? String(e), variant: "destructive" });
      setMessages((prev) => [...prev, { role: "assistant", content: `I hit a snag: ${e.message ?? "Something went wrong."}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      className={cn("overflow-hidden bg-card", fullPage ? "min-h-[560px]" : "h-[560px]", className)}
      style={fullPage ? { height: "calc(100dvh - var(--safe-area-top, 0px) - 10rem)" } : undefined}
    >
      <div className={cn("flex h-full", fullPage ? "flex-col lg:flex-row" : "flex-col")}>
        {fullPage && showHistory && (
          <aside className="flex w-full flex-col border-b bg-muted/20 lg:w-72 lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <p className="text-sm font-semibold">Previous chats</p>
                <p className="text-[11px] text-muted-foreground">Jump back into any saved question.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowHistory(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {historyLoading ? (
                <div className="flex items-center gap-2 rounded-lg bg-background px-3 py-2 text-sm">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading previous chats...
                </div>
              ) : historyTurns.length === 0 ? (
                <p className="rounded-lg bg-background px-3 py-4 text-sm text-muted-foreground">No previous chats yet.</p>
              ) : historyTurns.slice(-18).reverse().map((turn) => (
                <button
                  key={`${turn.index}-${turn.createdAt ?? "turn"}`}
                  className="w-full rounded-lg border bg-background p-3 text-left hover:bg-muted/40"
                  onClick={() => jumpToMessage(turn.index)}
                >
                  <p className="line-clamp-2 text-sm font-medium">{turn.question}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{turn.answer || "Scroll to continue this thread."}</p>
                  {turn.createdAt && <p className="mt-2 text-[10px] text-muted-foreground">{new Date(turn.createdAt).toLocaleString()}</p>}
                </button>
              ))}
            </div>
          </aside>
        )}

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-primary to-accent">
              <Sparkles className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <p className="text-sm font-bold">Tronix</p>
              <p className="text-[11px] text-muted-foreground">Garage brain, general assistant, and saved chat memory.</p>
            </div>
            {fullPage && !showHistory && (
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setShowHistory(true)}>
                <History className="mr-2 h-4 w-4" />History
              </Button>
            )}
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {historyLoading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading previous chats...
                </div>
              </div>
            )}

            {!historyLoading && messages.map((message, index) => (
              <div
                key={`${message.role}-${index}-${message.createdAt ?? "now"}`}
                ref={(node) => { messageRefs.current[index] = node; }}
                className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[88%] rounded-lg px-3 py-2 text-sm",
                    message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
                  )}
                >
                  {message.images && message.images.length > 0 && (
                    <div className="mb-2 grid grid-cols-2 gap-2">
                      {message.images.map((image, imageIndex) => (
                        <img key={`${index}-${imageIndex}`} src={image} alt="upload" className="max-h-32 rounded object-cover" />
                      ))}
                    </div>
                  )}
                  {message.role === "assistant" ? (
                    <div className="prose prose-sm max-w-none [&>*]:my-1">
                      <ReactMarkdown>{message.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                  <Loader2 className="h-3 w-3 animate-spin" /> Thinking...
                </div>
              </div>
            )}
          </div>

          {images.length > 0 && (
            <div className="border-t px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {images.length} image{images.length === 1 ? "" : "s"} attached
                </span>
                <span className="text-[11px] text-muted-foreground">Up to {MAX_IMAGE_COUNT}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {images.map((image, index) => (
                  <div key={`${image.slice(0, 20)}-${index}`} className="relative overflow-hidden rounded-md border">
                    <img src={image} alt="preview" className="h-20 w-full object-cover" />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="absolute right-1 top-1 h-6 w-6 bg-black/45 text-white hover:bg-black/60 hover:text-white"
                      onClick={() => removeImage(index)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-t p-3">
            <div className="flex items-center gap-2">
              <CameraInput onPick={onPickCameraImage} disabled={loading || images.length >= MAX_IMAGE_COUNT} />
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={async (event) => {
                  if (event.target.files) await appendFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                disabled={loading || images.length >= MAX_IMAGE_COUNT}
                onClick={() => fileRef.current?.click()}
                title="Choose several images"
              >
                <Images className="h-4 w-4" />
              </Button>
              <Input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && !event.shiftKey && (event.preventDefault(), send())}
                placeholder="Ask Tronix anything..."
                disabled={loading}
              />
              <Button size="icon" onClick={send} disabled={loading || (!input.trim() && images.length === 0)}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
