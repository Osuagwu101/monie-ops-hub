# Moniepoint BRM mobile app

The native mobile companion uses the same Supabase authentication and database as Monie Ops Hub. A meeting acknowledgement on the phone is therefore the same record seen by the web portal.

## Environment

Copy `.env.example` to `.env` and configure the same Supabase URL and publishable/anon key used by the web portal. Do not place service-role keys or Moniepoint credentials in the mobile app.

`EXPO_PUBLIC_EAS_PROJECT_ID` is required for Expo remote push token registration on a native development/production build. Local scheduled reminders remain useful before remote-push activation.

## Meeting notification flow

The app requests notification permission, creates reminder/alarm channels, registers the notification action `Yes, I have joined`, registers the device with the shared backend when an Expo push token is available, and schedules a bounded local backup set for the nearest meeting.

The server remains the durable reminder authority and can continue issuing escalation pushes until the shared meeting occurrence is acknowledged. The local backup is intentionally bounded so iOS pending-notification limits are not consumed by months of repeated escalation alarms.

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

These source/bundle checks do not by themselves publish an installable app. Native distribution additionally requires the relevant Expo/EAS, Android push, and Apple developer signing/push configuration.
