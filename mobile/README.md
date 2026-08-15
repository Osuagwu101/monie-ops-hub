# Moniepoint BRM mobile app

The native mobile companion uses the same Supabase authentication and database as Monie Ops Hub. A meeting acknowledgement on the phone is therefore the same record seen by the web portal.

## Shared portal experience

The Director home reads the existing production tables directly through their current RLS rules. It includes a synchronized portal snapshot for:

- latest official Terminal Activity performance
- active and assigned terminals
- today's seven-task/Amina queue when present
- latest Amina management score and tone
- latest Amina/Emeka/Zainab/Tunde recommendation
- upcoming meeting schedule and acknowledgement state

This is deliberately the same data model as the website rather than a copied mobile database.

## Environment

Copy `.env.example` to `.env` and configure the same Supabase URL and publishable/anon key used by the web portal. Do not place service-role keys or Moniepoint credentials in the mobile app.

`EXPO_PUBLIC_EAS_PROJECT_ID` is required for Expo remote push token registration on a native development/production build. Local scheduled reminders remain useful before remote-push activation.

## Meeting notification flow

The app requests notification permission, creates reminder/alarm channels, registers the notification action `Yes, I have joined`, registers the device with the shared backend when an Expo push token is available, and schedules a bounded local backup set for the nearest meeting.

The server remains the durable reminder authority and can continue issuing escalation pushes until the shared meeting occurrence is acknowledged. The local backup is intentionally bounded so iOS pending-notification limits are not consumed by months of repeated escalation alarms.

A notification acknowledgement is also recovered on cold start: if the app was closed when `Yes, I have joined` was tapped, the app reads the last notification response, writes the shared acknowledgement, clears the consumed response, and cancels local backup reminders.

## Native platform notes

- Android exact-timing alarms require the system's Alarms & reminders permission on supported Android versions. The app requests `SCHEDULE_EXACT_ALARM` in its native manifest configuration.
- iOS uses Time Sensitive notifications. Sounding through mute/Focus as a Critical Alert requires Apple's separately approved Critical Alerts entitlement; this app does not claim that entitlement by default.
- Remote push must be tested in a native development/production build on a physical device. The app handles missing native push credentials by retaining local reminder functionality.

## Branding

The current blue `M` launcher/splash icon is a temporary development asset generated for the Phase 7 build. Before public App Store/Play Store distribution, replace it with the official Moniepoint logo/icon asset that the account owner is authorised to use.

## Quality checks

From `mobile/`:

```bash
npm ci
npm run typecheck
npx expo export --platform android --output-dir dist-android
npx expo export --platform ios --output-dir dist-ios
```

The Phase 7 branch has passed all three checks above after the portal snapshot integration. Its server-side acceptance test also proved recurrence dates, duplicate suppression, failed-push retry, the 10-minute and 2-minute messages, post-start escalation, Director-only acknowledgement, push-token privacy, and the stop-after-acknowledgement behavior without leaving synthetic production data.

The runtime exercise initially found an ambiguous PL/pgSQL return-column reference inside the notification claim function. That function was hardened, installed live, and the complete lifecycle was rerun successfully.

These source/bundle checks do not by themselves publish an installable app. Native distribution additionally requires the relevant Expo/EAS, Android push, and Apple developer signing/push configuration.
