import type { Role } from "@/lib/auth";

const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Executive access",
  admin: "Admin",
  director: "Director",
  manager: "Manager",
  reception: "Reception",
  mechanic: "Mechanic",
  storekeeper: "Storekeeper",
  gateman: "Gate",
};

export function formatRoleLabel(role?: string | null) {
  if (!role) return "User";
  return ROLE_LABELS[role as Role] ?? role.replaceAll("_", " ");
}
