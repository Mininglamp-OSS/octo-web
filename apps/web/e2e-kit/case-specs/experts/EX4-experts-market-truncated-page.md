# EX4 Expert market search beyond page 1

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@EX4 @p1 @experts @market @pagination`

## 目标

Guard the marketplace issue #81 fix: Experts must remain searchable beyond the
first page, and scroll pagination must re-arm until every available page is
loaded. A regression would stop after page 1 or page 2 and silently hide later
records.

## 前置条件

- fixture: `fixtures-authed` (`E2E_TARGET=local`, mock IM enabled).
- Per-case MSW handler: `e2e-kit/msw-handlers/expert-market-truncated.ts`.
  - `GET /market/api/v1/plugins` exposes 212 records, filters by `q` before
    applying `page` and `page_size`, and returns the filtered total.
  - Matching names are placed at positions 66 and 112.
  - Category and tag endpoints return scoped metadata; `rare-report` belongs
    only to record 112 and is beyond the initial 50 tag suggestions.
- Run once with `zh-CN` and once with `en-US`.

## 用户操作步骤

1. Open the Experts marketplace and confirm that the first 100 of 212 cards are visible.
2. Scroll the tail sentinel into view and wait for page 2.
3. Scroll the re-armed sentinel into view again and wait for page 3.
4. Search for `数据分析报告`, clear it, then repeat the same search from page 1.
5. Open Tags, search for `rare-report`, and select it while the keyword remains active.

## 预期结果

- The list advances from 100 to 200 and then to all 212 cards.
- The tail sentinel disappears only after all 212 cards are visible.
- Searching `数据分析报告` shows both `数据分析报告专家` and `数据分析报告师`.
- Repeating the search from page 1 returns the same two server-filtered matches.
- Selecting `rare-report` narrows the list to `数据分析报告师` without clearing the keyword.
- No load-more button, load failure, or empty state appears during the flow.

## 反例

- If the observer is not re-armed after page 2, the list remains at 200 / 212
  and the second sentinel scroll times out.
- If filtering is performed only on loaded rows, the repeated keyword search
  misses the record originally placed beyond page 1.
- If tag suggestions are limited to their initial page, `rare-report` is absent
  and the option assertion times out.

## 视觉基准

No pixel baseline. Save pagination and search screenshots in both locales and
use card-count, status-text, role, and visible-name assertions for the contract.

## 摸清依据

- `packages/dmworkmcp/src/pages/ExpertMarketListPage.tsx`: pagination sentinel,
  loaded-count status, search, and tag-filter UI.
- `packages/dmworkmcp/src/bridge/useExpertCatalog.ts`: server-side filtering,
  page state, deduplication, and empty-page termination.
- `apps/web/e2e-kit/msw-handlers/expert-market-truncated.ts`: 212-record fixture,
  offset pagination, keyword filtering, categories, and tag suggestions.
- `apps/web/e2e-kit/tests/experts/EX4-experts-market-truncated-page.spec.ts`:
  bilingual three-page user flow and UI assertions.
