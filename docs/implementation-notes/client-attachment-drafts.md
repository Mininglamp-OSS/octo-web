# Client-owned attachment drafts

## Behavior
- Browser Web retains its existing confirmation before leaving attachments; it does not persist them.
- Embedded Client restores successfully saved attachments on conversation/space return.
- Client owns draft versions, send reservations, restore eligibility and deletion. Consumed records are hidden durably before blob cleanup; failed cleanup is retried.
- A send asks Client to reserve existing records for its captured attachment IDs before network submission; missing records do not block in-memory files. A late settlement targets only its original send token. Uncertain sends after renderer loss stay excluded from automatic draft restoration.
- Logout revokes draft handles immediately and clears the account's files before another session can use the service. Old async requests cannot recreate cleared files.

## File map
- Web `features/chat-composer/local-drafts`: optional UI port/types only, with no filesystem or authoritative draft/send state.
- Web `client-communication/localAttachmentDrafts` and `attachmentDraftPort`: typed Client bridge adapter, File conversion, persistence receipts and editor lifetime tracking.
- Web `ChatComposer`: attachment insertion/preview, navigation protection and captured send outcome integration.
- Client `shared/local-attachment-drafts*`: versioned, validated semantic IPC contract.
- Client `electron/main/communication/attachment-draft-host.ts`, `attachment-draft-store.ts` and `attachment-drafts/*`: persistence schema/IO, store transitions, session and editor handles, send transactions.
- Client preload/IPC/controller: capability wiring, trusted session routing and awaited logout cleanup.

## PR scope
Two coordinated PRs from current main. Browser behavior is unchanged; only embedded Client gains persistence. Reuse audited file storage primitives from the previous Client proposal. Replace the Web-owned lifecycle implementation, rather than retaining two competing authorities. No additional UI entry point or styling changes.

## Validation plan
- Client store/service tests with real temporary disk: save/restore, quota, checksum, identity isolation, removal, reservation/settlement, partial failures, stale versions, A-B-A, reload and logout races.
- Web bridge/composer tests: missing/legacy capability fallback, async send preparation before actual send, UI restore/unmount and removal, persistence failure confirmation, accurate partial-send mapping.
- Browser E2E: cancel/confirm navigation with an attachment; confirm drops the attachment.
- Electron E2E with the new bundled Web artifact: persist and restore across conversations, consumed attachment absence, space changes and logout clearing real disk.
- Client typecheck; Web composer/bridge suites, i18n validation and embedded renderer build; diff checks.

## Verified implementation
- Web client-communication and composer suites pass; browser Playwright confirms cancel preserves and confirmed navigation drops attachments.
- Electron with the rebuilt communication artifact verifies conversation/space return, UI-added file sending, absence of consumed drafts and logout clearing the actual draft directory.
- Client filesystem/lifecycle and auth/controller/logout tests, Client typecheck, both Web builds and locale checks pass.
- Remote storage and IM ACKs are simulated in E2E. No production service or packaged release validation is claimed.

## Rollout boundary
The renderer only installs persistence for a complete V4 capability. Client must bundle a released renderer containing this adapter before the combined feature is shipped. A lost renderer/process leaves uncertain sends excluded from automatic restoration; expiry/logout reclaims those records. The feature introduces no second visible entry point. Shared composer and conversation changes only connect attachment insertion, navigation protection and captured send outcomes to the optional port.

## Review repair plan
- Behavior: retry transient open/stage failures; re-stage undo-restored nodes; retain deletion intent through settlement and failed IPC; await cleanup before confirmed navigation. Allow non-persisted files to send through a Client-confirmed reservation of existing records. Surface uncertain Client failures with bounded waits and retry rather than silently blocking.
- Files: Client host/store and V4 wire contract own idempotent reservations, settlement and removal retry. Web adapter owns bounded IPC calls and editor receipts; composer supplies live Files for undo reconciliation; existing navigation callbacks await cleanup.
- Scope: update both coordinated implementations, replace Web PR #1838 after validation, retain existing Client MR. No new UI entry point.
- Validation: deferred/rejected open, stage, removal and settlement; delete during settlement; same-ID undo; missing receipts mixed with persisted files; retry after lost reply; timeout; real composer error feedback; browser navigation and Electron send/restore/logout.

## Failure semantics after review
V4 uses a stable request ID for prepare/settle, including cancellation after a timed-out prepare. Client accepts missing receipts by resolving existing records inside its serialized store; it cannot silently bypass a durable record. A failed local stage therefore does not make an in-memory File unsendable. If Client cannot confirm reservation, Web bounds the wait, preserves the compose and shows a retry message instead of sending with ambiguous durable state.

Deletion intent and failed settlement are retried in Client before a new editor opens. Explicit removal can consume a reserved version; later settlement cannot restore it. Web reports pending/failed deletions as unsafe and awaits reconciliation before navigation. Undo supplies the retained File to stage a new revision, including undo immediately followed by send before React effects run. Settlements release UI locks on failure and can be retried idempotently. The Web adapter still tracks non-authoritative editor receipts and pending requests; it is not stateless.

Review repair verification: Web communication 323 tests, composer 431 tests, browser leave-confirmation E2E, Client attachment lifecycle/storage 32 tests, auth/controller/logout 76 tests, and all three Electron E2E scenarios passed. Client typecheck, renderer builds, locale validation and diff checks passed. Electron undo coverage uses the actual editor clipboard and keyboard path, real IPC and temporary disk; remote upload/ACK remain simulated.
