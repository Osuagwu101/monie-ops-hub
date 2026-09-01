import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const cwd = process.cwd();
const app = readFileSync(resolve(cwd, "App.tsx"), "utf8");
const cloud = readFileSync(resolve(cwd, "src/lib/supabase.ts"), "utf8");
const errors = readFileSync(resolve(cwd, "src/lib/errors.ts"), "utf8");
const config = readFileSync(resolve(cwd, "app.json"), "utf8");

const has = (source, text, message) => assert.ok(source.includes(text), message);

has(app, "KeyboardAvoidingView", "Login must move safely above the software keyboard.");
has(
  app,
  'keyboardShouldPersistTaps="handled"',
  "Login must remain usable while the keyboard is open.",
);
has(app, "scrollToEnd", "Password focus must reveal the complete sign-in form.");
has(app, "You are offline", "Login must explicitly identify offline state.");
has(app, "Back online. You can sign in now.", "Login must announce restored connectivity.");
has(app, "finally", "Sign-in must always release its busy state.");
has(cloud, "AbortController", "Backend requests must have a bounded cancellation mechanism.");
has(cloud, "API_TIMEOUT_MS", "Backend requests must have a finite timeout.");
has(cloud, "/auth/v1/health", "Login must verify the actual authentication service.");
has(errors, "No internet connection", "Offline errors must use professional user-facing copy.");
has(
  errors,
  "TECHNICAL_PATTERNS",
  "Technical backend details must be removed from user-facing errors.",
);
has(
  config,
  "android.permission.INTERNET",
  "Android release must explicitly allow internet access.",
);
has(
  config,
  "android.permission.ACCESS_NETWORK_STATE",
  "Android release must expose network state.",
);

console.log("Phase 5 mobile login resilience acceptance checks passed.");
