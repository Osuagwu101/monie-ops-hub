# Admin-only account model

- Reserved Admin/Director identity: `nnaemekasolomon31@gmail.com`.
- There is no public account registration.
- The reserved Admin may complete one-time account setup and choose a password.
- Every other account must be created by the Admin as a Staff Support Agent.
- Future staff use the same Admin-only provisioning flow.
- Direct Auth signup attempts for any non-reserved email are rejected before the user row is created.
- Staff users are marked in trusted `app_metadata` by the Admin provisioning endpoint and receive the existing `assistant` database role, preserving the current least-privilege operational permissions.
- The reserved Admin identity is always forced back to the `director` role and cannot be demoted through profile updates.
