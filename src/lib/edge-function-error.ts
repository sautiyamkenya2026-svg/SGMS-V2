export async function readEdgeFunctionErrorMessage(
  error: unknown,
  response?: Response | null,
  fallback = "Something went wrong.",
) {
  const responseLike = response ?? getResponseFromError(error);

  if (responseLike) {
    const message = await readResponseMessage(responseLike);
    if (message) return message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function getResponseFromError(error: unknown) {
  if (!error || typeof error !== "object") return null;

  const maybeResponse = (error as { context?: unknown }).context;
  return isResponseLike(maybeResponse) ? maybeResponse : null;
}

function isResponseLike(value: unknown): value is Response {
  return !!value && typeof value === "object" && typeof (value as Response).text === "function";
}

async function readResponseMessage(response: Response) {
  try {
    const readable = typeof response.clone === "function" ? response.clone() : response;
    const contentType = readable.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const body = await readable.json();
      if (typeof body?.error === "string" && body.error.trim()) return body.error;
      if (typeof body?.message === "string" && body.message.trim()) return body.message;
      if (typeof body?.msg === "string" && body.msg.trim()) return body.msg;
      if (typeof body === "string" && body.trim()) return body;
    }

    const text = (await readable.text()).trim();
    if (text) return text;
  } catch {
    return null;
  }

  return null;
}
