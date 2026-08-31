import { test, expect } from "../../fixtures-authed";
import { registerC38McpListRetry } from "../../msw-handlers/c38-mcp-list-retry";

test("@C38 @p1 @mcp @mcp-retry MCP 列表加载失败后可重试", async ({ authedPage }) => {
  await registerC38McpListRetry(authedPage);
  await authedPage.goto("/mcp-market/mcp?sid=e2etest");
  await expect(authedPage.getByRole("alert")).toContainText("加载连接器失败");
  await authedPage.evaluate(() => { (globalThis as { __c38RetryRequested?: boolean }).__c38RetryRequested = true; });
  await authedPage.getByRole("button", { name: "重试", exact: true }).click();
  await expect(authedPage.getByText("Retryable Search MCP", { exact: true })).toBeVisible();
  await expect(authedPage.getByRole("alert")).toHaveCount(0);
});
