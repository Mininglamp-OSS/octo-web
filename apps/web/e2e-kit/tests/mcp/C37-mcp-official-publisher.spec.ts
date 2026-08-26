// @caseId C37-mcp-official-publisher
// @spec apps/web/e2e-kit/case-specs/mcp/C37-mcp-official-publisher.md

import { test, expect } from "../../fixtures-authed";
const REDACTED_CREATOR = "[redacted-admin]";
const API_BASE = "/market/api/v1";

test("@C37 @p1 @mcp @mcp-official official publisher renders in MCP market", async ({
  authedPage,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const networkFailures: string[] = [];
  const requests: string[] = [];
  const responses: Array<{ url: string; status: number; visibility?: string }> = [];
  authedPage.on("console", (message) => {
    if (message.type() === "error") {
      if (message.location().url.endsWith("/runtime-config.js")) return;
      consoleErrors.push(`${message.text()} (${message.location().url})`);
    }
  });
  authedPage.on("pageerror", (error) => pageErrors.push(error.message));
  authedPage.on("requestfailed", (request) => {
    if (request.url().includes(API_BASE)) {
      networkFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`);
    }
  });
  authedPage.on("request", (request) => {
    if (request.url().includes(API_BASE)) requests.push(request.url());
  });
  authedPage.on("response", (response) => {
    if (!response.url().includes(API_BASE)) return;
    void response
      .json()
      .then((body) => {
        const visibility = response.url().includes("/official-search")
          ? body?.data?.visibility
          : body?.data?.find?.((item: { visibility?: string }) => item.visibility === "system")?.visibility;
        responses.push({ url: response.url(), status: response.status(), visibility });
      })
      .catch(() => undefined);
  });
  await authedPage.addInitScript(() => {
    sessionStorage.setItem("__e2e_scenario", "mcp-official");
  });
  await authedPage.goto("/mcp-market/mcp?sid=e2etest");

  const officialCard = authedPage.getByRole("button", {
    name: /Official Search MCP/,
  });
  const normalCard = authedPage.getByRole("button", {
    name: /Community Search MCP/,
  });
  await expect(officialCard).toBeVisible();
  await expect(normalCard).toBeVisible();
  await expect(officialCard).toContainText("官方发布");
  await expect(officialCard).not.toContainText(REDACTED_CREATOR);
  await expect(normalCard).toContainText("Alice");
  await expect(officialCard).toHaveClass(/wk-mcp-card--official/);
  await expect(normalCard).not.toHaveClass(/wk-mcp-card--official/);

  await officialCard.click();
  const detailModal = authedPage.getByRole("dialog");
  await expect(detailModal).toBeVisible();
  await expect(detailModal).toContainText("Official Search MCP");
  await expect(detailModal).toContainText("官方发布");
  await expect(detailModal).not.toContainText(REDACTED_CREATOR);

  await authedPage.getByRole("button", { name: "关闭" }).click();
  await expect(detailModal).not.toBeVisible();

  await authedPage.evaluate(() => document.body.setAttribute("theme-mode", "dark"));
  await authedPage.setViewportSize({ width: 390, height: 844 });
  await expect(officialCard).toBeVisible();
  await expect(normalCard).toBeVisible();

  await expect.poll(() => requests.some((url) => url.includes(`${API_BASE}/mcps?`))).toBe(true);
  await expect.poll(() => responses.some(({ visibility }) => visibility === "system")).toBe(true);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(networkFailures).toEqual([]);

  await normalCard.click();
  await expect(detailModal).toBeVisible();
  await expect(detailModal).toContainText("Community Search MCP");
  await expect(detailModal).toContainText("Alice");
  await expect(detailModal).not.toContainText("官方发布");
  await authedPage.getByRole("button", { name: "关闭" }).click();
  await expect(detailModal).not.toBeVisible();
});
