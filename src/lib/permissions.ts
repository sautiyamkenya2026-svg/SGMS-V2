// Centralised permission helpers.
// Confidentiality tiers (highest to lowest privilege):
//   super_admin / admin / director  -> see EVERYTHING
//   manager                         -> sees sell prices, jobs, invoices, reports
//                                      but NOT cost prices / supplier ledger / AI keys / settings
//   reception                       -> ops + invoices, no cost prices, no supplier ledger
//   storekeeper                     -> stock + tools, no client contacts
//   mechanic                        -> jobs + inspections + part requests only.
//                                      Hides: ALL prices, client contacts, suppliers,
//                                      reports, users, settings, invoices, petty cash.
//   gateman                         -> gate + attendance only
import type { AuthUser, Role } from "@/lib/auth";

const FULL: Role[] = ["super_admin", "admin", "director"];

export function hasAnyRole(u: AuthUser | null, ...roles: Role[]) {
  return !!u && u.roles.some((r) => roles.includes(r));
}
export function isFullPrivilege(u: AuthUser | null) {
  return hasAnyRole(u, ...FULL);
}

/** Can the user see SELLING / quoted / invoiced prices anywhere? */
export function canSeePrices(u: AuthUser | null) {
  // mechanics & gatemen do not see prices
  if (!u) return false;
  if (hasAnyRole(u, "mechanic", "gateman")) return false;
  return true;
}

/** Can the user see COST / buy prices, profit, supplier buy/sell ledgers? */
export function canSeeCostPrices(u: AuthUser | null) {
  return isFullPrivilege(u);
}

/** Can the user view supplier ledger / supplier financials? */
export function canSeeSupplierLedger(u: AuthUser | null) {
  return isFullPrivilege(u);
}

/** Can the user view client contact details (phone/email/address)? */
export function canSeeClientContacts(u: AuthUser | null) {
  if (!u) return false;
  // mechanics & storekeepers should not see client contacts
  if (hasAnyRole(u, "mechanic", "storekeeper", "gateman")) return false;
  return true;
}

/** Mask any monetary value when not allowed to see prices. */
export function maskPrice(value: number | string | null | undefined, allowed: boolean, currency = "KSh") {
  if (allowed) return `${currency} ${Number(value || 0).toLocaleString()}`;
  return "—";
}

/** Mask a phone / email / contact string. */
export function maskContact(value: string | null | undefined, allowed: boolean) {
  if (allowed) return value ?? "";
  if (!value) return "";
  return "•••• hidden";
}
