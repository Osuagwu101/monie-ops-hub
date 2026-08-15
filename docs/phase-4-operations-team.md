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
