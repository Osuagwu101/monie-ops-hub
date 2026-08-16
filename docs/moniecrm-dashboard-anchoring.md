# MonieCRM dashboard anchoring

## What changed

The authenticated Browser Use session is now explicitly anchored to the BRM dashboard host instead of
depending on natural-language "return to dashboard" navigation.

- Hardened login entry point remains `https://v2.mab.console.teamapt.com/login`.
- After a successful single-attempt login, the same authenticated session is directed to
  `https://v2.mab.console.teamapt.com` and must confirm the authenticated BRM dashboard is loaded
  before the report workflow continues.
- The dashboard/Team Management enrichment (mirroring) task is dispatched with that dashboard URL as
  its explicit start/anchor URL, in the SAME persistent session.

## Preserved safeguards

- Nigeria proxy, persistent Browser Use profile and keep-alive session.
- One credential submission per run, no retries, no recovery links, no web search.
- Credentials remain Vault-only and domain-scoped; nothing secret is in code, prompts, docs or logs.
- Allowed-domain restrictions and login-scope validation unchanged.
- Order unchanged: official PDF download and immutable import first, then dashboard KPI capture and
  Team Management contact enrichment in the same session.

## Data integrity

- The mirror task captures only visible dashboard KPI label/value pairs exactly as shown. No
  calculation, renaming, inference or fabrication.
- If the dashboard redirects to login, shows an auth error, presents an MFA/approval challenge, or
  cannot be confirmed authenticated, the task stops and the run fails visibly; no mirror data is
  synthesized.
- `source_url` on mirror snapshots continues to record the actual MonieCRM page captured.
- The official-data truth hierarchy is unchanged: the downloaded official PDF remains authoritative.

## Files touched

- `src/routes/api.moniecrm-worker.ts`
- `src/routes/api.automation-worker.ts`
