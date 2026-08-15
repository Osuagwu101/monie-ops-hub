# Phase 7 — Moniepoint BRM mobile app and intelligent meeting alerts

Phase 7 adds a native Expo/React Native Director companion named **Moniepoint BRM** and a synced web **Meetings & Alerts** centre. Both use the same Supabase authentication and operational database as Monie Ops Hub; there is no second mobile database.

## Default meeting calendar

All recurrence rules are evaluated in `Africa/Lagos`.

- Cluster Meeting: every Tuesday at 20:00.
- Zonal Meeting: second and last Thursday of every month at 09:00.

The database materializes future occurrences and refreshes the calendar daily. Runtime acceptance verified that Tuesday dates match while Wednesday does not, and that second/last Thursdays match while a third Thursday does not. Materialized August/September 2026 rows were verified at exactly 20:00 for Cluster and 09:00 for Zonal.

## Reminder and acknowledgement state machine

For every enabled Director device:

1. **T-10 minutes** — a short reminder: `It's 10 minutes to <Meeting>.`
2. **T-2 minutes** — urgent reminder: `2 minutes to <Meeting> — drop everything you're doing and join now.`
3. **T+4 minutes** by default — escalation begins: `<Meeting> has started. Have you joined? Tap “Yes, I have joined” to stop these reminders.`
4. Escalation repeats at the configured interval (default every two minutes) until the shared occurrence is acknowledged or the bounded escalation window expires.
5. **Yes, I have joined** changes the shared occurrence to `joined`, records who/when acknowledged it, cancels queued notification deliveries, writes an audit event, and prevents further server claims for that occurrence.

The mobile app also schedules a bounded local backup set for the nearest meeting. This gives the phone a second reminder path if network delivery is delayed. The server remains the durable authority for continuing escalation.

## Runtime acceptance

A rollback-only production-schema exercise used synthetic Director/Assistant accounts, one mobile device and one meeting occurrence. All synthetic records were rolled back afterward.

Verified results:

- first T-10 claim: 1 delivery
- repeated T-10 claim in the same window: 0 duplicate deliveries
- a synthetic failed T-10 push was reclaimed successfully: 1 retry
- first T-2 claim: 1 delivery
- first post-start escalation claim: 1 delivery
- repeated escalation claim in the same sequence window: 0 duplicate deliveries
- after Director acknowledgement: 0 further claims and 0 queued deliveries
- acknowledgement audit event: 1
- Assistant could not read the Director meeting calendar
- Assistant could not acknowledge a Director meeting
- an invalid private bridge token was rejected
- `authenticated` does not have SELECT privilege on `mobile_devices.expo_push_token`

The runtime test initially exposed a PL/pgSQL output-column/CTE ambiguity inside `meeting_claim_notifications`. The claim query was hardened by fully qualifying the CTE and `RETURNING` columns, then the complete lifecycle was rerun successfully.

## Security and privacy

- Meeting series and occurrences are Director-only under RLS.
- Device registration occurs through an authenticated RPC.
- Push tokens are retained server-side as routing identifiers and are not selectable through normal authenticated application queries.
- The server notification worker is protected by the existing private Phase 5 bridge token.
- No service-role key or Moniepoint credential is embedded in the native application.
- Delivery rows expose status/error health to the Director without exposing device push tokens.

## Web/mobile synchronization

The website and mobile client operate on the same `meeting_series`, `meeting_occurrences`, profile and acknowledgement records. Editing a meeting schedule on web regenerates future scheduled occurrences; completed/joined history is preserved. Acknowledging from the phone is immediately the same state the web portal reads.

## Native app validation

The permanent `Mobile Quality` workflow validates the native source independently from the Lovable web build:

- TypeScript
- Android Expo export
- iOS Expo export

The web `Quality` workflow continues to validate strict TypeScript, lint, offline Moniepoint report acceptance and the production web build.

## Activation still required for a physical install

Source and Android/iOS bundle exports are not the same as an App Store/Play Store signed release. Physical-device push activation requires the shared Supabase public URL/key in the mobile build environment, an Expo/EAS project ID, native push credentials/signing, and a physical-device acceptance run. Android users must grant the relevant alarm/notification permissions for the strongest timing behavior. iOS Critical Alerts require Apple's separate entitlement if mute/Focus bypass is desired.

## Branding

The Phase 7 development build currently uses a generated Moniepoint-blue `M` icon so the repository has deterministic build assets. Before public store distribution, replace this development asset with the official Moniepoint logo/icon file that the account owner is authorised to use.
