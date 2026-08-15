import { restSelect } from "@/lib/cloud-api";

export interface StaffAccount {
  id: string;
  full_name: string;
  role: "assistant";
  is_active: boolean;
  created_at: string;
}

export interface CreateStaffInput {
  fullName: string;
  email: string;
  password?: string;
}

export async function loadStaffAccounts(accessToken: string) {
  return restSelect<StaffAccount[]>(
    "profiles?select=id,full_name,role,is_active,created_at&role=eq.assistant&order=created_at.asc",
    accessToken,
  );
}

export async function createStaffAccount(input: CreateStaffInput, accessToken: string) {
  const response = await fetch("/api/admin-staff", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      fullName: input.fullName.trim(),
      email: input.email.trim().toLowerCase(),
      password: input.password?.trim() || null,
    }),
  });

  const payload = (await response.json()) as
    | { ok: true; mode: "created" | "invited"; userId: string }
    | { ok: false; error: string };

  if (!response.ok || !payload.ok) {
    throw new Error(payload.ok ? "Unable to create staff account." : payload.error);
  }

  return payload;
}
