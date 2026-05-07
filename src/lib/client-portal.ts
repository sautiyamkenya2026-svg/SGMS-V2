export const CLIENT_PORTAL_EMAIL_DOMAIN = "client.goldenauto.local";

export function normalizePlateUsername(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function clientPortalEmailFromPlate(plate: string) {
  const normalized = normalizePlateUsername(plate);
  return normalized ? `${normalized.toLowerCase()}@${CLIENT_PORTAL_EMAIL_DOMAIN}` : "";
}

export function clientPortalPasswordFromPhone(phone: string, fallbackPlate: string) {
  const compactPhone = phone.trim().replace(/\s+/g, "");
  return (compactPhone || normalizePlateUsername(fallbackPlate)).slice(0, 72);
}

export function looksLikeEmail(value: string) {
  return value.includes("@");
}
