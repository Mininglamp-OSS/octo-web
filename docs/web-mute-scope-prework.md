# Web Client Mute-Scope Pre-Work

## 1. Behavior List

- **Entry**: The host (Client) may independently provide `getNotificationPreferences()` and `onNotificationPauseChanged()` on the `OctoBuddyCommunicationBridge`. Only the query capability installs a notification provider; pause pushes remain usable with the legacy store. The adapter is installed after the login session is bound; BaseModule initializes the account-scoped store during startup afterward. Cleanup runs on `pagehide` / `sessionRevoked`.
- **Primary path**: Host sends notification pause CMD → `quickMuteStore.applyRemoteCMD()` updates the store → `getNotifyDecision()` uses new `notificationPolicy` helper to resolve final `{playSound, showPopup}` → notification consumers (IM message sound/popup, friend request tone) all use the same common decision.
- **Empty/loading/error states**: No preference-query capability → unchanged legacy decisions, including for pause-only hosts. A declared provider that rejects, returns invalid data, or is disposed still suppresses both outputs. A disposed Client context never returns to standalone defaults; a newer provider is not affected by an old cleanup.
- **Versioning**: Version 1 validates the four required fields and ignores additive fields without forwarding them. Missing or invalid required fields and unknown versions are rejected. Changes to required fields or their semantics require a new contract version.
- **Permissions/login/Space**: Provider bound to the current login session; on `sessionRevoked` all pending results fail closed.

## 2. File Map

| File | Change | Responsibility |
|------|--------|----------------|
| `packages/dmworkbase/src/features/notifications/notificationPolicy.ts` | **New** | Provider interface, install + resolve helper, rejection safety |
| `packages/dmworkbase/src/features/notifications/notificationPolicy.test.ts` | **New** | Unit tests for the policy helper |
| `packages/dmworkbase/src/features/notifications/index.ts` | Edit | Add `export * from "./notificationPolicy"` |
| `packages/dmworkbase/src/module.tsx` | Edit | `getNotifyDecision()` uses notificationPolicy helper; `tipsAudio()` rechecks; friend request uses common decision |
| `packages/dmworkbase/src/__tests__/module.notification-policy.test.ts` | New | Actual BaseModule decisions and final Howler playback gate |
| `packages/dmworkbase/src/Utils/NotificationUtil.ts` | Edit | No browser fallback when Client declines native notification |
| `apps/web/src/client-communication/notificationPolicyAdapter.ts` | New | Minimal preference bridge, pause events and context-scoped cleanup |
| `apps/web/src/client-communication/hostBridge.ts` | Edit | Add optional `getNotificationPreferences()` and `onNotificationPauseChanged()` bridge methods |
| `apps/web/src/client-communication/index.tsx` | Edit | Install host notification policy adapter (store CMD listener + cleanup) |

## 3. Scope (What This PR Does)

**This PR:**
- Defines `HostNotificationProvider` interface + `installNotificationProvider()` + `resolveNotificationPolicy()` in `features/notifications/notificationPolicy.ts`
- Plugs the provider into `BaseModule.getNotifyDecision()` so IM/message/friend-request notification decisions all flow through the same policy
- Modifies `tipsAudio()` to recheck policy at final playback when host provider active (no `allowDuringQuickMute` bypass)
- Uses the final sound gate for hosted friend requests, retaining standalone behavior
- Adds optional bridge methods to `OctoBuddyCommunicationBridge`
- Installs the adapter in `client-communication/index.tsx`: listens to `onNotificationPauseChanged` → `quickMuteStore.applyRemoteCMD()`; the store alone owns validation, revision ordering and reconciliation refresh. Cleans up on `pagehide` and `sessionRevoked`
- Provider resolves scope as `'popup' | 'all'` during active mute; inactive uses host booleans `desktopNotifications` / `soundNotifications`

**This PR does NOT:**
- Change the standalone Web (no host provider) notification behavior
- Add manifest/version bumps, pin changes, or publish artifacts
- Modify desktop-zoom tests, E2E tests, or component tests
- Install new dependencies (uses existing Howler, etc.)

## 4. Verification Plan

```bash
pnpm --dir packages/dmworkbase exec vitest run src/features/notifications src/__tests__/module.notification-policy.test.ts src/__tests__/module.smoke.test.ts src/Utils/__tests__/NotificationUtil.test.ts src/Utils/__tests__/NotificationUtil.host-policy.test.ts src/Components/NavRail/__tests__/QuickMuteStore.test.ts
pnpm --dir apps/web exec vitest run src/client-communication/notificationPolicyAdapter.test.ts
```
App smoke test should show `getNotifyDecision` returning `{playSound:true, showPopup:true}` when no provider, and returning host-affected values when provider installed. Stale/disposed provider returns suppressed.

## 5. Acceptance and Delivery

The user confirmed acceptance on 2026-09-17. Policy and real notification-consumer
tests passed (85 tests), along with the communication adapter tests (4 tests).
Client integration was also exercised against a compiled communication artifact,
with HTTP and final notification/audio output sinks isolated in the E2E fixture.
This does not claim production message delivery or packaged OS acceptance.

This source change must be included in a published communication artifact before
the Client release pin is updated. The local preview applies the same mute patch
to the Client's existing pinned base; that dirty preview build is not a release
artifact. No artifact version, Client pin, credentials, or local build outputs are
part of this commit. Standalone Web behavior remains unchanged.

## 6. Review Follow-Up (2026-09-17)

- B-1: Install a host provider only when the preference query exists. Subscribe to
  pause CMDs independently. Cover neither capability, both capabilities, pause-only,
  and preferences-only hosts; a failed declared query still fails closed.
- A-1: Accept additive version-1 fields while validating every required field.
  Return only known fields and the local lease, so extra fields cannot override
  lifecycle checks. Unknown versions and malformed required fields remain rejected.
- A-2: Let `QuickMuteStore.applyRemoteCMD()` own malformed/gapped-command refreshes.
  The adapter no longer refreshes on every false return, including stale revisions.
- A-3: Correct the startup comment: binding the login session does not mean the
  account-scoped quick-mute store has already been initialized by BaseModule.

The new regression tests first reproduced four failures against the reviewed
implementation: pause-only provider installation, redundant refresh for malformed
and stale commands, and rejection of additive fields.

After the fix, all 9 adapter tests pass; the broader communication suite passes
255 tests across 27 files. Notification policy, actual consumers, standalone
smoke/fallback and QuickMuteStore regressions pass 92 tests across 9 files.
A separate local communication artifact build also passes with `sourceDirty`
and `e2eMock` explicitly marked true; it is not a release artifact.

This follow-up does not change native notification fallback, cache preferences,
alter the Client bridge or artifact pin, or change page lifecycle handling.
