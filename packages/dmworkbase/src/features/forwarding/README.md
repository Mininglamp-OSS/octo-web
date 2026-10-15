# Forwarding Presentation

`WKBase.showConversationSelect` remains the sole compatibility entry. It still owns
completion, document grants and sends. `ConversationSelect` still owns all candidate,
search, selection and Bot hooks.

Ordinary Web renders the existing modal. The desktop communication entry may install
a `ForwardSurfacePort` before UI mount. Only then does the picker render headlessly
and publish a serializable UI model to Client's independent overlay.

`surfaceSession` accepts allowlisted UI commands against current authoritative
callbacks and candidate identities. Confirmation requires the latest revision and
a committed selection render. Closing or publishing failure cancels the owner.
There is no second IM connection, message payload construction, or credential
transfer in the standalone renderer.

Keep `surfaceContract.ts` in sync with Client's
`shared/forward-surface-contract.ts`. New wire behavior requires capability/version
review in both repositories.

## Optional forwarding comment

Message/file forwards opt in through the fifth `showConversationSelect` argument,
`{ withComment: true }`. Document forwards enable comments by default. Ordinary
conversation selectors retain their original UI and one-argument callback.
The callback receives `(channels, comment)`; the internal `ForwardFinished`
contract carries `(channels, grant, comment)` so authorization remains separate.

The existing picker owns the transient text. It stays below the selected list,
without a content preview or any changes to the full-width footer. Empty comments
are accepted. Input is unrestricted; confirmation validates JavaScript string
length against the same 5000-character constant as the chat composer, preserving
all whitespace and line breaks. Invalid confirmation keeps the picker and text
open with a localized Toast and `aria-invalid`. Reopening starts with an empty comment.

`ForwardService.send(channels, buildContent, opts)` accepts `opts.comment` and creates a separate text
message for each target after its original content succeeds. Parallel batches
keep their original concurrency and only send the comment after the batch succeeds.
With a non-empty comment, each send waits for the SDK's successful server ACK;
media upload failures/cancellation and rejected or missing ACKs prevent the comment.
Listeners are registered before enqueueing and released on completion, failure,
timeout or source invalidation. The ACK deadline is 30 seconds plus the media upload
budget (at least two minutes, or ten seconds per MiB). Local optimistic bubbles
still appear immediately on enqueueing.

Original target/message counts exclude comments. Failed comments are returned in
`commentFailures` and displayed as a separate localized warning; a delivered original
still contributes to success analytics and document `onResult.sent`. Comments retain
Space injection. Empty comments do not add a message or change the legacy enqueue-only
completion contract. A failure is isolated to its target.

The standalone surface uses optional `model.withComment` and
`{ type: "confirm", comment }`; it validates locally before dispatch and the owning
session validates again before closing. Client's external wire contract must
preserve these optional fields. Host IPC compatibility and real-server delivery
need integration verification in the Client repository; in-repository tests cover
the surface model, commands, picker callback and SDK send seam.

Validation:

```sh
pnpm --filter @octo/base test src/Components/ForwardModal src/Components/ConversationSelect src/Components/WKBase src/features/forwarding src/Service/__tests__/ForwardService
pnpm --filter @octo/web test src/client-forward-surface/ForwardSurfaceApp.test.tsx src/client-communication/forwardSurface.test.ts src/__tests__/forwardModalChatType.test.ts
pnpm i18n:check
pnpm --filter @octo/web build
```

Storybook: `Components/ForwardModal/WithComment` and `WithCommentNoSelection`.
Check both locales/themes, empty selection, multiline input, 5000 and 5001 characters,
correction after validation, and cancellation/reopening. Existing picker styling
(including its theme behavior and English tab wrapping) is preserved.
