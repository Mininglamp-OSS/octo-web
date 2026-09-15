# Bounded recovery of unacknowledged sends

## Behavior list

- The existing send action keeps its local message while transient route errors or lost ACKs are retried.
- A retry keeps `client_msg_no`, plaintext payload and channel. Each wire attempt gets its own `clientSeq`; UI notifications keep the original sequence.
- Permission/content errors stop immediately. After multiple attempts, a rejection cannot disprove an earlier commit and becomes “delivery outcome unknown”, as does exhaustion without a definitive result. Neither proves absence from history.
- Explicit disconnect, logout and account replacement clear pending packets and timers. Uploads are eligible only after the SDK marks their payload ready.
- No new menu or send entry point is added.

## File map

- `src/im-runtime/sendRecovery.ts`: one SDK-instance adapter owns timers, immutable packets, attempt correlation, bounded queues and teardown.
- `src/im-runtime/sendRecovery.test.ts`: SDK integration and deterministic timers covering lost/late ACK, reconnect, upload and account replacement.
- `src/App.tsx`: opt-in installation before connecting.
- `src/Messages/Base/index.tsx`, `src/i18n/locales/*`: distinguish an unknown outcome from a confirmed failure in the existing error presentation.

## PR scope

This is the client part of the IM recovery fixes. It uses the installed JS SDK 1.3.5 at its documented manager methods; it does not modify shared SDK prototypes or dependency bundles. The adapter replaces the SDK's send batching timer and reconnect flush for tracked sends so they cannot independently retry the same packet.

## Validation plan

Use the real SDK packet classes and manager callbacks with fake transport and timers. Verify a single local echo, stable logical key and payload, distinct attempt sequence, old negative ACK suppression, late success, bounded timeout, transient/permanent classification, no early upload transmission, non-persistent messages never automatically replayed, and logout cleanup. Run existing IM runtime and message status presentation tests and i18n checks.

## Rollout

Set `VITE_IM_SEND_RETRY_ENABLED=1` only after all IM nodes have PR46's durable idempotency protocol and the server forwarding recovery deployed. The flag is off by default for compatibility with older deployments. No deployment is performed by this PR. The adapter is specific to SDK 1.3.5 and its integration tests must be run before upgrading that dependency.
