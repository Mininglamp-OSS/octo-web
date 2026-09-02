// e2e mock handlers 聚合
// 只在 VITE_E2E_MOCK=1 时从 src/index.tsx 引入, 生产完全 tree-shake.
// 桥接层: handler 本体放在 apps/web/e2e-kit/msw-handlers/ (kit 约定的接入方目录),
// 本文件 re-export 供 apps/web/src/mocks/browser.ts 消费.
import { chatBaselineHandlers } from "../../e2e-kit/msw-handlers/chat-baseline";
import { mcpOfficialHandlers } from "../../e2e-kit/msw-handlers/mcp-official";
import { skillMarketListHandlers } from "../../e2e-kit/msw-handlers/skill-market-list";
import { expertMarketListHandlers } from "../../e2e-kit/msw-handlers/expert-market-list";
import { skillMarketSearchHandlers } from "../../e2e-kit/msw-handlers/skill-market-search";
import { expertMarketSearchHandlers } from "../../e2e-kit/msw-handlers/expert-market-search";
import { skillMarketEmptyHandlers } from "../../e2e-kit/msw-handlers/skill-market-empty";
import { expertMarketEmptyHandlers } from "../../e2e-kit/msw-handlers/expert-market-empty";
import { skillMarketPaginationHandlers } from "../../e2e-kit/msw-handlers/skill-market-pagination";
import { expertMarketTruncatedHandlers } from "../../e2e-kit/msw-handlers/expert-market-truncated";
import { skillMarketErrorHandlers } from "../../e2e-kit/msw-handlers/skill-market-error";
import { expertMarketErrorHandlers } from "../../e2e-kit/msw-handlers/expert-market-error";
import { skillMarketReviewBadgeHandlers } from "../../e2e-kit/msw-handlers/skill-market-review-badge";
import { getEnterpriseMockHandlers } from "virtual:octo-enterprise-modules";
import { http, HttpResponse } from "msw";

const quickMuteStateHandler = http.get(/\/api\/v1\/user\/notification-pause$/, () =>
  HttpResponse.json({ paused: false, paused_until: null, revision: 0, server_time: new Date().toISOString() }),
);

// Scenario-agnostic fallback for the 组织发布管理 badge probe. Every market page
// now mounts a sidebar badge that reads GET /plugins/review_requests
// (mode=space&status=pending&page_size=1) on load, so a scenario that renders
// the market shell but does not answer this endpoint (mcp-official, c40, and
// any future market scenario) leaks the probe to the Vite dev proxy — which
// the e2e gate counts as an uncovered request and fails the whole job.
//
// Registered LAST so a scenario that DOES model the queue
// (skillMarketReviewBadge) still wins: its handler matches first and this one
// only catches the fall-through. Answers an empty pending page — the badge
// renders 0, which is the correct default for a scenario not exercising review.
const reviewRequestsBadgeFallback = http.get(
  /\/(?:market\/)?api\/v1\/plugins\/review_requests(?:\?|$)/,
  ({ request }) => {
    const url = new URL(request.url);
    const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
    const pageSize = Number.parseInt(url.searchParams.get("page_size") ?? "20", 10) || 20;
    return HttpResponse.json({ data: [], pagination: { total: 0, page, page_size: pageSize } });
  },
);

export const handlers = [
  ...getEnterpriseMockHandlers(),
  ...mcpOfficialHandlers,
  // Ahead of skillMarketListHandlers: this scenario needs its own
  // /plugins + /plugin_categories answers, and MSW resolves first-match.
  // Both are scenario-gated, so neither can intercept the other's case.
  ...skillMarketReviewBadgeHandlers,
  ...skillMarketListHandlers,
  ...expertMarketListHandlers,
  ...skillMarketSearchHandlers,
  ...expertMarketSearchHandlers,
  ...skillMarketEmptyHandlers,
  ...expertMarketEmptyHandlers,
  ...skillMarketPaginationHandlers,
  ...expertMarketTruncatedHandlers,
  ...skillMarketErrorHandlers,
  ...expertMarketErrorHandlers,
  ...chatBaselineHandlers,
  quickMuteStateHandler,
  reviewRequestsBadgeFallback,
];
