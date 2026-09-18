# Document source selection

The existing Workbench and create-page selector share the Service → bridge → UI path.
Only `doc` and `html` sources are supported; the selector explicitly explains this.

## Pagination contract

- `GET docs/recent` is keyset-paginated. Pass the opaque `nextCursor` unchanged;
  null/absent means exhausted. `total` never drives continuation. A repeated cursor
  is rejected to prevent an endless load-more loop.
- `GET docs?owner=me` uses numbered pages of 50 server rows. A valid total is
  compared with `page * 50`, never with client-filtered or deduplicated row counts.
  If total is absent/invalid, a full raw page permits another request; a short or
  empty page ends that fallback. An exactly-full terminal page may need one empty
  request when total is unavailable.
- The Docs backend applies `type` before counting/paging. Client type filtering is
  defense-in-depth, not proof that the server count includes unsupported types.
  Axios 0.25 emits `type[]=doc&type[]=html`, accepted by the backend's Express 4
  extended parser; the Service test pins the installed serializer.
- Load-more errors keep the successful list, selection and page pointer. Retry
  requests the same page. Rows are deduplicated by document ID; changing the query,
  source tab or modal visibility invalidates in-flight pagination immediately.

## Legacy document schedules (PR #1688 D-1)

Document summaries remain manual-only. A migrated/historical document summary
with `schedule_id > 0` displays status and, when `can_schedule` allows it, a
disable-only action. The handler checks the current task/schedule binding, active
state, loading/editing state and permission again before sending `toggle(false)`.
There is no editing, reactivation, new scheduling, or participation confirmation
path for document summaries. Backend rejection of document-source scheduling is
an independent safeguard, not a replacement for the frontend guards.

## Verification

```bash
pnpm --filter @dmwork/summary exec vitest run \
  src/Service/DocumentSourceService.test.ts \
  src/bridge/documentSource/useDocumentSearch.test.tsx \
  src/ui/DocumentSelector/DocumentSelector.test.tsx \
  src/pages/__tests__/SummaryDetailPage.schedule.test.tsx
pnpm --filter @dmwork/summary test
pnpm i18n:check
```

DocumentSelector stories include loading, empty, long-title, load-more and
load-more-error states. Test both locales and light/dark themes. Use fixtures for
legacy schedule verification; never disable real schedules as a test.
