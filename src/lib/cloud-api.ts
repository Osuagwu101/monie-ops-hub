const cloudUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "") ?? "";
const publishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export interface CloudUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

export interface CloudSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  token_type?: string;
  user: CloudUser;
}

export type CloudSignUpResult =
  CloudSession | { user: CloudUser; session: CloudSession | null } | CloudUser;

interface CloudErrorBody {
  error?: string;
  error_description?: string;
  msg?: string;
  message?: string;
  code?: string;
}

export function isCloudConfigured() {
  return Boolean(cloudUrl && publishableKey);
}

export function getCloudConfigurationStatus() {
  return {
    configured: isCloudConfigured(),
    hasUrl: Boolean(cloudUrl),
    hasPublishableKey: Boolean(publishableKey),
  };
}

async function readError(response: Response) {
  let body: CloudErrorBody | null = null;
  try {
    body = (await response.json()) as CloudErrorBody;
  } catch {
    body = null;
  }

  return (
    body?.msg ??
    body?.message ??
    body?.error_description ??
    body?.error ??
    `Request failed with status ${response.status}`
  );
}

async function cloudFetch<T>(path: string, init: RequestInit = {}, accessToken?: string) {
  if (!isCloudConfigured()) {
    throw new Error("Lovable Cloud is not configured for this build.");
  }

  const headers = new Headers(init.headers);
  headers.set("apikey", publishableKey);
  headers.set("Content-Type", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const response = await fetch(`${cloudUrl}${path}`, { ...init, headers });
  if (!response.ok) throw new Error(await readError(response));
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function signInWithPassword(email: string, password: string) {
  return cloudFetch<CloudSession>("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function signUpWithPassword(email: string, password: string, fullName: string) {
  return cloudFetch<CloudSignUpResult>("/auth/v1/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, data: { full_name: fullName } }),
  });
}

export async function activateInvitedStaffAccount(
  email: string,
  password: string,
  fullName: string,
  inviteToken: string,
) {
  return cloudFetch<CloudSignUpResult>("/auth/v1/signup", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      data: {
        full_name: fullName,
        staff_invite_token: inviteToken,
      },
    }),
  });
}

export async function refreshCloudSession(refreshToken: string) {
  return cloudFetch<CloudSession>("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

export async function getCloudUser(accessToken: string) {
  return cloudFetch<CloudUser>("/auth/v1/user", { method: "GET" }, accessToken);
}

export async function signOutCloud(accessToken: string) {
  await cloudFetch<void>("/auth/v1/logout", { method: "POST" }, accessToken);
}

export async function restSelect<T>(resourceAndQuery: string, accessToken: string) {
  return cloudFetch<T>(`/rest/v1/${resourceAndQuery}`, { method: "GET" }, accessToken);
}

export async function restInsert<T>(resource: string, payload: unknown, accessToken: string) {
  return cloudFetch<T>(
    `/rest/v1/${resource}`,
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload),
    },
    accessToken,
  );
}

export async function restUpdate<T>(
  resourceAndQuery: string,
  payload: unknown,
  accessToken: string,
) {
  return cloudFetch<T>(
    `/rest/v1/${resourceAndQuery}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload),
    },
    accessToken,
  );
}

export async function callRpc<T>(name: string, payload: unknown, accessToken: string) {
  return cloudFetch<T>(
    `/rest/v1/rpc/${name}`,
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload),
    },
    accessToken,
  );
}

export async function uploadImmutablePdf(
  bucket: string,
  path: string,
  file: File,
  accessToken: string,
) {
  if (!isCloudConfigured()) {
    throw new Error("Lovable Cloud is not configured for this build.");
  }

  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const headers = new Headers();
  headers.set("apikey", publishableKey);
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Content-Type", "application/pdf");
  headers.set("x-upsert", "false");

  const response = await fetch(
    `${cloudUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`,
    {
      method: "POST",
      headers,
      body: file,
    },
  );

  if (response.status === 409) return { alreadyExists: true };
  if (!response.ok) throw new Error(await readError(response));
  return { alreadyExists: false };
}
