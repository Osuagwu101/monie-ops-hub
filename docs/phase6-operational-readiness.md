# Phase 6 — Operational Readiness & Acceptance

Phase 6 separates three different states that must not be confused:

1. **Platform ready** — security, database, report ingestion, team orchestration, Amina management, audit controls and automation infrastructure are installed and healthy.
2. **Manual operations ready** — the platform is ready and there is at least one active Director, one active Human Operations Assistant and a processed official Moniepoint report.
3. **Live automation ready** — the platform is ready and the external Browser Use/Moniepoint login prerequisites and exact login scope have been configured securely.

Missing Browser Use or Moniepoint credentials are therefore reported as **external activation pending**, not as a development failure. Scheduled retrieval remains disabled until the Director intentionally enables it.

## Acceptance gates

The permanent GitHub Quality workflow now runs an offline report acceptance suite in addition to TypeScript, lint and the production build. The fixture is PII-free and exercises the same production report-core parser used by manual uploads and the scheduled worker.

The acceptance suite verifies:

- a valid daily/rolling/non-transacting report structure is importable;
- the official Moniepoint `Target Met` flag remains authoritative even when simple arithmetic would imply a different result;
- a zero official target remains a valid source value and is not globally replaced;
- duplicate terminal IDs inside a transaction section block import;
- missing required report-summary fields block parsing.

During development, the first synthetic fixture did not match the real PDF extraction spacing around a section boundary. The fixture was corrected to match the production extraction pattern; the production parser was not weakened.

## Production-schema and security verification

The Phase 6 migration was first created inside a transaction against the production schema and rolled back successfully. It was then applied live.

Rollback-only runtime tests verified:

- `system_readiness_snapshot()` reports the platform as ready while manual activation remains pending when no processed report exists;
- Browser Use/Moniepoint credentials remain optional for manual readiness and are never returned as values;
- `run_readiness_audit()` stores a non-secret Director audit snapshot and writes an audit-ledger event;
- the Human Operations Assistant cannot call the privileged readiness snapshot and cannot read Director readiness-audit rows;
- a simulated processed official report plus Director/Assistant accounts changes the readiness state to `manual_operations_ready` while `liveAutomationReady` remains false;
- all synthetic users, profiles, reports and audit rows are rolled back after testing.

A runtime audit also caught and fixed a nullable-boolean edge case: with no report present, `manualOperationsReady` now returns a strict `false` instead of `null`.

## First operational activation checklist

When the real team is ready to start manual operations:

1. Confirm the Director account is active.
2. Create/confirm the Human Operations Assistant account.
3. Open **Official Reports** and select the real Moniepoint BRM PDF.
4. Review parser validation before importing; do not override a blocked report.
5. Confirm the import reaches `processed` and the immutable source record is present.
6. Run/confirm the Operations Team plan and verify the seven-call day is populated correctly, normally five TA plus two non-TA calls under the current 60–80% TA rule.
7. Log in as the Human Operations Assistant and verify only assigned merchants/tasks/recommendations are visible.
8. Complete a controlled task/outcome flow and confirm Tunde remains the only evidence-verification authority.
9. Review Amina's individual and team scorecards and confirm financial recommendations remain Director-controlled.
10. Run **Readiness** and save a Director readiness audit.

## First live automation checklist

This can happen later without blocking Phase 6:

1. Enter the Browser Use API key only in the Director Automation screen.
2. Enter Moniepoint credentials only through the secure Director Automation screen.
3. Configure the exact Moniepoint login URL and allowed domains.
4. Keep scheduled retrieval disabled and use **Run Now** for the first controlled retrieval.
5. Compare the downloaded automated PDF with a manually downloaded official report for the same checkpoint.
6. Confirm report date, source hash/provenance, parser result, portfolio metrics and Tunde reconciliation.
7. Confirm failure/retry/audit records are correct.
8. Only after the controlled run passes should the Director enable the 8:30 / 9:00 / 18:00 schedule.

The only acceptance item that cannot be completed without external credentials is the real unattended Moniepoint login/download validation itself.
