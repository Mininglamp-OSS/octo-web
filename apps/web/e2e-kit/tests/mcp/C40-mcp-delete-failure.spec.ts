// @caseId C40-mcp-delete-failure
// @spec apps/web/e2e-kit/case-specs/mcp/C40-mcp-delete-failure.md

import { test, expect } from "../../fixtures-authed";
import { registerC40McpDeleteFailure } from "../../msw-handlers/c40-mcp-delete-failure";

test("@C40 @p1 @mcp @mcp-delete MCP 删除失败保留确认弹窗和条目", async ({
  authedPage,
}) => {
  await registerC40McpDeleteFailure(authedPage);
  await authedPage.waitForFunction(
    () => (globalThis as { __c40Installed?: boolean }).__c40Installed === true,
  );
  await authedPage.goto("/mcp-market/mcp?sid=e2etest");
  await authedPage.getByRole("button", { name: "我的", exact: true }).click();

  const card = authedPage.getByRole("button", {
    name: /^🧪 Delete Failure MCP E2E/,
  });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "删除 Delete Failure MCP", exact: true }).click();

  const dialog = authedPage.getByRole("dialog");
  await expect(dialog).toContainText("删除该连接器？");
  await dialog.getByRole("button", { name: "删除", exact: true }).click();

  await expect(dialog).toContainText("删除失败");
  await expect(dialog).toBeVisible();
  await expect(card).toBeVisible();
  await expect(authedPage.getByText("已删除", { exact: true })).toHaveCount(0);
});
