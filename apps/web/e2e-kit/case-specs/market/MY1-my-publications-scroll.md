# MY1 My publications scrolling

- Mode: authenticated real page, local MSW records, mock IM.
- Priority: P1 regression for octo-marketplace#85.
- Tags: `@MY1 @market`.
- Fixture: `registerMyPublicationsScroll` supplies 16 personal assets through
  the unified plugin list/category/tag endpoints, with no DOM size overrides.

For skills, connectors, experts and squads, open My publications at 1280×720
and 900×520. Move the pointer over real rows and send vertical wheel input.
The page scrollTop must increase. Continue to the bottom, scroll horizontally
where columns overflow, and confirm the last row's delete button is in the
viewport and its full row spans the table's scroll width. Open the delete
confirmation and cancel it without deleting data. Small negative wheel deltas
must move the list up; a large negative delta must return to the top.

Before the fix, the skills case fails because flex shrink plus overflow:hidden
clips the table and leaves the outer scrollTop at zero. Programmatic
scrollIntoView must not replace wheel input in this regression.

Save screenshots of each type/viewport. Before commit, run the case three times
with `--repeat-each=3 --workers=1` under the repository's stability gate.
