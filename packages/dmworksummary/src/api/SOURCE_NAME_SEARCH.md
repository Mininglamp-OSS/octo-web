# S14 A source-name adapters

Import `searchSummaryMembers`, `searchSummarySources` from
`@dmwork/summary/src/source-search`. Inputs capture Space and channel explicitly;
no mutable WKApp state is read by this adapter. Name-search data comes from
server-owned summary scopes in `/v1/search/{contacts,groups,threads}`. Existing
`summaryApi.get*Candidates` endpoints retain their browsing contract.

- Member search requires current Space, human-only; optional group/thread context
  resolves and authorizes the parent group, including its external human members.
- Source search takes a kind: contact (direct chat), group, or thread. Each kind
  has independent paging and name ordering. Do not combine categories by score.
- Thread source search accepts includeArchived; other kinds ignore that filter.
  The server requires messages and the summary's current-Space source boundary.
- Names, personal remarks and codepoint highlight ranges are preserved. Identity
  placeholders do not become searchable names. Thread parent identity is context;
  matching a parent's name never makes its child a hit.
- To limit to followed/recent/role subsets, supply a complete current allowedIds
  set from the existing selector authority. This only narrows server eligibility.
  An incomplete roster must set allowedIdsComplete=false. Failures never fall
  back to an unrestricted directory or cached successful zero count.

C connects these functions to the picker and `useNameSearch`, manages IME and
300–400ms debounce, invalidates immediately on conditions or permissions changing,
and renders `nameDisplayLines` in returned order. Empty input restores browsing.
Existing summary task creation/report permissions still apply when confirming.
