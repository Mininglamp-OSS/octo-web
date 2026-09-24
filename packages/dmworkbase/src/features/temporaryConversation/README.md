# Temporary conversation presentation

## Behavior list

- Search, contacts, and other external chat entries reuse the existing Recent entry.
- Recent displays at most one temporary conversation below pinned conversations; each external open replaces it.
- Conversations already pinned in the regular list retain their original position, unread indicators, timestamp, and preview. Search can still scroll to them repeatedly. Pinning a message-free virtual row keeps it visible until it joins the regular list.
- Only search-result navigation (including repeated jumps to the same conversation) scrolls the temporary row to the top of the list viewport after rendering. The request is consumed after positioning and cancelled by other navigation. Contacts, notifications, sidebar clicks, tab switches, and message updates do not request automatic scrolling.
- Search requests retain their target channel when a list refresh restores normal ordering, so pending navigation can finish on the regular row.
- Eligible existing and message-free conversations use the same temporary appearance: avatar/name without message preview, timestamp, or unread indicators. Existing rows are deduplicated without mutating conversation data. Once a virtual entry resolves to a real conversation, the regular row displays its full metadata immediately, including incoming unread messages.
- Right-click uses the existing pin, mute, and follow actions. Hiding a message-free temporary row dismisses it locally; hiding an existing row follows the existing server flow.
- Each virtual entry retains its conversation object across renders, including a child thread's saved pin state and subsequent unpin action.
- During list hydration, a virtual placeholder remains visible until its real row is available in Recent; an SDK-only match does not remove it prematurely.
- Switching away from an existing temporary conversation preserves its temporary placement; the next Recent list refresh restores its normal position. A message-free conversation remains until replaced, hidden, resolved to a real conversation, or promoted by an outgoing message. Refresh and repeated same-channel navigation release resolved virtual entries.
- Sending a persisted message belonging to the current Space in either an existing or message-free temporary conversation immediately restores its normal row appearance and ordering. This also cancels pending temporary-row scrolling. Incoming messages restore a resolved virtual row through the regular conversation list; list refreshes preserve pending search positioning. Own messages from another Space and typing signals do not promote it.
- Recent-list refreshes, browser reload, account changes, and Space changes clear applicable memory-only state.

## File map

- `presentation.ts`: single-entry lifecycle and presentation data.
- `../../Pages/Chat/index.tsx`: entry events, outgoing-message promotion, scroll request counter, account/Space reset, and dismissal wiring.
- `../../EndpointCommon.tsx` and search entry points: explicitly mark search navigation and carry its source to the Chat page.
- `../../Components/ChatConversationList/index.tsx`: passes presentation, scroll requests, and dismissal through the existing Recent entry.
- `../../Components/ConversationList/index.tsx`: row deduplication, scroll positioning after render, metadata visibility, and existing context-menu actions.
- `__tests__/presentation.test.ts` and conversation-list tests: lifecycle and interaction regressions.

## PR scope

External entries include search, contacts, notifications, and other non-sidebar navigation; only search requests automatic scrolling. This feature adds temporary presentation to the shared ConversationList. The original change also adds a missing-name fallback and hides unavailable pin/mute actions while channel info loads for ordinary rows. This regression fix restores incoming-message metadata and preserves existing pins without adding routes, APIs, or UI copy.

## Verification plan

- Run focused Vitest suites for temporary presentation, ConversationList, ChatConversationList, and ChatPage.
- Run `pnpm i18n:check`, `git diff --check`, and the web build.
- Check replacement from message-free to existing conversations, row deduplication and metadata, right-click pin/hide, and preservation of ordinary row behavior.
- Check initial and repeated search jumps, targets arriving after loading, search followed by non-search navigation, consumed requests on tab remount, and animation-frame cleanup on unmount.
- Check outgoing-message promotion for both origins, virtual-to-real incoming messages before and after refresh, unrelated channels, and message-listener cleanup on unmount.
- Cover externally opened pinned DMs, groups, and threads, plus repeated search positioning without changing their order or metadata.
- Cover own messages from another Space, refresh completion before a queued search frame, delayed regular rows, and virtual child-thread pin/unpin across rerenders.
