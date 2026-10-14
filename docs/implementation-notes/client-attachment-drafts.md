# Client-owned attachment drafts

## Behavior list
- Browser Web retains its existing confirmation before leaving attachments; it does not persist them. Embedded Client restores successfully saved attachments on conversation/space return.
- Client owns draft versions, send reservations, restore eligibility and deletion. Consumed records are hidden durably before blob cleanup; failed cleanup is retried.
- Before network submission, a send asks Client to reserve existing records for its captured attachment IDs. Missing records do not block in-memory files. A stable request ID supports retry and cancellation after a timed-out prepare; settlement affects only that transaction.
- If reservation fails, the compose is retained and an error is shown. A completion-hook failure cannot overwrite already established full/partial delivery outcomes.
- Explicit deletion creates a retryable transport request before awaiting IPC. Only acknowledgement retires it. Requests that never reach Client survive editor unmount and conversation A-B-A navigation for the authenticated renderer session.
- Confirmation attempts current cleanup and may waive its navigation guard, even on persistent failure. It never erases pending tasks or waives new concurrent work. Cancellation before confirmation changes nothing. While confirming, Cancel/Esc/mask are disabled and loading is shown. Host-forced cancellation suppresses stale navigation without destroying cleanup ownership.
- Restore retries queued requests and masks unresolved deletion IDs, then obtains a fresh Client snapshot. In-flight staging is retained on navigation; confirmation does not delete a write just because its receipt has not arrived.
- Logout immediately revokes draft handles and clears the account's files before another session can use the service. The renderer queue is disposed; old callbacks cannot acquire another account's lease. Space/channel queues remain separate.

## File map
- Web `features/chat-composer/local-drafts`: optional UI port/types, without filesystem or authoritative draft/send state.
- Web `client-communication/localAttachmentDrafts` and `attachmentDraftPort`: capability/lifetime wiring, File conversion, persistence receipts, bounded IPC and editor integration.
- Web `client-communication/attachmentDraftCleanup`: session-owned transport outbox with acknowledgement, coalescing, deletion visibility masks and per-request navigation waiver. It stores pending callbacks, not attachment bytes or durable lifecycle records.
- Web `ChatComposer`: attachment insertion/preview, undo re-staging, navigation protection and captured send outcomes. Existing ChatPage/workspace confirmation paths supply loading and cancellation guards.
- Client `shared/local-attachment-drafts*`: validated V4 semantic IPC contract.
- Client `electron/main/communication/attachment-draft-host.ts`, `attachment-draft-store.ts` and `attachment-drafts/*`: persistence schema/IO, store transitions, session/editor handles and send transactions.
- Client preload/IPC/controller: capability wiring, trusted session routing and awaited logout cleanup.
- Client `tests/e2e/local-attachment-cleanup.spec.ts`: real editor/preload/disk regression with deletion IPC intercepted before reaching the Client handler, pending confirmation, leave/return, and recovery.

## PR scope
Two coordinated changes with one attachment entry point. Client owns local persistence and lifecycle; Web adapts its existing composer to that capability. Shared composer/conversation and ChatPage changes only connect attachment insertion, navigation protection and captured send outcomes. No additional menu, route or styling system.

The latest repair retains undelivered IPC ownership outside the editor, independently of navigation permission. It updates the existing Client MR with integration coverage and replaces the Web PR after validation. No Client production lifecycle change is needed for these renderer-side blockers.

## Cleanup states and transitions

| State | Navigation | Retry / restore behavior |
| --- | --- | --- |
| Pending or failed request | Prompt unless explicitly waived | Keep request; coalesce concurrent attempts; mask deleted IDs |
| Explicitly waived request | Allow confirmed departure | Retain request across editor unmount; retry on return/send/discard |
| Acknowledged request | No cleanup guard | Retire only that task after Client acknowledgement |
| Session disposed | Old editor cannot act | Clear session queue; reject old async work before further host calls |

Navigation confirmation snapshots the tasks it attempts. Waiving those tasks in `finally` cannot erase a settlement registered concurrently. Acknowledgement is the only per-request destructive transition; navigation cancellation or host suspension does not retire tasks. Saving entries are not cleanup requests unless the user explicitly deleted them.

Client also retains received-but-failed removal/settlement intents, retries each independently and filters pending removed revisions from restoration. Explicit removal can consume a reserved revision; a later retained-send settlement cannot revive it. Unknown send IDs are rejected and stale-revision removals are idempotent. Identity fields are metadata; disk filenames use hashed identities and random blob tokens. Manifest reads validate metadata and verify blob size/checksum.

New sends retry pending work involving the same IDs; unrelated sends remain available. Same-ID undo waits for prior cleanup and re-stages the retained File under a new revision. Failed settlements release UI preparation locks and retain their original decision for idempotent retry. Request-ID generation occurs within asynchronous preparation, so a randomness error still reaches the composer error/settlement path.

## Validation plan
- Client real-disk store/lifecycle: save/restore, quota/checksum, identity isolation, removal, reservations, settlement, partial failures, stale versions, reload/logout races and independent retry.
- Web stateful adapter: dropped-before-host removal, remount/retry without deleted-file hydration, concurrent settlement during discard, in-flight staging, disposal, fresh restore after consumption and coalesced retries.
- Existing composer/bridge suites: capability fallback, preparation before send, partial outcomes, undo and persistent failure feedback.
- Confirmation tests: loading, disabled cancellation, double-click suppression and stale/host-forced cancellation in both ChatPage and workspace paths.
- Browser leave-confirmation and Electron with a rebuilt bundled renderer; Client typecheck, locale validation, builds and diff checks.

## Verified implementation
- Web communication: 32 files / 337 tests. Composer plus ChatPage confirmation: 44 files / 435 tests.
- Client attachment lifecycle/storage: 34 tests; Client typecheck and main/preload/renderer build.
- Web embedded and browser E2E builds; locale validation; browser cancel-retains / confirm-leaves regression.
- Five Electron scenarios pass with the rebuilt communication artifact: conversation/space restoration and logout disk clearing; normal send; persistent settlement failure with another attachment send and confirmed navigation; paste/delete/undo/send; dropped deletion with pending confirmation, leave/return without resurrection, then successful disk cleanup on IPC recovery.
- Electron uses the real editor, preload, Client service and temporary disk. Remote uploads and IM ACKs are simulated. No production service or packaged release validation is claimed.

## Rollout and recovery limits
The renderer installs persistence only for a complete V4 capability. Client must bundle a released renderer containing this adapter before the combined feature ships. No generated artifact is committed by these PRs.

The Web outbox is authenticated-renderer-session memory, not durable storage. It survives conversation unmount and space return, but not renderer/process loss. A deletion never received by Client before renderer loss, or a received removal intent not persisted before Client loss, can leave a local copy behind. Confirmed navigation reports incomplete cleanup and does not claim durable deletion. Uncertain send reservations remain durably excluded from restoration after renderer loss; expiry/logout reclaims them.
