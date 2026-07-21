// e2e mock handlers 聚合
// 只在 VITE_E2E_MOCK=1 时从 src/index.tsx 引入, 生产完全 tree-shake.
// 桥接层: handler 本体放在 apps/web/e2e-kit/msw-handlers/ (kit 约定的接入方目录),
// 本文件 re-export 供 apps/web/src/mocks/browser.ts 消费.
import { loopEmptyHandlers } from "../../e2e-kit/msw-handlers/loop-empty";

export const handlers = [...loopEmptyHandlers];
