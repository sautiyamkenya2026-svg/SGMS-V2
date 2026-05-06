export const GENERATED_DOC_TYPES = new Set(["quotation", "deposit_invoice", "invoice", "receipt"]);

type GeneratedDocument = {
  id?: string;
  job_id?: string | null;
  doc_type?: string | null;
  invoice_no?: string | null;
  plate?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type GeneratedMovement = {
  id?: string;
  reference?: string | null;
  created_at?: string | null;
};

const fallbackRowKey = (id?: string) => `row:${id ?? Math.random().toString(36).slice(2)}`;
const normalizeTextKey = (value?: string | null) => String(value ?? "").trim().toUpperCase();
const normalizePlateKey = (value?: string | null) => normalizeTextKey(value).replace(/\s+/g, "");

function documentLogicalKey<T extends GeneratedDocument>(document: T) {
  const docType = String(document.doc_type ?? "");
  if (!GENERATED_DOC_TYPES.has(docType)) return fallbackRowKey(document.id);

  if (document.job_id) return `job:${document.job_id}:${docType}`;

  const invoiceNo = normalizeTextKey(document.invoice_no);
  if (invoiceNo) return `invoice:${invoiceNo}`;

  const plate = normalizePlateKey(document.plate);
  if (plate) return `plate:${plate}:${docType}`;

  return fallbackRowKey(document.id);
}

export function canonicalizeDocuments<T extends GeneratedDocument>(documents: T[]) {
  const byKey = new Map<string, T>();

  for (const document of documents) {
    const key = documentLogicalKey(document);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, document);
      continue;
    }

    const existingTime = new Date(existing.updated_at ?? existing.created_at ?? 0).getTime();
    const currentTime = new Date(document.updated_at ?? document.created_at ?? 0).getTime();
    if (currentTime >= existingTime) byKey.set(key, document);
  }

  return Array.from(byKey.values());
}

export function canonicalizeGeneratedMovements<T extends GeneratedMovement>(movements: T[]) {
  const byKey = new Map<string, T>();

  for (const movement of movements) {
    const reference = String(movement.reference ?? "");
    const isGenerated = reference.startsWith("job-line:") || reference.startsWith("part_request:");
    const key = isGenerated ? reference : fallbackRowKey(movement.id);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, movement);
      continue;
    }

    const existingTime = new Date(existing.created_at ?? 0).getTime();
    const currentTime = new Date(movement.created_at ?? 0).getTime();
    if (currentTime >= existingTime) byKey.set(key, movement);
  }

  return Array.from(byKey.values());
}
