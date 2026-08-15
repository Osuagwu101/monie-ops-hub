# Live Moniepoint mirror and 15-contact operating queue

## Operating rule

The Human Support daily requirement remains **7 recorded contacts**. Amina may rank and expose up to **15 contacts** for the day so no-answer, unreachable and unavailable BOs can be replaced without ending the workday. Completing contact 7 satisfies the required daily target; contacts 8–15 are additional capacity, not a higher minimum.

## Official-data authority

The Moniepoint PDF remains authoritative for rolling weekly target values, actual transaction values, `Target Met`, report dates and last-transaction timing. The implementation never substitutes a global ₦100,000 assumption when the official row supplies another target. BO/business names from the official report are used only as lookup keys for contact enrichment.

## Live browser workflow

The server-only Browser Use worker uses the existing domain-scoped Moniepoint credentials in Vault. A retrieval run now has two authenticated stages in one persistent browser session:

1. Download the original official BRM report PDF. Parse, hash and store it immutably through the existing report engine.
2. Return to the primary dashboard, capture visible KPI label/value pairs exactly as displayed, then open Team Management → Business and search the priority BO names from the official rolling 7-day report. Confirmed phone and account numbers are written only when a single exact business-name match exists. Ambiguous and missing matches remain unfilled.

The second task remains restricted to the configured Moniepoint allowed domains. Raw credentials never enter report rows, browser-visible client state, source control or the mirror payload.

## BO attention data

The Director mirror ranks at most 15 rolling-weekly rows where:

- the official target is applicable and greater than zero;
- the official report says `Target Met = false`;
- the row belongs to the staged official report.

The task/mirror context can show the BO name, terminal ID and serial, confirmed Team Management phone/account, exact official weekly target, actual rolling payment + transfer value, remaining target gap and days since last transaction. Missing values are labelled as not confirmed rather than invented.

## Real-time behaviour

The Director web mirror polls the shared backend every 60 seconds. Website and native app use the same protected production data rather than maintaining a copied mobile dataset. A completed enrichment run stores the exact captured dashboard fields and immediately refreshes the BO attention queue, Tunde reconciliation, Amina/AI planning and the Human Support queue.

## Acceptance performed

Production-schema migrations were first executed inside transactions and rolled back. Rollback-only fixtures proved:

- 15 BOs can be ranked and assigned without changing the 7-contact success threshold;
- queue ranks reach 15;
- official rolling targets drive the attention selection;
- unique BO matches accept phone/account enrichment;
- duplicate business names do not receive contact data;
- dashboard label/value payloads are preserved exactly;
- synthetic merchants, reports and tasks leave no production residue after rollback.

The web quality gate includes typecheck, lint, the existing offline report acceptance suite and production build. Mobile quality includes TypeScript checks plus Android/iOS Expo exports.

## Live Moniepoint authentication finding — 15 Aug 2026

A real production Browser Use run was made against the configured Moniepoint login using the Vault-held account. It successfully reached the Moniepoint authentication flow, but Moniepoint returned **“Temporarily Suspended”** for that account. The browser task therefore could not enter the BRM report/dashboard area or download an official PDF. No fake report, mirror row, merchant or Human Support task was created to mask this live account state, and scheduled automation remains disabled while that condition exists.
