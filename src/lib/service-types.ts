export const SERVICE_TYPE_OPTIONS = [
  { value: "mechanical", label: "Mechanical" },
  { value: "service", label: "Service" },
  { value: "electrical", label: "Electrical" },
  { value: "general_checkup", label: "General Check-up" },
  { value: "body", label: "Body / Paint" },
  { value: "diagnosis", label: "Diagnosis only" },
] as const;

export type ServiceTypeValue = typeof SERVICE_TYPE_OPTIONS[number]["value"];

const SERVICE_TYPE_SET = new Set<string>(SERVICE_TYPE_OPTIONS.map((option) => option.value));
const SERVICE_TYPE_LABELS: Record<ServiceTypeValue, string> = SERVICE_TYPE_OPTIONS.reduce((map, option) => {
  map[option.value] = option.label;
  return map;
}, {} as Record<ServiceTypeValue, string>);

export const DEFAULT_SERVICE_TYPE: ServiceTypeValue = "mechanical";

export const normalizeServiceTypes = (values: Array<string | null | undefined>) => {
  const normalized: ServiceTypeValue[] = [];
  for (const value of values) {
    const key = String(value ?? "").trim().toLowerCase();
    if (!SERVICE_TYPE_SET.has(key) || normalized.includes(key as ServiceTypeValue)) continue;
    normalized.push(key as ServiceTypeValue);
  }
  return normalized;
};

export const getServiceTypes = (
  serviceTypes: Array<string | null | undefined> | null | undefined,
  fallbackServiceType?: string | null,
) => {
  const fromArray = normalizeServiceTypes(serviceTypes ?? []);
  if (fromArray.length > 0) return fromArray;
  const fallback = normalizeServiceTypes([fallbackServiceType]);
  return fallback.length > 0 ? fallback : [DEFAULT_SERVICE_TYPE];
};

export const primaryServiceType = (
  serviceTypes: Array<string | null | undefined> | null | undefined,
  fallbackServiceType?: string | null,
) => getServiceTypes(serviceTypes, fallbackServiceType)[0] ?? DEFAULT_SERVICE_TYPE;

export const serviceTypeIncludes = (
  serviceTypes: Array<string | null | undefined> | null | undefined,
  fallbackServiceType: string | null | undefined,
  candidate: ServiceTypeValue,
) => getServiceTypes(serviceTypes, fallbackServiceType).includes(candidate);

export const formatServiceTypes = (
  serviceTypes: Array<string | null | undefined> | null | undefined,
  fallbackServiceType?: string | null,
) => getServiceTypes(serviceTypes, fallbackServiceType)
  .map((value) => SERVICE_TYPE_LABELS[value] ?? value)
  .join(", ");

export const serviceTypeLabel = (value: string | null | undefined) => {
  const normalized = normalizeServiceTypes([value])[0];
  if (!normalized) return value ? String(value) : DEFAULT_SERVICE_TYPE;
  return SERVICE_TYPE_LABELS[normalized];
};
