# Phase 4 — Operations Team

Phase 4 activates Amina Bello, Emeka Nwosu, Zainab Aliyu and Tunde Bakare as one auditable operations-intelligence layer over the secured Moniepoint source-of-truth model.

## Operating rules

- Official Moniepoint report fields remain authoritative. Internal scores never overwrite `Target Met` or official target values.
- Amina plans seven daily calls. Under the configured 60–80% TA share, a complete seven-call plan is five TA calls and two non-TA calls.
- Replanning may replace untouched Amina-generated tasks only. Started, completed, manually assigned and verified history is preserved.
- Emeka prioritises positive-target terminals whose official rolling `Target Met` is false, using transaction gap and dormancy only as internal prioritisation signals.
- Zainab surfaces responsible lending conversations only after repeated evidence and never represents a recommendation as credit approval.
- Tunde remains evidence-led and separate from human claims and agent recommendations.
- Missing merchant contact data creates a visible planning gap; the system does not invent contacts or pad a queue with fake work.
- A newly processed Director-imported official report triggers a safe automatic replan for active assistants.

## Accountability

Agent runs and recommendations are persisted with row-level security and agent actions are written to the audit event ledger. Assistants can read only recommendations assigned to them; Director controls remain Director-only.

## Runtime verification

A rollback-only production-schema exercise verified a complete seven-call plan with five TA and two non-TA calls, unique queue ranks, one responsible Zainab lending candidate and one Tunde discrepancy attention item. A second run replaced all seven untouched generated tasks without duplication. A third run preserved a started TA task while replacing the six untouched tasks and still restored the valid seven-call mix.

The same exercise verified that `loan_disbursed` is rejected on a TA task. An initial runtime test exposed an invalid PostgreSQL `format()` specifier in Zainab's rationale; it was fixed in the migration and re-tested successfully.

A separate row-level-security exercise verified that an Assistant sees only their own agent run and recommendation and cannot insert an agent run. A fresh-report trigger exercise verified that changing an official report to `processed` automatically produced seven tasks, five TA calls and four agent runs without a trigger failure. All synthetic records were rolled back after testing.
