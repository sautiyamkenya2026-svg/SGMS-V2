import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Wrench, Package, Boxes, BarChart3, Settings, LogOut, FileText, Wallet, Building2, Sparkles, Hammer, Users, ClipboardList, DoorOpen, Fingerprint, Battery, CarFront } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { useAuth, type Role } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import logo from "@/assets/golden-logo.png";

type Item = { title: string; url: string; icon: any; roles?: Role[] };

const items: Item[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, roles: ["admin","reception","manager","director","super_admin","storekeeper"] },
  { title: "Client Portal", url: "/client", icon: CarFront, roles: ["client"] },
  { title: "Jobs", url: "/jobs", icon: Wrench, roles: ["admin","reception","manager","director","super_admin","mechanic"] },
  { title: "Invoices", url: "/invoices", icon: FileText, roles: ["admin","reception","manager","director","super_admin"] },
  { title: "Stock", url: "/stock", icon: Boxes, roles: ["admin","storekeeper","reception","manager","director","super_admin"] },
  { title: "Tools", url: "/tools", icon: Hammer, roles: ["admin","storekeeper","mechanic","manager","director","super_admin"] },
  { title: "Suppliers", url: "/suppliers", icon: Building2, roles: ["admin","director","super_admin"] },
  { title: "Petty Cash", url: "/petty-cash", icon: Wallet, roles: ["admin","reception","storekeeper","manager","director","super_admin"] },
  { title: "Requests", url: "/requests", icon: ClipboardList, roles: ["admin","reception","mechanic","storekeeper","manager","director","super_admin"] },
  { title: "Gate Control", url: "/gate", icon: DoorOpen, roles: ["admin","reception","gateman","manager","director","super_admin"] },
  { title: "Attendance", url: "/attendance", icon: Fingerprint, roles: ["admin","reception","gateman","manager","director","super_admin"] },
  { title: "Reports", url: "/reports", icon: BarChart3, roles: ["admin","manager","director","super_admin"] },
  { title: "Tronix AI", url: "/tronix", icon: Sparkles, roles: ["admin","reception","manager","director","super_admin","mechanic","storekeeper"] },
  { title: "User Management", url: "/users", icon: Users, roles: ["admin","director","super_admin"] },
  { title: "Settings", url: "/settings", icon: Settings, roles: ["admin","director","super_admin"] },
];

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const { user, logout, hasRole } = useAuth();
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [batteryCharging, setBatteryCharging] = useState<boolean>(false);

  useEffect(() => {
    if ('getBattery' in navigator) {
      (navigator as any).getBattery().then((battery: any) => {
        const updateBattery = () => {
          setBatteryLevel(Math.round(battery.level * 100));
          setBatteryCharging(battery.charging);
        };
        updateBattery();
        battery.addEventListener('levelchange', updateBattery);
        battery.addEventListener('chargingchange', updateBattery);
        return () => {
          battery.removeEventListener('levelchange', updateBattery);
          battery.removeEventListener('chargingchange', updateBattery);
        };
      });
    }
  }, []);

  const handleNav = () => { if (isMobile) setOpenMobile(false); };

  const visible = items.filter(i => !i.roles || i.roles.some(r => hasRole(r)));
  const isSuper = hasRole("super_admin");

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border p-3">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Golden Automotive" className="h-10 w-10 rounded-md object-contain shrink-0" />
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="font-display text-sm font-bold text-sidebar-primary">Golden Automotive</span>
              <span className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60">Solution</span>
            </div>
          )}
        </div>
        {!collapsed && batteryLevel !== null && (
          <div className="mt-3 inline-flex items-center gap-1 rounded-full border border-sidebar-border bg-sidebar-accent/60 px-2 py-1 text-[10px] text-sidebar-foreground/70">
            <Battery className={`h-3 w-3 ${batteryCharging ? "text-green-400" : batteryLevel < 20 ? "text-red-400" : "text-sidebar-foreground/70"}`} />
            <span>{batteryLevel}%</span>
            {batteryCharging && <span className="text-green-400">Charging</span>}
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visible.map((item) => {
                const active = pathname === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={active}>
                      <NavLink to={item.url} end className="flex items-center gap-3" onClick={handleNav}>
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        {!collapsed && user && (
          <div className="mb-2 px-2">
            <p className="text-xs font-semibold text-sidebar-foreground">{isSuper ? "Operator" : user.displayName}</p>
            <p className="text-[11px] text-sidebar-foreground/60 capitalize">
              {isSuper ? "operator" : (user.roles[0] ?? "user").replace("_"," ")}
            </p>
            {batteryLevel !== null && (
              <div className="flex items-center gap-1 mt-1">
                <Battery className={`h-3 w-3 ${batteryCharging ? 'text-green-500' : batteryLevel < 20 ? 'text-red-500' : 'text-sidebar-foreground/60'}`} />
                <span className="text-[10px] text-sidebar-foreground/60">{batteryLevel}%</span>
                {batteryCharging && <span className="text-[10px] text-green-500">⚡</span>}
              </div>
            )}
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={logout}
          className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span className="ml-2">Logout</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
