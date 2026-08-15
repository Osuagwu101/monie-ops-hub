# MonieCRM authentication root-cause correction

## Confirmed root causes

1. The automation had been configured to start at `https://atm.moniepoint.com`, which is not the MonieCRM surface used by the BRM operations dashboard.
2. The intermediate bare host `https://console.teamapt.com` has no usable public address record and produced tunnel/DNS failures.
3. Moniepoint's current Knowledge Base identifies `https://v2.mab.console.teamapt.com/login` as the login entry point. The Director's screen recording is consistent with this longer `*.console.teamapt.com` hostname being visually shortened in the mobile address bar.
4. Browser Use defaults a session to a US proxy when `proxyCountryCode` is omitted. The previous worker omitted the field when the database value was null, so the supposedly proxy-free test actually used the provider default rather than the Director's Nigeria region.
5. The agent-driven login was allowed to improvise. During the live trace it clicked `Forgot Username?` twice and `Forgot password?` once, then resubmitted credentials multiple times. Those repeated failed submissions caused the temporary one-hour security lockout seen at the end of the diagnostic run.

## Production correction

The hardened dispatcher:

- starts only on `v2.mab.console.teamapt.com`;
- uses the Nigeria Browser Use proxy explicitly;
- attaches a persistent Browser Use profile so successful MonieCRM cookies/local state can be reused;
- forbids web search, ATM/business-portal fallback and recovery links during authentication;
- allows one username/password submission per run and stops on the first auth error;
- leaves the established poll/PDF import/dashboard/Team Management enrichment pipeline intact after successful authentication.

The database also clamps automation credential attempts to one and stores the Browser Use profile id separately from the Moniepoint credentials.

## Data integrity and acceptance

The database migration was executed against the production schema inside a transaction and rolled back successfully before release. The test confirmed the exact MonieCRM URL, Nigeria proxy, one-attempt limit, hardened worker URL and profile column without leaving production changes behind.

No production BO, terminal, report, dashboard KPI or Human Support task is created from this correction by itself. Those records remain dependent on a successfully downloaded official Moniepoint report and values captured from the authenticated MonieCRM session.
