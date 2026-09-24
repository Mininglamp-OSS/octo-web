# Temporary conversation presentation

## Behavior list

- Search, contacts, and other external chat entries reuse the existing Recent entry.
- Recent displays at most one temporary conversation below pinned conversations; each external open replaces it.
- Only search-result navigation (including repeated jumps to the same conversation) scrolls the temporary row to the top of the list viewport after rendering. The request is consumed after positioning and cancelled by other navigation. Contacts, notifications, sidebar clicks, tab switches, and message updates do not request automatic scrolling.
- Search requests retain their target channel when a list refresh restores normal ordering, so pending navigation can finish on the regular row.
- Existing and message-free conversations use the same temporary appearance: avatar/name without message preview, timestamp, or unread indicators. Existing rows are deduplicated without mutating conversation data.
- Right-click uses the existing pin, mute, and follow actions. Hiding a message-free temporary row dismisses it locally; hiding an existing row follows the existing server flow.
- Each virtual entry retains its conversation object across renders, including a child thread's saved pin state and subsequent unpin action.
- Switching away from an existing temporary conversation preserves its temporary placement; the next Recent list refresh restores its normal position. A message-free conversation remains until replaced, hidden, or promoted by an outgoing message.
- Sending a persisted message belonging to the current Space in either an existing or message-free temporary conversation immediately restores its normal row appearance and ordering. Incoming messages, own messages from another Space, typing signals, and conversation metadata updates do not promote it. Promotion also cancels pending temporary-row scrolling.
- Recent-list refreshes, browser reload, account changes, and Space changes clear applicable memory-only state.

## File map

- `presentation.ts`: single-entry lifecycle and presentation data.
- `../../Pages/Chat/index.tsx`: entry events, outgoing-message promotion, scroll request counter, account/Space reset, and dismissal wiring.
- `../../EndpointCommon.tsx` and search entry points: explicitly mark search navigation and carry its source to the Chat page.
- `../../Components/ChatConversationList/index.tsx`: passes presentation, scroll requests, and dismissal through the existing Recent entry.
- `../../Components/ConversationList/index.tsx`: row deduplication, scroll positioning after render, metadata visibility, and existing context-menu actions.
- `__tests__/presentation.test.ts` and conversation-list tests: lifecycle and interaction regressions.

## PR scope

Extend the existing uncommitted temporary-conversation feature. Shared ConversationList behavior changes only when temporary presentation is provided. No new route, API, or UI copy is introduced; regular Recent and Follow rows keep their existing behavior.

## Verification plan

- Run focused Vitest suites for temporary presentation, ConversationList, ChatConversationList, and ChatPage.
- Run `pnpm i18n:check`, `git diff --check`, and the web build.
- Check replacement from message-free to existing conversations, row deduplication and metadata, right-click pin/hide, and preservation of ordinary row behavior.
- Check initial and repeated search jumps, targets arriving after loading, search followed by non-search navigation, consumed requests on tab remount, and animation-frame cleanup on unmount.
- Check outgoing-message promotion for both origins, incoming-message and metadata-update preservation, unrelated channels, and message-listener cleanup on unmount.
- Cover own messages from another Space, refresh completion before a queued search frame, delayed regular rows, and virtual child-thread pin/unpin across rerenders.
