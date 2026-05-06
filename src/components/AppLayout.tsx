import { ReactNode } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { TronixBubble } from "./TronixBubble";
import { SchemaHealthBanner } from "./SchemaHealthBanner";

import { useAuth } from "@/lib/auth";
import { Login } from "@/pages/Login";
import { Bell, Search, ArrowLeft, LogOut, User as UserIcon, Settings as SettingsIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";

type Notif = { id: string; title: string; body: string | null; link: string | null; kind: string; read_at: string | null; created_at: string };

export function AppLayout({ children }: { children?: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [q, setQ] = useState("");
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = async () => {
      const { data } = await supabase
        .from("notifications")
        .select("id, title, body, link, kind, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (alive) setNotifs((data ?? []) as Notif[]);
    };
    load();
    const ch = supabase
      .channel("notif-header")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, load)
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [user]);

  if (!user) return <Login />;
  const canGoBack = pathname !== "/" && window.history.length > 1;
  const unread = notifs.filter(n => !n.read_at).length;

  const markAllRead = async () => {
    const ids = notifs.filter(n => !n.read_at).map(n => n.id);
    if (!ids.length) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    navigate(`/jobs?q=${encodeURIComponent(term)}`);
  };

  const initials = user.displayName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <SidebarProvider>
      <div
        className="flex min-h-screen w-full bg-background"
        style={{
          paddingTop: "var(--safe-area-top)",
          paddingBottom: "var(--safe-area-bottom)",
        }}
      >
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <SchemaHealthBanner />
          <header className="flex min-h-14 items-center gap-2 border-b bg-card px-4 shadow-sm">
            <SidebarTrigger />
            {canGoBack && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate(-1)}
                aria-label="Go back"
                className="h-8 w-8"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <form onSubmit={submitSearch} className="relative hidden flex-1 max-w-md md:block ml-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search plate, customer, job #…  (Enter)"
                className="pl-9 h-9 bg-muted/40 border-0"
              />
            </form>
            <div className="ml-auto flex items-center gap-3">
              <Popover open={notifOpen} onOpenChange={(o) => { setNotifOpen(o); if (o) markAllRead(); }}>
                <PopoverTrigger asChild>
                  <button className="relative rounded-md p-2 hover:bg-muted" aria-label="Notifications">
                    <Bell className="h-4 w-4" />
                    {unread > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground">
                        {unread > 9 ? "9+" : unread}
                      </span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-0">
                  <div className="flex items-center justify-between border-b px-3 py-2">
                    <p className="text-sm font-semibold">Notifications</p>
                    <span className="text-xs text-muted-foreground">{notifs.length}</span>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifs.length === 0 ? (
                      <p className="p-6 text-center text-sm text-muted-foreground">You're all caught up 🎉</p>
                    ) : notifs.map(n => (
                      <button
                        key={n.id}
                        onClick={() => { if (n.link) navigate(n.link); setNotifOpen(false); }}
                        className="w-full text-left border-b px-3 py-2 hover:bg-muted/60 last:border-0"
                      >
                        <p className="text-sm font-medium">{n.title}</p>
                        {n.body && <p className="text-xs text-muted-foreground line-clamp-2">{n.body}</p>}
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                        </p>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              <Badge variant="secondary" className="hidden sm:inline-flex capitalize">{user.roles[0] ?? "user"}</Badge>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="rounded-full ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" aria-label="Account">
                    <Avatar className="h-8 w-8">
                      {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.displayName} />}
                      <AvatarFallback className="bg-gradient-primary text-xs font-bold text-primary-foreground">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-9 w-9">
                        {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.displayName} />}
                        <AvatarFallback className="bg-gradient-primary text-xs font-bold text-primary-foreground">{initials}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{user.displayName}</p>
                        <p className="truncate text-xs text-muted-foreground font-normal">{user.email}</p>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/users")}>
                    <UserIcon className="h-4 w-4 mr-2" /> User management
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate("/settings")}>
                    <SettingsIcon className="h-4 w-4 mr-2" /> Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => logout()} className="text-destructive focus:text-destructive">
                    <LogOut className="h-4 w-4 mr-2" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <main className="flex-1 overflow-auto p-4 animate-fade-in sm:p-6">
            {children ?? <Outlet />}
          </main>
        </div>
        <TronixBubble />
      </div>
    </SidebarProvider>
  );
}
