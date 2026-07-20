/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C1-loop-empty-workspace
// @spec apps/web/e2e-kit/case-specs/C1-loop-empty-workspace.md
//
// 稳定性 gate: 新 case / 改过的 case 必须 10x 全绿:
//   pnpm exec playwright test --grep "@C1" --repeat-each=10 --workers=1

import { test, expect } from "../fixtures-authed";

test("@C1 loop 空 workspace 引导 — 打开 /loop 空态显示 '还没有工作区' + 创建按钮", async ({
  authedPage,
}) => {
  // 1. mock 后端: dmloop remote flag on + workspaces 空列表
  await authedPage.route("**/common/appconfig", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        dmloop_on: "1",
        docs_on: "0",
        dmpersonal_on: "0",
        thread_on: false,
        oidc_providers: [],
      }),
    })
  );
  await authedPage.route("**/fleet/api/v1/workspaces", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    })
  );
  // 兜底: 其他 fleet API 一律返回空 (未来展开 case 时按需覆盖)
  await authedPage.route("**/fleet/api/v1/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    })
  );

  // 2. 走到 /loop 页面
  await authedPage.goto("/loop?sid=e2etest");

  // 3. UI 断言: 空态文案 + 创建按钮 (v1.22 铁律: 只断 UI)
  await expect(authedPage.getByText("还没有工作区")).toBeVisible();
  await expect(authedPage.getByText("创建一个工作区开始使用回路。")).toBeVisible();
  await expect(
    authedPage.getByRole("button", { name: "创建工作区" })
  ).toBeVisible();
});
