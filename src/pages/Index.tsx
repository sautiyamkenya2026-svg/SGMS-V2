import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import Dashboard from "./Dashboard";

const Index = () => {
  const { user, hasRole, loading } = useAuth();
  if (loading || !user) return null;
  // Mechanic & gateman don't get the financial dashboard.
  if (hasRole("client")) return <Navigate to="/client" replace />;
  if (hasRole("mechanic")) return <Navigate to="/jobs" replace />;
  if (hasRole("gateman")) return <Navigate to="/gate" replace />;
  return <Dashboard />;
};
export default Index;
