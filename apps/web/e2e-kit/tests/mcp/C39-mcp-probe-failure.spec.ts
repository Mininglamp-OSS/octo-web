// @caseId C39-mcp-probe-failure
// @spec apps/web/e2e-kit/case-specs/mcp/C39-mcp-probe-failure-feedback.md

import { test, expect } from "../../fixtures-authed";
import { registerC39McpProbeFailure } from "../../msw-handlers/c39-mcp-probe-failure";

test("@C39 @p1 @mcp @mcp-probe MCP 试连失败保留向导并展示原因", async ({
  authedPage,
}) => {
  await registerC39McpProbeFailure(authedPage);
  await authedPage.waitForFunction(
    () => (globalThis as { __c39Installed?: boolean }).__c39Installed === true,
  );
  // Publishing lives on the 我的发布 (mine) connector view, not the discovery
  // page; deep-link straight to that tab via ?type=mcp so the default 技能 tab
  // never mounts (and never fires an unmocked skill fetch).
  await authedPage.goto("/mcp-market/mine?type=mcp&sid=e2etest");

  const publishEntry = authedPage.getByTestId("mine-publish-entry");
  await expect(publishEntry).toBeVisible();
  expect(
    await publishEntry.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return hit === element || element.contains(hit);
    }),
  ).toBe(true);
  await publishEntry.click();
  await authedPage.getByTestId("mine-publish-connector-manual").click();

  const dialog = authedPage.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder("例如 GitHub MCP").fill("Probe Failure MCP");
  await dialog.getByRole("button", { name: /下一步/ }).click();
  await dialog
    .getByPlaceholder("例如 https://mcp.example.com/xxx/mcp")
    .fill("https://probe-failure.example.test/mcp");

  await dialog.getByRole("button", { name: "试连 / 获取工具列表" }).click();
  await expect(authedPage.getByText("连接配置不完整，无法探测工具列表。", { exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("尚未获取工具，可点击「试连 / 获取工具列表」自动探测，或手动补充。", { exact: true })).toBeVisible();
  await expect(dialog.getByText("已获取", { exact: false })).toHaveCount(0);
});
