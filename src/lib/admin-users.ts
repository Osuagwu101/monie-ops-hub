import {
  activateInvitedStaffAccount,
  callRpc,
  restSelect,
  type CloudSignUpResult,
  type CloudSession,
  type CloudUser,
} from "@/lib/cloud-api";

export interface StaffAccount {
  id: string;
  full_name: string;
  role: "assistant";
  is_active: boolean;
  created_at: string;
}

interface StaffInviteResult {
  inviteId: string;
  email: string;
  fullName: string;
  inviteToken: string;
  expiresAt: string;
}

export interface CreateStaffInput {
  fullName: string;
  email: string;
  temporaryPassword: string;
}

export async function loadStaffAccounts(accessToken: string) {
  return restSelect<StaffAccount[]>(
    "profiles?select=id,full_name,role,is_active,created_at&role=eq.assistant&order=created_at.asc",
    accessToken,
  );
}

export async function createStaffAccount(input: CreateStaffInput, accessToken: string) {
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  const temporaryPassword = input.temporaryPassword.trim();

  if (!fullName) throw new Error("Staff full name is required.");
  if (!email || !email.includes("@")) throw new Error("A valid staff email is required.");
  if (temporaryPassword.length < 8) {
    throw new Error("Temporary password must be at least 8 characters.");
  }

  const invite = await callRpc<StaffInviteResult>(
    "create_staff_invite",
    { p_email: email, p_full_name: fullName },
    accessToken,
  );

  const result = await activateInvitedStaffAccount(
    invite.email,
    temporaryPassword,
    invite.fullName,
    invite.inviteToken,
  );

  const session = isCloudSession(result)
    ? result
    : isWrappedSignUpResult(result)
      ? result.session
      : null;
  const user = isCloudSession(result)
    ? result.user
    : isWrappedSignUpResult(result)
      ? result.user
      : result;

  return {
    userId: user.id,
    email: invite.email,
    requiresEmailConfirmation: !session,
  };
}

function isCloudSession(value: CloudSignUpResult): value is CloudSession {
  return "access_token" in value;
}

function isWrappedSignUpResult(
  value: CloudSignUpResult,
): value is { user: CloudUser; session: CloudSession | null } {
  return "user" in value && !isCloudSession(value);
}
