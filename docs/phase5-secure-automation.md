# Phase 5 — Secure Automation & Production Hardening

Phase 5 adds an unattended official-report retrieval framework without weakening the portal's existing truth hierarchy or exposing privileged credentials to the Human Operations Assistant.

## Security boundary

- Scheduled retrieval is **off by default**.
- Browser Use API credentials and Moniepoint login credentials are stored only in **Supabase Vault**.
- Secret values are write-only from the Director portal: the UI can see configured/not-configured state, but cannot read stored values back.
- The Human Operations Assistant cannot see the Automation navigation item and is denied by the page's Director role gate and database RLS.
- No service-role key is required by the application worker.
- Database cron calls the server worker through a private, rotatable bridge token held in Vault.
- Browser Use receives login data through domain-scoped secrets and is restricted by the Director-configured allowed-domain list.
- Browser recording and vision are disabled for the retrieval task to reduce unnecessary exposure of authenticated screens.
- The report-retrieval prompt instructs the browser task only to obtain the original official PDF. It must not create, reinterpret or calculate official metrics.

## Schedule

The default Lagos-time operating rhythm is:

- **08:30** — prior-day/final verification retrieval for Tunde's closeout window.
- **09:00** — morning/latest official report refresh.
- **18:00** — evening/latest official report refresh.
- A two-minute queue poller handles Browser Use completion and retry state.

The database converts the configured Lagos clock times to UTC cron expressions. Updating the Director configuration refreshes the cron jobs.

## Concurrency and recovery

Only one report-retrieval run may be active at a time. A simultaneous scheduled trigger is retained as `skipped` with a concurrency-guard reason instead of starting another Browser Use session.

Each run uses a short database lease to prevent duplicate worker processing. Failed transient Browser Use/network attempts can move to `retry_wait` with capped exponential backoff. The default is three attempts with a ten-minute base backoff. Permanent validation failures stop rather than endlessly retrying.

Run states are auditable: `queued`, `dispatching`, `browser_running`, `polling`, `retry_wait`, `succeeded`, `failed`, `cancelled`, or `skipped`.

## Immutable report pipeline

Automation does not create a second source of truth. Manual and unattended retrieval share the same Moniepoint report semantic parser.

The worker:

1. retrieves the original PDF output from Browser Use,
2. validates file type and the 15 MB limit,
3. parses it through the same Phase 3 report core,
4. requires the existing import validation checks to pass,
5. computes the PDF SHA-256 digest,
6. uploads it to the private `moniepoint-reports` bucket through a one-time run ID + nonce path,
7. calls the same official ingestion/reconciliation functions under a transaction-local automation authorization flag,
8. records the automated import and Tunde reconciliation in the audit ledger.

The truth hierarchy remains:

> Official Moniepoint report → verified system calculation → human activity record → AI interpretation.

Browser Use is a retrieval mechanism, not an authority over a Moniepoint metric.

## One-time Storage upload

The server worker does not possess a service-role credential. During a valid polling lease, the database creates a random upload nonce and stores only its SHA-256 hash. Storage RLS permits an anonymous insert only when the object path matches that specific run and nonce. The nonce is cleared after success, retry or lease expiry.

Existing report-read policies remain unchanged.

## Production security hardening

Server responses now include `nosniff`, no-referrer, frame denial, restrictive browser permissions, HSTS and same-origin opener policy. A restrictive CSP is intentionally not forced at this phase because it could break the current TanStack/Lovable hydration/runtime asset model without a nonce-based policy.

Automation configuration and run tables have RLS enabled. Director-facing RPCs enforce the Director role in the database, not only in React. Worker-only RPCs require the private bridge token before they disclose a retrieval secret or mutate a run.

## Director activation checklist

Do **not** paste Moniepoint credentials or Browser Use keys into ChatGPT, GitHub commits, Lovable prompts or source files.

From the Director account in **Automation**:

1. save the Browser Use API key to Vault,
2. save the Moniepoint username and password to Vault,
3. enter the exact Moniepoint BRM HTTPS login URL,
4. enter only the domains needed for authentication/report download,
5. confirm Lagos schedule/retry settings,
6. save configuration while scheduled retrieval is still disabled,
7. use **Run now** for the first controlled live retrieval,
8. confirm the PDF imports correctly and Tunde reconciles it,
9. only then enable scheduled retrieval.

If Moniepoint introduces MFA, CAPTCHA, device approval, a changed report flow or another interactive challenge, the run should fail visibly and remain auditable. Do not weaken authentication to make automation succeed; update the secure retrieval flow instead.

## Operational limitation before activation

Phase 5 can be deployed and fully audited without storing live Moniepoint credentials. Until the Director supplies the required Vault values and enables the schedule, no unattended Moniepoint login is attempted.
