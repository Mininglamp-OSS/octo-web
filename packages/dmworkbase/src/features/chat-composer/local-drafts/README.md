# Conversation-local drafts

## Behavior list
- One draft per server/account/space/channel; no draft content is sent to the server.
- Preserve editor JSON, attachment identities and upload insertion anchors across conversation switches and reloads.
- The open conversation hides its draft preview. Other rows show a red localized draft label and an ordered, single-line preview.
- Client retains ownership of attachment bytes through its existing V4 port. Browser Web stores blobs in IndexedDB. Both store editor documents and preview indexes locally in IndexedDB.
- Saving failures retain live content and navigation protection. Logout revokes pending operations and removes the account's local records.

## File map
- `model.ts`: serializable documents, attachment metadata and ordered preview derivation.
- `database.ts`, `repository.ts`: IndexedDB persistence, local subscriptions and account cleanup.
- `browserPort.ts`, `documentPort.ts`: browser attachment lifecycle and document persistence around either attachment provider.
- `../bridge/useConversationDraft.ts`: editor capture/restore and upload anchor mapping.
- Existing Conversation/ConversationList: scope wiring and preview presentation only.

## PR scope
Browser and embedded Client local drafts through the existing composer. Shared conversation/list/auth changes wire draft scope, preview subscriptions and logout cleanup. No new routes or menus. Remote scroll-position updates remain separate from draft content. Client V4 attachment lifecycle is retained.

## Verification plan
- Model/storage tests: mixed order, metadata-only summaries, reload, isolation, stale writes and cleanup.
- Real editor tests: A-B-A, top and inline attachments, anchors after edits, remove/undo, full/partial sends and delayed restoration.
- List tests/Story: selected versus inactive rows, draft precedence and overflow in light/dark and zh-CN/en-US.
- Run composer/communication regression suites, i18n validation and affected builds.

## Verified locally
- Composer, conversation list and assistant-intent regression: 54 files / 695 tests passed.
- Client communication regression: 32 files / 338 tests passed.
- After the HTTP-origin revision-generation adjustment, local storage and real-editor tests: 2 files / 16 tests passed.
- Browser Playwright scenario passed: ordered mixed drafts, A-B-A, removal, reload and no draft field in remote extra updates.
- Web E2E build and Client communication artifact build passed; the latter used a mock API URL and explicitly allowed the uncommitted working tree.
- i18n validation and `git diff --check` passed. Light/dark conversation-list Story was checked visually.
- Packaged native Client end-to-end testing remains outside this local verification. Repository-wide TypeScript checking is not clean (React JSX type resolution and existing composer type errors); the successful builds above do not constitute a clean typecheck.

Preview: `base-conversationlist--local-attachment-drafts`. Click a conversation to check that its draft label disappears and the previously selected conversation's draft reappears.

## Review fixes
- Legacy remote text remains visible until the first local restore imports it. An existing empty local record always wins, so cleared drafts stay cleared.
- File deletion checks current liveness and retains an undo snapshot for the current port. IDs-only undo during or after deletion schedules replacement bytes with the original metadata and position; navigation remains unsafe until that write succeeds.
- Cross-window CAS conflicts offer an explicit merge through the existing confirmation dialog. Both texts are retained, shared attachment identities are deduplicated, and the merged editor must be reviewed before sending.
- Runtime-owned Client session revocation and authentication expiry clear account drafts independently of UI mounting.
- Sending freezes attempt-owned upload anchors; failure restores them after the recovered document is inserted, then ordinary editing maps them again.
- Preview notifications carry scope/channel identity. Active-conversation edits and other-space edits do not rerender the conversation list.

Regression commands:
```sh
pnpm --dir packages/dmworkbase exec vitest run src/features/chat-composer src/Components/ConversationList/__tests__ --maxWorkers=2
pnpm --dir apps/web exec vitest run src/client-communication/attachmentDraftPort.test.ts src/client-communication/attachmentDraftCleanup.test.ts src/client-communication/runtime/start.test.ts --maxWorkers=2
pnpm i18n:check
```

Review-fix verification: 52 composer/list suites (544 tests), Conversation integration plus composer migration (122 tests, 7 overlapping), and 3 Client suites (32 tests) passed. The 11 mute-error assertions also fail against the pre-fix ConversationList snapshot; they are excluded from the 52-suite passing run. i18n and diff checks passed. Full package TypeScript checking remains blocked by existing React declaration/module-resolution and other project errors. Packaged Client/browser E2E was not rerun for these fixes.


## Durable recovery and logout fixes
- IndexedDB schema v2 adds account generations and attachment intent records; the upgrade retains existing v1 documents and blobs.
- Every document/attachment mutation checks its captured account generation in the same transaction as the write. Logout advances that generation and clears account records atomically. Suspended writers cannot recreate cleared data; BroadcastChannel invalidates other-window caches when available, but correctness does not depend on delivery.
- Attachment removal records its decision before deleting bytes. Document membership transitions commit with the document, so a saved empty draft cannot restore a deleted file even when attachment cleanup fails. Pending-stage blobs without a removal decision remain recoverable; undo restores membership.
- Restoration orders attachment rows by insertion position and continues numbering from existing rows.
- Initial restore failure shows retry and explicit temporary-draft actions. Temporary mode disables persistence and attachment settlement for that compose, preserving unread saved content. Live attachment synchronization waits until restoration completes.

Focused regression coverage includes fresh-repository deletion failure through the real composer/send callback, failed attachment-intent writes with successful document commits, pending stage and undo, two database connections with notifications disabled, paused writes during logout, broadcast cache invalidation, schema upgrades, consecutive reopens, retry followed by sending, and temporary sending without altering the saved draft.


Verification for the durable-recovery fixes: 54 composer/list suites (557 tests), 124 conversation integration tests, and 32 Client lifecycle tests passed (713 distinct tests). Chromium passed the existing navigation/reload scenario and the new retry/temporary-mode scenarios in both zh-CN and en-US. Light/dark screenshots of the recovery UI were inspected in both languages. The Web E2E build, i18n validation, and diff checks passed. The previously documented mute-test exclusions and repository-wide TypeScript baseline failures still apply; packaged native Client testing was not performed.

## PR 1845 follow-up plan

### Behavior list
- Extend the existing recovery entry to save failures after loading. Preserve live content and allow explicit temporary document operation while retaining attachment ownership and conflict guards.
- Pin failed initial generation captures to their session. Retrying must not adopt another window's post-logout generation. Ordinary document-read failures remain retryable.
- Clear drafts in shared low-level logout, capturing identity before erasing credentials. Await cleanup before auth-expiry teardown or standalone reload.

### File map
- `repository.ts`, `documentPort.ts`, `contract.ts`: session fences and attachment-only navigation guard.
- `../bridge/useConversationDraft.ts`, `../ui/ChatComposer.tsx`: explicit recovery and compose preservation.
- `../../../App.tsx`, web auth lifecycle and standalone expiry helper: shared cleanup and teardown ordering.
- Existing locales and storage/composer/auth tests: recovery copy and adverse-order regressions.

### PR scope
Repair local draft reliability and logout through existing entry points. Shared impact covers composer ports and authentication cleanup. Preserve conflict detection, native attachment ownership and remote scroll behavior.

### Verification plan
- Failed capture → other-window logout → same-port retry, with/without broadcasts and through the visible retry action.
- Post-load write failure → explicit recovery → successful text send, preserving the saved copy and failed-send recovery; attachment readiness still blocks unsafe sends.
- Communication expiry without runtime or later host revocation, plus standalone expiry: deletion completes before teardown and stale writers remain fenced.
- Composer/storage/auth suites, i18n/diff checks, web build and browser recovery coverage in both locales/themes.

### Follow-up behavior and verification
- An initial generation-read failure remains pinned for that repository session. Retry cannot acquire a newer generation; the initial recovery UI still offers temporary operation without writing saved data. Retry continues to work for ordinary transient document/attachment reads.
- A post-load document-save failure offers retry-save or explicit temporary document operation, retaining the live compose, upload anchors, failed-send recovery and the last persisted document. Attachment staging/reservation/settlement remains active and must succeed before attachment sends. Temporary operation does not bypass a detected cross-window conflict.
- Low-level `LoginInfo.logout()` captures current or stored account identity before synchronously erasing credentials, starts revocation, and returns its completion. Authentication-expiry reporting and standalone reload await that completion. This covers renderers without an owner runtime or subsequent host callback.
- Parsed draft nodes now implement the shared editor-node contract; recovery no longer needs incompatible double type assertions.

Verified on the follow-up revision:
- 56 base suites / 712 tests passed (composer, local storage, conversation/list and real logout integration). The previously documented mute-test filename exclusions remain.
- 7 web suites / 74 tests passed (shared/communication authentication expiry, runtime, attachment ports/cleanup and standalone session recovery).
- 5 Chromium scenarios passed: ordered draft navigation/reload, initial retry/temporary operation and post-load quota recovery in both zh-CN and en-US. Light/dark recovery screenshots were inspected in both locales.
- Web E2E production build, `pnpm i18n:check` and whitespace checks passed.
- Full package `tsc --noEmit` remains non-clean due to repository-wide declaration/module-resolution and existing errors. The recovery TS2352 diagnostics are absent. Packaged native Client testing was not performed.

## Outstanding-write and host-revocation follow-up plan
- **Behavior:** accepting temporary document mode immediately revokes this compose's document writes, including queued work and open transactions. Attachment ownership and other composers remain active. Host revocation cancels navigation immediately and reloads only after cleanup completes.
- **File map:** document port/repository/database carry a per-compose cancellation signal through the write transaction; the existing temporary button triggers it. The communication, summary and apps shells await logout in their existing command handlers. Existing composer/storage/shell suites cover the boundaries.
- **PR scope:** reliability fixes within local drafts and Client authentication lifecycle; no new UI, copy, route or schema.
- **Verification:** reproduce failed save → held save → temporary mode → successful send → late release → fresh restore; cover cancellation during an open transaction, independent composers and CAS. Deliver real shell host commands with cleanup held/released, asserting immediate navigation cancellation and delayed reload. Run focused and adjacent regression suites, build and whitespace checks.

### Outstanding-write and revocation verification
- Temporary mode now aborts a per-compose document signal before updating UI state. The repository skips cancelled queued work; the database checks cancellation around opening and aborts active document transactions, including atomic attachment-membership changes. Document save, merge and recovery all share this fence. Attachment mutations do not use this signal.
- Cancelled optimistic snapshots are invalidated and reloaded from the durable copy. Another composer's newer snapshot, including an identical pending snapshot with a different owner, remains independently writable; revision CAS and account-generation checks remain in place.
- Communication, summary and apps shells cancel their existing navigation/runtime work immediately and await logout before reload. Revocation is terminal for the mounted shell, so duplicate commands cannot trigger a second identity-empty logout and premature reload.
- The real-composer regression first failed with revision 3 replacing revision 2; it now passes through late release and fresh-repository editor restoration. Additional storage regressions abort an open transaction and verify independent document/attachment ownership. All three real-shell command tests hold cleanup, assert no reload, release cleanup and assert one reload; communication/summary cancellation remains immediate.
- 56 base suites / 716 tests and 10 web suites / 147 tests passed (863 tests). Existing mute-test exclusions remain. Five Chromium draft scenarios, the web E2E production build, i18n validation and whitespace checks passed. Full package typechecking and packaged native Client verification were not rerun; their previously documented limitations remain.

## PR 1846 reservation recovery plan
- **Behavior:** an interrupted browser send blocks initial draft hydration until the user explicitly restores its files or chooses existing temporary mode. The warning asks users to check other windows/chat history because delivery is uncertain. Restored files can then be removed normally. No automatic timeout or resend.
- **File map:** database/browser port own reservation snapshots and atomic recovery; the existing composer recovery banner owns the choice; locale resources supply copy. Storage and browser tests cover recovery, and the E2E fixture handles unload-time metadata requests.
- **PR scope:** browser local drafts and mock test transport only; native V4 ownership remains unchanged.
- **Verification:** crash/reopen, failed recovery/retry, late settlement, competing recovery, logout fences, upload and inline-image restoration; localized light/dark browser checks, existing draft regressions, E2E build and i18n validation.

### PR 1846 outcome and validation
- Browser restoration now surfaces a recoverable reservation snapshot instead of silently hiding uncertain files forever. The existing warning banner offers explicit recovery or temporary mode; the latter leaves the saved reservations untouched. Users can remove unwanted recovered files through the existing attachment controls.
- Recovery atomically checks both reservation and attachment revision, advances the file revision, clears the reservation and restores membership. Late settlement, competing recovery/restaging and account revocation cannot reclaim a newer file. Inline images omitted by a consumed saved document are reinserted using their existing preview resources.
- CI run 38843116184 had 206 passing scenarios but one `/conversations/draft-leave-b/2/extra` proxy error. Its existing MSW handler can lose the originating client during unload. The reload scenarios now install narrowly scoped context-level POST mocks for their own conversation metadata requests, assert that draft content is absent, and preserve the strict CI proxy-error gate.
- Verification: 47 composer suites / 489 tests passed. After the final error-feedback/type/copy refinements, 4 storage/composer suites / 55 tests passed. All 7 draft Chromium scenarios passed without proxy errors; both localized interrupted-send scenarios passed again after the interpolation fix. The four zh-CN/en-US light/dark recovery screenshots were inspected.
- `pnpm --dir apps/web run build:e2e`, `pnpm i18n:check` and `git diff --check` passed. Full package `tsc --noEmit` remains non-clean with repository-wide missing React/Node declarations, third-party strictness errors and module-resolution failures. The complete 208-scenario E2E suite and packaged native Client were not run locally for this increment.

## Failed-stage and closed-connection recovery

- Attachment staging now has per-file ownership tokens. Removing a file retires its queued/failed stage immediately; a replacement stage supersedes older retries. Checks before loading and inside the storage mutation skip obsolete bytes. If a stage already committed, its revision remains available to the queued removal. The repository continues retaining deletion and send-settlement work until acknowledgement.
- A closed IndexedDB connection is invalidated by its own `close` event. All operations share transaction creation, which can reopen once on synchronous `InvalidStateError` before transaction work starts. Async transaction failures are not automatically replayed, and a delayed event from an older handle cannot evict its replacement.
- Reconnection does not clear repository sessions or recapture account generations. Mutations retain the original generation, document CAS and cancellation checks.
- Regressions cover large-file quota failure → actual Remove button → small-file persistence and successful composer send; public-port removal/replacement; settlement queued behind obsolete staging; connection-close notification and missing notification; bounded reconnect failure; delayed close; logout and CAS across reconnect; and the visible Retry loading action followed by sending.
- Connection-close tests use real fake-indexeddb handles and explicitly invoke the abnormal-close handler where applicable. They verify connection/retry behavior, not a physical browser storage-pressure event.

## Temporary-send membership and mounted revocation

- Temporary sends calculate retained attachment IDs before consuming the saved document. Consumption retains an incremented empty tombstone and records membership for the browser attachment revisions captured by the send reservation. Failed attachments remain recoverable; a late consumption cannot hide a same-ID replacement blob.
- A document port whose captured account epoch was revoked rejects restore/save/flush/recovery and keeps both navigation predicates false. Live editor content remains visible and the existing save-recovery UI receives the error. The old port never acquires a new account generation.
- Regression tests exercise partial temporary sends followed by fresh-repository restore, same-ID replacement before old consumption, and a mounted Composer receiving revocation from another database connection through BroadcastChannel.
- Browser metadata assertions require an explicit empty remote draft and reject local draft content in those requests.
- Validation: focused storage/Composer suites passed 67 tests; the final generation check passed 35 storage/Composer tests. The complete Composer run passed 504/505 tests; the legacy-import test timed out awaiting initial hydration under concurrent build/test load and its isolated seven-test suite passed. Conversation/list tests passed 161 tests and data-source tests passed 22. Native attachment adapter tests passed 32 tests. The seven Chromium draft scenarios, E2E build, i18n and whitespace checks passed. Full package TypeScript checking remains non-clean with missing React/Node declarations and existing project/dependency diagnostics; packaged native Client verification was not performed.
- Validation: `pnpm --dir packages/dmworkbase exec vitest run src/features/chat-composer --maxWorkers=2` passed 48 suites / 499 tests. The 7 Chromium draft scenarios passed with no proxy errors. The E2E production build, i18n and whitespace checks passed. Full repository typechecking and packaged native Client validation were not rerun for this increment; the previously recorded limitations remain.

## Revoked temporary-send completion

- Document consumption checks the port's captured account epoch before entering the repository. A late successful send, including one from an unmounted Composer, cannot adopt the replacement session installed by local logout and clear a new draft whose revision restarted at 1.
- Operations that entered before logout retain the existing database transaction generation check. Public-port regressions cover same-repository and other-connection cleanup, both before consumption starts and while consumption is suspended, with BroadcastChannel disabled.
- Real-Composer regressions cover logout → unmount → new-session draft → old send success, and a same-ID attachment replacement while a temporary send is in flight. Removing the epoch guard reproduces draft loss; removing the Composer's attachment-revision forwarding reproduces attachment loss.
- Validation: all 48 Composer suites / 511 tests and the 3 Client attachment/authentication lifecycle suites / 33 tests passed. Both targeted guard/forwarding mutations failed their new regression tests and were reverted; `git diff --check` passed. Browser E2E, packaged Client, production build and full repository typechecking were not rerun for this increment.

## PR 1848 attachment recovery fixes

- A failed file-task flush no longer prevents reading durable attachments or exposing pending-send recovery. Restore reports the queue failure through the existing `failedCount` feedback while retaining failed work for retry; navigation and sending still require acknowledged file operations. Storage read failures and account-generation fence failures still reject restoration.
- Removal retains the stored file's bytes, name, MIME type, modification time, source and insertion position for IDs-only undo. Both in-flight and completed deletion can restage that snapshot. Membership restoration alone does not make missing bytes durable or allow navigation.
- Scope: browser attachment persistence only, through existing Composer restore/error/undo entry points. The native Client attachment lifecycle and public port contract are unchanged.
- New storage regressions cover persistent stage/remove/settle failures, reservation visibility, retry retention, queued/pre-commit/post-commit/completed deletion undo, failed restaging, unreadable storage and logout fencing. A real-Composer test remounts on the same repository after failed cleanup, restores only the surviving file, blocks sending while writes fail and sends after storage recovers.
- Validation: the original implementation failed 6 of the first 7 regression cases. After the fixes, all 49 Composer suites / 522 tests, the Web production build, i18n validation and whitespace checks passed. Browser E2E, packaged native Client and full repository typechecking were not rerun for this increment.

## PR 1848 migration and generation integrity plan

- **Behavior list:** legacy remote drafts remain intact until a local document is durably acknowledged. Browser attachment edits and deletion target the editor's captured generation; fresh same-ID stages and retained failed sends remain recoverable. Existing retry, temporary mode, navigation and recovery entry points remain the only user paths.
- **File map:** `documentPort.ts`/`contract.ts` expose durable acknowledgement and attachment-generation snapshots; `repository.ts` carries captured snapshots; `database.ts` stores generation-specific membership decisions with legacy-key read compatibility; `browserPort.ts` owns stable staging, replacement checks and retained-send generations; `../ui/ChatComposer.tsx` captures generations before publishing editor mutations; Conversation's existing metadata adapter preserves unmigrated legacy values. Focused storage and real Composer/Conversation tests cover each boundary.
- **PR scope:** local-draft data integrity and its existing Conversation metadata adapter. No new endpoint, schema store, route, copy or native attachment owner. Intent keys become generation-specific inside the existing store; old keys remain readable, with revisionless deletion retired only when new bytes commit.
- **Verification plan:** first reproduce failed-read/temporary/leave and ordinary-save/same-ID loss; test old/new stage and document ordering, quota retries, failed-send retention, delayed writes, stale windows, undo and legacy storage compatibility. Run Composer, Conversation migration and Client port regression suites, production/E2E builds as appropriate, i18n and whitespace checks. Have an independent reviewer examine the final ownership rules.

### Integrity fixes

- Conversation metadata now clears the legacy remote draft only after its port acknowledges a durable local document. Failed reads, failed or cancelled initial writes, and temporary mode explicitly preserve the old remote value. Successful empty local documents remain authoritative.
- Document writes capture both the editor's durable and pending attachment generations. Each generation has its own intent key, so an old window cannot replace a newer generation's deletion decision. Unknown generations never create wildcard removal records. Reads still support previous intent keys; a committed fresh stage retires an obsolete revisionless tombstone.
- Staging assigns its generation before publishing an editor/store change and preserves it across retries. The write compares the expected previous blob generation and rejects replacement by a stale retry. A pending generation already removed by its document is not installed. A failed replacement retains ownership of both its old durable bytes and its pending bytes for removal.
- Failed-send settlement gives retained files a fresh generation. A delayed consumed-document write cannot hide them, even when saving the recovered document fails and the user chooses temporary mode. Ordinary database reads during send/settlement do not transfer ownership of another window's replacement into the old editor.
- New regression tests use fresh database connections and actual file bytes, plus real Composer insertion/Remove/send/temporary controls and Conversation teardown. They cover both write orders, pending and quota-failed stages, obsolete retries, failed blob cleanup, legacy intent compatibility, crash recovery, partial sends and legacy migration. Independent review also checked the native adapter's compatibility with staging before editor publication.

### Final verification for the migration/generation fixes

- `pnpm --dir packages/dmworkbase exec vitest run src/features/chat-composer src/Components/Conversation/__tests__ --maxWorkers=1`: 72 suites / 894 tests passed.
- `pnpm --dir apps/web exec vitest run src/client-communication/attachmentDraftPort.test.ts src/client-communication/attachmentDraftCleanup.test.ts src/client-communication/runtime/start.test.ts --maxWorkers=1`: 3 suites / 33 tests passed.
- Web production and E2E builds passed. Chromium passed all 7 draft recovery/navigation scenarios in zh-CN/en-US on the final implementation.
- i18n validation and whitespace checks passed. Full repository typechecking, the complete E2E suite and packaged native Client verification were not rerun; their previously documented limitations remain.

### PR #1849 review and CI repair (2026-10-18)

The remaining auth failures came from awaiting draft storage in several renderer entry points without a bounded completion path. `Service/sessionCleanup.ts` now provides the shared five-second bound, catches synchronous throws and rejected promises, and cancels completed timers. Embedded shells and the background Communication runtime share one reload; standalone expiry, HTTP expiry reporting and manual/OIDC local logout use the same cleanup bound. Credentials are still revoked synchronously. Recovery actions reuse the existing `WKButton`.

| Finding | Disposition |
| --- | --- |
| P1: Apps/Summary revocation and HTTP expiry can wait forever | Fixed; real shell tests cover pending, rejected and synchronously thrown cleanup. |
| Unknown remote metadata can be overwritten before a local draft is durable | Fixed; defer the metadata update instead of sending an empty draft. Regression fails on the original implementation. |
| Background-only Communication revocation has no reload | Fixed; runtime tests assert reload both with and without mounted UI. |
| P1: a selected conversation necessarily survives a Space switch | Refuted for current entry points: `currentConversationStore` publishes `space`, `ChatVM.clearSpacePresentation` clears selection/openChannel and pops the active chat route. The strengthened VM regression asserts all three effects; no second scope lifecycle was introduced. |
| CI: interrupted-send recovery button query exceeds its default wait | Isolated Semi notification roots now get destroyed after each test; the recovery query is scoped to its composer. The original CI snapshot contained earlier tests' notifications. This addresses the demonstrated isolation defect without increasing timeouts; it is not evidence of a storage corruption bug. |

The attachment generations, document CAS revision, account generation and document abort signal protect different races and remain separate. This repair changes auth completion and test isolation, not the IndexedDB schema or attachment ownership protocol.

Review used the five correctness/security/performance/test/style dimensions. Raw deep-scan scores were AI faithfulness **43**, freshness **99**, coherence **6**, implementation quality **7** (overall **36**). Manual validation rejected its cross-scope duplicate-variable matches and workspace-dependency false positives; that raw score is not a reliable merge verdict. No further high-confidence blocking issue was found in the reviewed paths.

Reproducible checks:

- `pnpm --filter @octo/base test:coverage --maxWorkers=2` (same CI coverage thresholds; lower local concurrency).
- `pnpm --filter @octo/web exec vitest run src/client-feature src/client-apps src/client-summary src/client-communication src/Layout/__tests__/standaloneSessionExpiry.test.ts --maxWorkers=2`.
- `pnpm --filter @octo/web run build` and `pnpm --filter @octo/web run build:e2e`.
- `PW_PREVIEW_PORT=15184 pnpm --filter @octo/web exec playwright test --config=e2e-kit/playwright.ci.config.ts e2e-kit/tests/chat/CH-draft-recovery.spec.ts --workers=1`.
- `pnpm i18n:check` and `git diff --check`.

The original auth-expiry implementation fails two of the new regression cases (hung cleanup and synchronous throw). Full repository `tsc --noEmit` remains non-clean (3,136 diagnostics in this environment, including React JSX/types and unrelated modules); no clean typecheck is claimed. Packaged native Client validation remains outside this local run.

Validation results: 578 base suites / 6,187 tests passed with coverage (statements 75.26%, branches 68.05%, functions 71.18%, lines 76.98%). The final unknown-metadata guard was added after that complete run and verified separately with all 73 Conversation/composer suites / 921 tests passing. All 53 embedded-renderer suites / 571 tests passed with two workers; production and E2E builds and all six bilingual Chromium recovery scenarios passed. Two cold-entry suites timed out during the initial highly concurrent local run on an 8 GB host and passed when rerun with bounded concurrency. Light/dark recovery screenshots were inspected.

### PR #1852: persistent logout barrier

The five-second cleanup bound previously allowed a new renderer to read an account's old IndexedDB records when deletion stalled. Logout now writes a per-database, per-account revocation token to localStorage synchronously. The existing IndexedDB `accounts` row acknowledges that token in the same transaction that advances the generation and deletes documents, attachments and membership intents. No database version bump or separate deletion queue is needed.

Every database document/blob read and mutation checks the token against the account row. A fresh session reconciles an unacknowledged token before returning any data, including when the original renderer disappeared or deletion failed. Tokens are never removed by cleanup: an old renderer completing late cannot erase a newer barrier or delete drafts saved after another renderer already completed cleanup. Session capture pins the token before awaiting IndexedDB, so an old suspended caller cannot acquire the replacement generation.

If the synchronous token write fails, `SessionCleanupTask.requireCompletion` disables the timeout for that task. Credential revocation still happens immediately, but automatic teardown waits for real deletion; if deletion also fails, teardown remains blocked. `LoginInfo` and the background Communication runtime preserve this contract when observing errors. Other accounts retain their drafts, and legacy account rows without a token remain readable until explicitly revoked.

Regression coverage in `logoutBarrier.test.ts` reproduces the original stale-read failure, simulates a renderer restart while deletion is suspended, checks document/list/blob reads and stale writes, retries a failed deletion, protects new-session drafts from late cleanup, and covers unavailable synchronous storage. The LoginInfo and runtime tests verify that mandatory deletion cannot be accidentally converted back into a timeout-safe promise.

Validation: base coverage passed 579 suites / 6,195 tests (75.28% statements, 68.08% branches, 71.23% functions, 76.99% lines); embedded/auth tests passed 53 suites / 572 tests. The final repository cleanup ordering was checked again with all 116 storage/LoginInfo tests, a targeted TypeScript check of the changed storage/cleanup modules, production and E2E builds, and all seven Chromium draft recovery/navigation scenarios. No UI copy changed. Full-repository typechecking and packaged native Client verification retain the limitations documented above.
