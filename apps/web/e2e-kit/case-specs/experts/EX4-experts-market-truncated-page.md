# EX4 Expert market search beyond page 1

- Mode: authenticated real page with local MSW and mock IM.
- Priority: P1 regression, marketplace issue #81.
- Tags: `@EX4 @p1 @experts @market @pagination`.
- Scenario: `expert-market-truncated`, with 112 plugin records and matching
  names at positions 66 and 112.

The mock `/market/api/v1/plugins` filters by `q` before applying `page` and
`page_size`, returning the filtered total. Category and tag handlers supply the
scoped catalog metadata.

Run the case in Chinese and English. Initially show 100 of 112 records with a
load-more button. Loading page 2 shows all 112 and removes the button. Searching
for `数据分析报告` must return both `数据分析报告专家` and `数据分析报告师`.
Clear the search, then search again from the first 100 records to verify that
finding the second match does not depend on previously loading page 2.
Search for `rare-report` in the tag popover: this tag is beyond the initial
50 suggestions and belongs only to record 112. Selecting it must return that
record while keeping the keyword active.

Assert cards and counts and save screenshots of pagination/search in both
locales. No pixel baseline is required. The regression fails if filtering moves
back to the loaded slice or if paging never exposes records beyond page 1.
