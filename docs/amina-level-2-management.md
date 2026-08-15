# Amina Bello — Level 2 Operations Manager

Amina is the operational manager between the Director and the Human Operations Assistant / specialist agents. She may score performance, change management tone, issue evidence-backed warnings, and recommend financial consequences or rewards. She cannot overwrite official Moniepoint results, Tunde's verification evidence, or automatically change earned pay.

## Management tone bands

The current defaults are configurable in `operating_config`:

- **77% and above — Supportive:** standard achieved; recognise good work while protecting against complacency.
- **75%–76.99% — Firm:** close to the Sacred Standard, but the gap must be closed.
- **72%–74.99% — Strict:** company benchmark territory, but below the internal 77% standard.
- **70%–71.99% — Very strict:** below the 72% company benchmark; operational warning and immediate recovery actions.
- **Below 70% — Critical:** no padding or excuses; measurable failures must have owners and corrective actions.

For an individual, Amina applies the stricter pressure level of the team result and that individual's score. A strong team result therefore does not hide weak individual execution.

## Human Operations Assistant score

The daily personal score is based only on activity attributable to the Human Operations Assistant:

- 35% — assigned work completed
- 20% — task outcomes recorded
- 15% — outcome documentation quality (structured outcome plus usable notes)
- 15% — due callback/follow-up discipline
- 15% — official verification effectiveness, with Deferred and Unverifiable treated as partial/neutral evidence rather than automatic failure

The score is separate from the official portfolio performance rate.

## Specialist scores

- **Emeka:** quality/operability of TA priorities, including contact-data gaps. His internal risk score never replaces Moniepoint's official `Target Met` result.
- **Zainab:** responsible lending-opportunity quality. Not finding an evidence-backed candidate is not treated as failure, because she must not push unsuitable borrowing.
- **Tunde:** verification coverage/timeliness against official report evidence. He is not penalised because a merchant result is a discrepancy; his job is to report the truth.

Specialist scorecards are scoped to the Human Assistant context so multiple assistants cannot overwrite or read one another's performance context.

## Warning and penalty rules

- Below the configurable warning line (default **75%**), Amina creates a performance warning where the team or Human Assistant execution is below the line.
- A financial **penalty review** can be recommended only when **both** official team performance and the Human Assistant's attributable score are below the configurable company benchmark trigger (default **72%**).
- A penalty recommendation is **not an automatic wage deduction**. It remains `pending_director` until the Director approves or rejects it.

## Reward rule

The default reward rule is deliberately aligned to the 77% Sacred Standard because the earlier 70% reward idea conflicted with the below-72% penalty rule. The threshold remains configurable.

Amina recommends a **5% performance bonus** when:

1. team performance is at or above the configured bonus threshold (default **77%**),
2. the Human Assistant's own score is also at or above that threshold,
3. both conditions are maintained for **14 consecutive report days**.

The bonus is a recommendation, not an automatic permanent salary increase. The Director approves or rejects it.

## Auditability

Every score refresh and Director decision is written to the audit ledger. The Human Assistant can read their own scorecards and compensation recommendations but cannot approve, reject, or alter them. The Director can review all scorecards and make the final compensation decision.
