export function friendlyErrorMessage(error: unknown, fallback = "Something went wrong.") {
  const raw = extractErrorMessage(error).trim();
  if (!raw) return fallback;

  const normalized = raw.toLowerCase();

  if (
    normalized === "forbidden" ||
    /permission denied|insufficient privilege|not authorized|not authorised/.test(normalized) ||
    /row-level security|violates row-level security policy/.test(normalized)
  ) {
    return "You do not have sufficient clearance for this action.";
  }

  if (/only super admin|only super_admin|only super admins/.test(normalized)) {
    return "You do not have sufficient clearance to create that account type.";
  }

  if (/unsupported target status/.test(normalized)) {
    return "That status override is not available.";
  }

  if (/job not found/.test(normalized)) {
    return "The selected job could not be found.";
  }

  if (/column \"type\" is of type movement_type but expression is of type text/.test(normalized)) {
    return "The stock reversal could not be completed because the inventory movement format needs the latest update.";
  }

  if (/invalid input value for enum movement_type/.test(normalized)) {
    return "That stock movement type is not supported.";
  }

  if (/duplicate key value violates unique constraint/.test(normalized) && /parts.*sku|sku/i.test(normalized)) {
    return "That SKU is already in use.";
  }

  return raw;
}

function extractErrorMessage(error: unknown) {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message ?? "";
  if (typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return String(error);
}
