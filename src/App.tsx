import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";
import Index from "./pages/Index.tsx";
import Jobs from "./pages/Jobs.tsx";
import Stock from "./pages/Stock.tsx";
import Inventory from "./pages/Inventory.tsx";
import Invoices from "./pages/Invoices.tsx";
import PettyCash from "./pages/PettyCash.tsx";
import Suppliers from "./pages/Suppliers.tsx";
import Reports from "./pages/Reports.tsx";
import Settings from "./pages/Settings.tsx";
import Tronix from "./pages/Tronix.tsx";
import Tools from "./pages/Tools.tsx";
import Requests from "./pages/Requests.tsx";
import Gate from "./pages/Gate.tsx";
import Users from "./pages/Users.tsx";
import NotFound from "./pages/NotFound.tsx";
import ClientApproval from "./pages/ClientApproval.tsx";
import Attendance from "./pages/Attendance.tsx";
import ClientPortal from "./pages/ClientPortal.tsx";
import Payroll from "./pages/Payroll.tsx";
import { RoleGuard } from "./components/RoleGuard";

const FIN = ["admin","reception","manager","director","super_admin"] as const;
const FULL = ["admin","director","super_admin"] as const;
const STOCK = ["admin","storekeeper","reception","manager","director","super_admin"] as const;
const TOOLS = ["admin","storekeeper","mechanic","manager","director","super_admin"] as const;
const REQS  = ["admin","reception","mechanic","storekeeper","manager","director","super_admin"] as const;
const GATE  = ["admin","reception","gateman","manager","director","super_admin"] as const;
const REPS  = ["admin","director","super_admin"] as const;
const ATTN  = ["admin","gateman","director","super_admin"] as const;
const PAYRL = ["director","super_admin"] as const;

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/approve/:token" element={<ClientApproval />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Index />} />
              <Route path="/jobs" element={<Jobs />} />
              <Route path="/invoices" element={<RoleGuard allow={[...FIN]}><Invoices /></RoleGuard>} />
              <Route path="/petty-cash" element={<RoleGuard allow={[...STOCK]}><PettyCash /></RoleGuard>} />
              <Route path="/suppliers" element={<RoleGuard allow={[...FULL]}><Suppliers /></RoleGuard>} />
              <Route path="/stock" element={<RoleGuard allow={[...STOCK]}><Stock /></RoleGuard>} />
              <Route path="/inventory" element={<RoleGuard allow={[...STOCK]}><Inventory /></RoleGuard>} />
              <Route path="/tools" element={<RoleGuard allow={[...TOOLS]}><Tools /></RoleGuard>} />
              <Route path="/requests" element={<RoleGuard allow={[...REQS]}><Requests /></RoleGuard>} />
              <Route path="/gate" element={<RoleGuard allow={[...GATE]}><Gate /></RoleGuard>} />
              <Route path="/attendance" element={<RoleGuard allow={[...ATTN]}><Attendance /></RoleGuard>} />
              <Route path="/payroll" element={<RoleGuard allow={[...PAYRL]}><Payroll /></RoleGuard>} />
              <Route path="/client" element={<RoleGuard allow={["client"]}><ClientPortal /></RoleGuard>} />
              <Route path="/users" element={<RoleGuard allow={[...FULL]}><Users /></RoleGuard>} />
              <Route path="/reports" element={<RoleGuard allow={[...REPS]}><Reports /></RoleGuard>} />
              <Route path="/tronix" element={<Tronix />} />
              <Route path="/settings" element={<RoleGuard allow={[...FULL]}><Settings /></RoleGuard>} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
