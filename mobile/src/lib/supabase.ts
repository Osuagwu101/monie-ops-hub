import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Platform } from "react-native";
import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";

export const mobileSupabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
export const mobileSupabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const mobileCloudConfigured = Boolean(mobileSupabaseUrl && mobileSupabaseKey);

export const supabase = createClient(mobileSupabaseUrl || "https://example.invalid", mobileSupabaseKey || "missing", {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
