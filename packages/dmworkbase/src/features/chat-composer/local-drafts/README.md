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
