const NETWORK_PATTERNS = [
  "aborterror",
  "connectexception",
  "connection refused",
  "failed to connect",
  "fetch failed",
  "network request failed",
  "networkerror",
  "sockettimeout",
  "timed out",
  "timeout",
  "unable to resolve host",
];

const TECHNICAL_PATTERNS = [
  "java.",
  "pgrst",
  "postgres",
  "sqlstate",
  "supabase.co",
  "http://",
  "https://",
  "jwt",
  "permission denied for",
  "relation ",
];

export const OFFLINE_MESSAGE =
  "No internet connection. Please reconnect to Wi-Fi or mobile data and try again.";

export const TIMEOUT_MESSAGE =
  "The connection is taking too long. Please check your internet connection and try again.";

function rawMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === "string") return value;
  }
  return "";
}

export function isConnectivityError(error: unknown) {
  const message = rawMessage(error).toLowerCase();
  return NETWORK_PATTERNS.some((pattern) => message.includes(pattern));
}

export function friendlyErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
) {
  const message = rawMessage(error).trim();
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "The email or password is incorrect. Please check the details and try again.";
  }
  if (normalized.includes("email not confirmed")) {
    return "This email address has not been confirmed. Please contact the Director or Admin.";
  }
  if (normalized.includes("too many requests") || normalized.includes("rate limit")) {
    return "There have been too many attempts. Please wait a moment and try again.";
  }
  if (isConnectivityError(error)) {
    return normalized.includes("timeout") || normalized.includes("timed out")
      ? TIMEOUT_MESSAGE
      : OFFLINE_MESSAGE;
  }
  if (
    !message ||
    message.length > 180 ||
    TECHNICAL_PATTERNS.some((pattern) => normalized.includes(pattern))
  ) {
    return fallback;
  }
  return message;
}
