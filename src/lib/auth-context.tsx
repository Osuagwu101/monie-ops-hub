import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  getCloudUser,
  refreshCloudSession,
  signInWithPassword,
  signOutCloud,
  signUpWithPassword,
  type CloudSession,
  type CloudUser,
} from "@/lib/cloud-api";

const STORAGE_KEY = "monie_ops_cloud_session_v1";

interface AuthContextValue {
  session: CloudSession | null;
  user: CloudUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
  ) => Promise<"signed_in" | "verify_email">;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function saveSession(session: CloudSession | null) {
  if (typeof window === "undefined") return;
  if (!session) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function readStoredSession() {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CloudSession;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function normalizeSession(session: CloudSession) {
  if (!session.expires_at && session.expires_in) {
    return { ...session, expires_at: Math.floor(Date.now() / 1000) + session.expires_in };
  }
  return session;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<CloudSession | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitSession = useCallback((next: CloudSession | null) => {
    const normalized = next ? normalizeSession(next) : null;
    setSession(normalized);
    saveSession(normalized);
  }, []);

  const refresh = useCallback(
    async (current: CloudSession) => {
      const next = await refreshCloudSession(current.refresh_token);
      commitSession(next);
      return next;
    },
    [commitSession],
  );

  useEffect(() => {
    let active = true;

    async function restore() {
      const stored = readStoredSession();
      if (!stored) {
        if (active) setLoading(false);
        return;
      }

      try {
        const expiresSoon = !stored.expires_at || stored.expires_at * 1000 < Date.now() + 60_000;
        const validSession = expiresSoon ? await refresh(stored) : stored;
        const user = await getCloudUser(validSession.access_token);
        if (active) commitSession({ ...validSession, user });
      } catch {
        if (active) commitSession(null);
      } finally {
        if (active) setLoading(false);
      }
    }

    void restore();
    return () => {
      active = false;
    };
  }, [commitSession, refresh]);

  useEffect(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    if (!session?.expires_at) return;

    const delay = Math.max(session.expires_at * 1000 - Date.now() - 60_000, 10_000);
    refreshTimer.current = setTimeout(() => {
      void refresh(session).catch(() => commitSession(null));
    }, delay);

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [commitSession, refresh, session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signIn: async (email, password) => {
        const next = await signInWithPassword(email.trim(), password);
        commitSession(next);
      },
      signUp: async (email, password, fullName) => {
        const result = await signUpWithPassword(email.trim(), password, fullName.trim());
        if ("access_token" in result) {
          commitSession(result);
          return "signed_in";
        }
        if (result.session) {
          commitSession(result.session);
          return "signed_in";
        }
        return "verify_email";
      },
      signOut: async () => {
        const token = session?.access_token;
        commitSession(null);
        if (token) await signOutCloud(token).catch(() => undefined);
      },
    }),
    [commitSession, loading, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
