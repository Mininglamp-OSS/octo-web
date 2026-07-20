/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C1-loop-empty-workspace
// @spec apps/web/e2e-kit/case-specs/C1-loop-empty-workspace.md
//
// Mock 模式: MSW (Full mode) — handler 见 apps/web/e2e-kit/msw-handlers/loop-empty.ts
// 已由 apps/web/src/mocks/{browser,handlers}.ts 桥接到 apps/web/src/index.tsx 启动.
// fixture 会 wait __MSW_READY__ 就绪再交给 case, 无需 spec 内挂 page.route.
//
// 稳定性 gate: 新 case / 改过的 case 必须 10x 全绿:
//   pnpm exec playwright test --grep "@C1" --repeat-each=10 --workers=1

import { test, expect } from "../fixtures-authed";

test("@C1 loop 空 workspace 引导 — 打开 /loop 空态显示 '还没有工作区' + 创建按钮", async ({
  authedPage,
}) => {
  await authedPage.goto("/loop?sid=e2etest");

  await expect(authedPage.getByText("还没有工作区")).toBeVisible();
  await expect(authedPage.getByText("创建一个工作区开始使用回路。")).toBeVisible();
  await expect(
    authedPage.getByRole("button", { name: "创建工作区" })
  ).toBeVisible();
});
