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
];
