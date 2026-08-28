import { createFileRoute } from "@tanstack/react-router";

const cloudUrl = process.env.SUPABASE_URL?.replace(/\/$/, "") ?? import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "") ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const importToken = process.env.MONIE_CONTACT_IMPORT_TOKEN ?? "";

type MatchMethod = "EXACT_NAME_AND_TERMINAL" | "EXACT_NAME_SINGLE_POS" | "MANUAL_VERIFIED";

interface VerifiedContact {
  businessName: string;
  phoneNumber: string;
  posAccountNumber: string;
  terminalId: string;
  terminalSerial: string;
  matchMethod: MatchMethod;
  crmSourcePath?: string;
}

interface ImportRequest {
  sourceReportDate: string;
  sourceReference?: string;
  contacts: VerifiedContact[];
}

export const Route = createFileRoute("/api/business-contacts")({
  server: { handlers: { POST: async ({ request }) => handleImport(request) } },
});

async function handleImport(request: Request) {
  const token = request.headers.get("x-monie-contact-import-token") ?? "";
  if (!importToken || token !== importToken) return response({ ok: false, error: "unauthorized" }, 401);
  if (!cloudUrl || !serviceRoleKey) return response({ ok: false, error: "contact_cache_not_configured" }, 503);

  let body: ImportRequest;
  try { body = await request.json() as ImportRequest; }
  catch { return response({ ok: false, error: "invalid_json" }, 400); }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.sourceReportDate) || !Array.isArray(body.contacts) || !body.contacts.length || body.contacts.length > 500) {
    return response({ ok: false, error: "invalid_request" }, 400);
  }

  for (const contact of body.contacts) {
    if (!validContact(contact)) return response({ ok: false, error: "invalid_verified_contact" }, 422);
  }

  const result = await fetch(`${cloudUrl}/rest/v1/rpc/upsert_verified_business_contacts`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify({
      p_contacts: body.contacts,
      p_source_report_date: body.sourceReportDate,
      p_source_reference: body.sourceReference?.slice(0, 200) ?? null,
    }),
  });

  if (!result.ok) return response({ ok: false, error: "contact_cache_write_failed" }, 502);
  return response({ ok: true, result: await result.json() }, 201);
}

function validContact(value: VerifiedContact) {
  return Boolean(
    value &&
    value.businessName?.trim() &&
    value.phoneNumber?.trim() &&
    value.posAccountNumber?.trim() &&
    value.terminalId?.trim() &&
    value.terminalSerial?.trim() &&
    ["EXACT_NAME_AND_TERMINAL", "EXACT_NAME_SINGLE_POS", "MANUAL_VERIFIED"].includes(value.matchMethod),
  );
}

function response(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
