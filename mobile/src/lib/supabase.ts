import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Platform } from "react-native";
import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";

export const mobileSupabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
export const mobileSupabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const mobileCloudConfigured = Boolean(mobileSupabaseUrl && mobileSupabaseKey);

const API_TIMEOUT_MS = 18_000;
const REACHABILITY_TIMEOUT_MS = 7_000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = API_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort();
  if (upstreamSignal?.aborted) controller.abort();
  else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

export const supabase = createClient(
  mobileSupabaseUrl || "https://example.invalid",
  mobileSupabaseKey || "missing",
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) => fetchWithTimeout(input, init),
    },
  },
);

export async function canReachMobileBackend() {
  if (!mobileCloudConfigured) return false;
  try {
    const response = await fetchWithTimeout(
      `${mobileSupabaseUrl}/auth/v1/health`,
      {
        method: "GET",
        headers: { apikey: mobileSupabaseKey },
      },
      REACHABILITY_TIMEOUT_MS,
    );
    return response.ok;
  } catch {
    return false;
  }
}

if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
