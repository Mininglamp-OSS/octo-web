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
