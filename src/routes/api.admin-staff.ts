import { createFileRoute } from "@tanstack/react-router";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

type RequestBody = {
  fullName?: unknown;
  email?: unknown;
  password?: unknown;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function getServerEnv(name: string) {
  const value = process.env[name]?.trim();
  return value || null;
}

async function verifyDirector(accessToken: string, supabaseUrl: string, anonKey: string) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/profiles?select=id,role,is_active&id=eq.${encodeURIComponent(getUserId(accessToken))}&limit=1`,
    {
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) return false;
  const rows = (await response.json()) as Array<{ role?: string; is_active?: boolean }>;
  return rows[0]?.role === "director" && rows[0]?.is_active === true;
}

function getUserId(accessToken: string) {
  const parts = accessToken.split(".");
  if (parts.length < 2) return "";
  try {
    const normalized = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as { sub?: string };
    return payload.sub ?? "";
  } catch {
    return "";
  }
}

async function handler({ request }: { request: Request }) {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!accessToken) return json({ ok: false, error: "unauthorized" }, 401);

  const supabaseUrl =
    getServerEnv("VITE_SUPABASE_URL") ?? getServerEnv("SUPABASE_URL") ?? getServerEnv("PUBLIC_SUPABASE_URL");
  const anonKey =
    getServerEnv("VITE_SUPABASE_ANON_KEY") ??
    getServerEnv("SUPABASE_ANON_KEY") ??
    getServerEnv("PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = getServerEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey) {
    return json({ ok: false, error: "cloud_configuration_missing" }, 503);
  }
  if (!serviceRoleKey) {
    return json({ ok: false, error: "staff_provisioning_not_configured" }, 503);
  }

  if (!(await verifyDirector(accessToken, supabaseUrl, anonKey))) {
    return json({ ok: false, error: "director_required" }, 403);
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password.trim() : "";

  if (!fullName || !email || !email.includes("@")) {
    return json({ ok: false, error: "full_name_and_valid_email_required" }, 400);
  }
  if (email === "nnaemekasolomon31@gmail.com") {
    return json({ ok: false, error: "reserved_admin_email" }, 400);
  }
  if (password && password.length < 8) {
    return json({ ok: false, error: "password_must_be_at_least_8_characters" }, 400);
  }

  const adminHeaders = {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
  };

  const createResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      email,
      password: password || crypto.randomUUID() + crypto.randomUUID(),
      email_confirm: true,
      user_metadata: { full_name: fullName },
      app_metadata: { staff_created_by_admin: true },
    }),
  });

  const created = (await createResponse.json()) as { id?: string; error_description?: string; msg?: string };
  if (!createResponse.ok || !created.id) {
    return json(
      { ok: false, error: created.error_description ?? created.msg ?? "unable_to_create_staff_account" },
      createResponse.status >= 400 && createResponse.status < 500 ? 400 : 502,
    );
  }

  if (!password) {
    const linkResponse = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        type: "recovery",
        email,
        options: { redirectTo: `${new URL(request.url).origin}/` },
      }),
    });
    const linkPayload = (await linkResponse.json()) as {
      action_link?: string;
      properties?: { action_link?: string };
    };
    const actionLink = linkPayload.action_link ?? linkPayload.properties?.action_link ?? null;

    if (!linkResponse.ok || !actionLink) {
      await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(created.id)}`, {
        method: "DELETE",
        headers: adminHeaders,
      }).catch(() => undefined);
      return json({ ok: false, error: "unable_to_generate_staff_password_link" }, 502);
    }

    return json({ ok: true, mode: "invited", userId: created.id, actionLink });
  }

  return json({ ok: true, mode: "created", userId: created.id });
}

export const Route = createFileRoute("/api/admin-staff")({
  server: {
    handlers: {
      POST: handler,
    },
  },
});
