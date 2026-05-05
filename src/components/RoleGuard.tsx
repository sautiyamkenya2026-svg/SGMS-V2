import { Navigate } from "react-router-dom";
import { useAuth, type Role } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";

interface Props {
  allow: Role[];
  children: React.ReactNode;
}
/** Renders children only if the user has any of the allowed roles. */
export function RoleGuard({ allow, children }: Props) {
  const { user, loading, hasRole } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (allow.some((r) => hasRole(r))) return <>{children}</>;
  return (
    <div className="max-w-md mx-auto mt-20">
      <Card className="p-6 text-center space-y-2">
        <ShieldAlert className="h-10 w-10 mx-auto text-destructive" />
        <h2 className="text-lg font-semibold">Restricted area</h2>
        <p className="text-sm text-muted-foreground">
          You don't have permission to view this page. Speak with an administrator if you think this is a mistake.
        </p>
      </Card>
    </div>
  );
}
