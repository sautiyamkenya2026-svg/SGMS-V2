const STORAGE_PREFIX = "gas-idempotency";

type IdempotencyRecord = {
  requestId: string;
  expiresAt: number;
};

function hasStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeFingerprintPart(value: string | number | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function storageKey(scope: string, fingerprint: string) {
  return `${STORAGE_PREFIX}:${scope}:${fingerprint}`;
}

export function buildIdempotencyFingerprint(parts: Array<string | number | null | undefined>) {
  return parts.map(normalizeFingerprintPart).join("|");
}

export function getIdempotencyRequestId(scope: string, fingerprint: string, ttlMs = 15 * 60_000) {
  if (!hasStorage()) return crypto.randomUUID();

  const now = Date.now();
  const key = storageKey(scope, fingerprint);

  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as IdempotencyRecord;
      if (parsed.requestId && parsed.expiresAt > now) return parsed.requestId;
    }
  } catch {
    window.localStorage.removeItem(key);
  }

  const requestId = crypto.randomUUID();
  const record: IdempotencyRecord = { requestId, expiresAt: now + ttlMs };
  window.localStorage.setItem(key, JSON.stringify(record));
  return requestId;
}

export function clearIdempotencyRequestId(scope: string, fingerprint: string) {
  if (!hasStorage()) return;
  window.localStorage.removeItem(storageKey(scope, fingerprint));
}
