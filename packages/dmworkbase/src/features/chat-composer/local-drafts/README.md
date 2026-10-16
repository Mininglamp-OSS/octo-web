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
- File deletion checks current liveness; undo during an in-flight deletion schedules a replacement write before restoration can proceed.
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
