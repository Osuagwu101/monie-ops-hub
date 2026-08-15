# Admin-only account model

- Reserved Admin/Director identity: `nnaemekasolomon31@gmail.com`.
- There is no public account registration.
- The reserved Admin may complete one-time account setup and choose a password.
- Every other account must be created by the Admin as a Staff Support Agent.
- Future staff use the same Admin-only provisioning flow.
- Direct Auth signup attempts for any non-reserved email are rejected before the user row is created unless they carry a valid, single-use Admin invitation.
- The Admin creates a staff invitation through a Director-only RPC, then the portal completes that exact staff signup with a temporary password. The invite token is never stored in plaintext.
- Staff users receive the existing `assistant` database role, preserving the current least-privilege operational permissions.
- The reserved Admin identity is always forced back to the `director` role and cannot be demoted through profile updates.

## Runtime verification

The migration was transaction-tested before installation and then verified again against the installed production functions with rollback-only synthetic users. The tests confirmed:

- the reserved Admin email is assigned the `director` role;
- a random public signup is rejected and leaves no user row;
- a Director-issued staff invitation creates an `assistant` profile and is marked `accepted`;
- the invitation controls the staff identity metadata and cannot be used as a generic signup bypass;
- a Staff Support Agent cannot create another staff invitation;
- all synthetic verification rows were rolled back.

Production currently has zero Auth users, zero profiles and zero staff invitations, so the real Admin password remains unset until the reserved Admin completes the one-time setup.
