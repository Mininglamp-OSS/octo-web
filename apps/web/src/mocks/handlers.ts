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
import { getEnterpriseMockHandlers } from "virtual:octo-enterprise-modules";
import { http, HttpResponse } from "msw";
import { MSW_PROBE_HEADER, MSW_PROBE_PATH } from "./swControl";

// MSW 接管探针。只服务 src/mocks/swControl.ts 的 waitForMockInterception():
// 它靠这条 handler 的标记头判断「MSW 在本 document 里真的开始拦了」，而不是靠
// worker.start() 返回或 serviceWorker.controller 存在去推断（两者都不等价，
// 详见 swControl.ts 的注释）。
//
// 路径不在任何 vite proxy 前缀下，所以探针没被拦到时只会落到 SPA fallback，
// 不会污染 e2e 的 proxy-error 计数。放在列表最前面，spec 用 worker.use() 覆盖
// 业务 handler 时不会把它挡掉。
const mswProbeHandler = http.get(new RegExp(`${MSW_PROBE_PATH}$`), () =>
  new HttpResponse(null, { status: 204, headers: { [MSW_PROBE_HEADER]: "1" } }),
);

const quickMuteStateHandler = http.get(/\/api\/v1\/user\/notification-pause$/, () =>
  HttpResponse.json({ paused: false, paused_until: null, revision: 0, server_time: new Date().toISOString() }),
);

// Existing E2E scenarios exercise the Legacy summary UI unless a case-specific
// handler explicitly enables the unified workbench capability.
const summaryWorkbenchCapabilityHandler = http.get(
  "*/summary/api/v1/summary-workbench/capabilities",
  () =>
    HttpResponse.json({
      code: 0,
      message: "ok",
      data: {
        enabled: false,
        contract_version: "2",
        max_time_range_days: 31,
      },
    }),
);

export const handlers = [
  mswProbeHandler,
  ...getEnterpriseMockHandlers(),
  ...mcpOfficialHandlers,
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
  summaryWorkbenchCapabilityHandler,
  quickMuteStateHandler,
];
