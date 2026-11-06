# S14 name-search bridge (A → C)

A supplies `NameSearchService`, `useNameSearch`, `nameDisplayLines` and
`splitNameMatches`, exported by `@octo/base`. No page is automatically migrated.

```tsx
const search = useNameSearch({
  userId: currentUid,
  kind: "contact", // "group" uses the independent group route
  query: keyword.trim() ? {
    keyword,
    spaceId: currentSpaceId || null,
    entry: "address_book",
    contactType: selectedType,
  } : null,
});
```

Pass the full current query, not a mutable global runtime object. The identity
includes user, Space, keyword, scope, channel, type and narrowing set. Stale
responses cannot update results, errors, totals or pagination. `loadMore()`
keeps successful pages on transient load-more failure; retry uses the same cursor.
Known permission denial (name_forbidden/401/403) clears results and totals. query_changed
clears and restarts. `reload()`/`invalidate()` clear existing results immediately.

C owns composition events and 300–400 ms input debounce. On each raw input or
permission/Space/remark/type change invalidate immediately, BEFORE waiting for
the next debounced keyword; alternatively clear the query while composing.
Do not leave an old query's results labeled as the new input. Do not issue empty
queries. Preserve each entry's browsing state and valid filters on clear.

Render `nameDisplayLines(item)` in returned order. The second original-name
line's localized label belongs to the UI, not the search data. Segments are
plain text, with true original-codepoint highlights; render text as React
children, never HTML. Resolve avatars and existing identity details using
the returned ID. Do not infer human/AI from name, avatar or warmed caches.

Group-member/mention queries support scope plus group channel context. Other
selectors can send `allowedIds` from their existing current eligible roster;
undefined means all, [] means none. This narrows R1/R2 before pagination,
does not grant action permission, and does not introduce out-of-range objects.
When the roster is incomplete set `allowedIdsComplete:false`, retain the partial
state and refresh it through that operation's authority. Never pass just one
page of a selectable roster as a complete set. An unavailable roster must not
fall back to an unrestricted directory query. Threads now use `kind:"thread"` and `NameSearchService.searchThreads`, with
`scope:"forward"` (active sendable targets) or `scope:"thread_filter"` plus
group channel context. `parentId` is structural context, never an extra hit.
Summary-owned `src/source-search.ts` exports `searchSummaryMembers` and
`searchSummarySources`: these fix the correct server scope and use the common
Service. Pass the adapter as `fetch` to `useNameSearch`; keep kind and captured
query consistent. Archived selection is part of query identity and cursors.
No summary backend name matcher is needed; its existing browse API is retained.

Only complete successful zero results mean no matches. Partial total is null.
Initial/revalidation failures hide unverified results and retain query/retry;
transient load-more failures retain successful pages; known permission loss clears them. Background revalidation defaults
to 30 seconds; hide pauses it, focus resumes it. Connect domain events to
invalidate for known changes; polling is not instant remote permission updates.

Integration checklist owned by C: Contacts, global Contacts/Groups/All top 3,
build-group, group members, @, forward, sender/member/subzone filters, summary
people/conversation source selection; Web/Electron/iOS/Android separately.
Remove old self-injection, remark-overwrites-original, independent pinyin
filters, two-character thresholds and recency sorting ONLY in migrated search
paths; preserve the empty-keyword browse/action behavior. Backend deploy must
precede enabling new clients; do not silently fall back to the old search.
