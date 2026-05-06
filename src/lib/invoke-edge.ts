import { supabase } from "@/integrations/supabase/client";

type InvokeOptions = Parameters<typeof supabase.functions.invoke>[1];

export async function invokeEdgeFunction<T = unknown>(
  name: string,
  options: InvokeOptions = {},
) {
  const mergeHeaders = (token?: string | null) => ({
    ...(options?.headers ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  let { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    const refreshed = await supabase.auth.refreshSession();
    session = refreshed.data.session;
  }

  if (session?.access_token) {
    supabase.functions.setAuth(session.access_token);
  } else {
    supabase.functions.setAuth("");
  }

  let result = await supabase.functions.invoke<T>(name, {
    ...options,
    headers: mergeHeaders(session?.access_token),
  });

  if (result.error || result.response?.status === 401) {
    const refreshed = await supabase.auth.refreshSession();
    const retryToken = refreshed.data.session?.access_token;
    if (retryToken) {
      supabase.functions.setAuth(retryToken);
      result = await supabase.functions.invoke<T>(name, {
        ...options,
        headers: mergeHeaders(retryToken),
      });
    }
  }

  return result;
}
