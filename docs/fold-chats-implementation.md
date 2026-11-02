# Fold chats

## Behavior
Both Recent and Follow menus offer Fold chat / Unfold. Only Recent is filtered. Groups and threads are independent. Aggregate entry sorts by latest message timestamp; mentions stay folded. Preserve mute, follow, pin, draft and active chat. Aggregate unread excludes muted counts but retains a muted dot and mention indicator. Inner list preserves pins. Persist per user/space, without cross-device events. Undo folding; last unfold returns to Recent.

## File map
Backend conversation_ext: dedicated preference table, authenticated space-scoped list/set handlers, existing group/thread authorization. Frontend Service/FoldChatService, bridge/foldChats, features/foldChats, ui/FoldedChatsEntry; shared list adapters only.

## Scope
Chat folding only. No notification behavior changes, follow changes or live cross-device synchronization. The feature is deployed locally for acceptance; no shared environment was deployed.

## Verification
Backend handler authorization/validation and scoped persistence tests; frontend aggregation, Service contract, state and component interaction tests; i18n and diff checks; light/dark and Chinese/English Story coverage.

On 2026-11-02, 64 tests across six frontend suites passed and the production Vite build passed. Backend fold/follow tests and i18n checks passed. Whole-package TypeScript checking remains unsuccessful due to dependency declaration and existing source errors; it is not counted as a passing check.

Real local browser acceptance covered Recent/Follow menus, independent group/thread folding, activity ordering, mentions staying folded, muted unread aggregation, opening the inner list without marking messages read, reload persistence, pin restoration, undo, draft preservation and sending while folded. The final Nginx-served production build was checked again for folding, real incoming mentions and the inner list.

## Review fixes
Unread navigation now hands off at a list boundary and resets its cursor on scope change, retaining existing in-list ordering and mute rules. Optional scope/wrap props are added to the shared ConversationList; callers without them retain local cycling. Regression coverage includes both lists having unread, removal of the last target and a folded list becoming read. The temporary-row fixture includes its required virtualChannelKeys.

The backend distinguishes wrapped group/thread permission sentinels from infrastructure errors; query failures are logged and use the registered internal error envelope. Malformed thread IDs are rejected before authorization. Six handler scenarios verify semantic status, no writes, and no internal error disclosure.

Post-review validation: 109 frontend tests in nine suites passed, backend Fold/Follow tests passed, both builds and i18n checks passed. The updated local production deployment passed real browser cross-list navigation and read-cleared fallback checks.

## PR review: navigation intent
Manual open/back resets the unread cursor but does not start navigation. Only an explicit unread activation or cross-list continuation advances the unread token. Search scroll requests wait for fold preferences, select the matching list once per request, then scroll and acknowledge after that row renders. Neither path changes saved fold preferences.

Real ChatConversationList + ConversationList integration regressions cover manual read/muted-only collection opening, Back to an all-read Recent list, explicit unread handoffs, repeated searches in both directions, initial delayed preference loading, and manual navigation after a search has completed.

## PR review: failure fallback and unresolved mentions
Search routing uses the visible Recent fallback when fold preferences fail to load; Person conversations can be located even while those preferences are pending. Loading successful preferences is still required before routing a foldable channel to its saved destination. Fold/unfold writes remain disabled until preferences load successfully.

The aggregate mention marker follows ConversationWrap.isMentionMe independently of unread counts and mute settings, matching ordinary rows. An unresolved reminder remains visible after unread reaches zero and clears when the reminder is done.

Five regression cases reproduce the previous failures using real parent/list components and SDK conversations: group and Person searches after a rejected preference request, Person search during loading, and zero-unread unresolved reminders in muted and unmuted folded chats.
