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
  // The connector 我的 view (with manage actions) lives on /mcp-market/mine;
  // deep-link straight to the connector tab so the default 技能 tab never mounts.
  await authedPage.goto("/mcp-market/mine?type=mcp&sid=e2etest");

  // Mine assets render as a table; each row's accessible name is the connector
  // name (role="row"), and the delete action keeps its "删除 <name>" label.
  const card = authedPage.getByRole("row", {
    name: "Delete Failure MCP",
    exact: true,
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
