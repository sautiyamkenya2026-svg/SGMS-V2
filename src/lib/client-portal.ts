export const CLIENT_PORTAL_EMAIL_DOMAIN = "client.goldenauto.local";

export function normalizePlateUsername(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizeClientPortalPhone(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("254") && digits.length === 12) return `0${digits.slice(3)}`;
  if ((digits.startsWith("7") || digits.startsWith("1")) && digits.length === 9) return `0${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return digits;
  return digits;
}

export function clientPortalEmailFromPlate(plate: string) {
  const normalized = normalizePlateUsername(plate);
  return normalized ? `${normalized.toLowerCase()}@${CLIENT_PORTAL_EMAIL_DOMAIN}` : "";
}

export function clientPortalPasswordFromPhone(phone: string, fallbackPlate: string) {
  const normalizedPhone = normalizeClientPortalPhone(phone);
  return (normalizedPhone || normalizePlateUsername(fallbackPlate)).slice(0, 72);
}

export function looksLikeEmail(value: string) {
  return value.includes("@");
}
