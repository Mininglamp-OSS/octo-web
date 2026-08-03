/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId C37-mcp-official-publisher

import { test, expect } from "../fixtures-authed";
import type { Page, TestInfo } from "@playwright/test";

const API_BASE = "/market/api/v1";
const REDACTED_CREATOR = "[redacted-admin]";

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(name);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test("@C37 @mcp @integration official publisher renders from application API fixture", async ({
  authedPage,
}, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const networkFailures: string[] = [];
  const requests: Array<{ method: string; url: string }> = [];
  const responses: Array<{ url: string; status: number; visibility?: string }> =
    [];
  authedPage.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  authedPage.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  authedPage.on("requestfailed", (request) => {
    if (request.url().includes(API_BASE)) {
      networkFailures.push(
        `${request.method()} ${request.url()} ${
          request.failure()?.errorText ?? ""
        }`
      );
    }
  });
  authedPage.on("request", (request) => {
    if (request.url().includes(API_BASE)) {
      requests.push({ method: request.method(), url: request.url() });
    }
  });
  authedPage.on("response", async (response) => {
    if (!response.url().includes(API_BASE)) return;
    const body = await response.json().catch(() => null);
    const visibility = response.url().includes("/mcps/official-search")
      ? body?.data?.visibility
      : body?.data?.find?.(
          (item: { visibility?: string }) => item.visibility === "system"
        )?.visibility;
    responses.push({
      url: response.url(),
      status: response.status(),
      visibility,
    });
  });

  await authedPage.addInitScript(() => {
    sessionStorage.setItem("__e2e_scenario", "mcp-official");
  });
  await authedPage.goto("/mcp-market/mcp?sid=e2etest");

  const officialCard = authedPage.locator(".wk-mcp-card", {
    hasText: "Official Search MCP",
  });
  const normalCard = authedPage.locator(".wk-mcp-card", {
    hasText: "Community Search MCP",
  });
  await expect(officialCard).toBeVisible();
  await expect(normalCard).toBeVisible();
  await expect(officialCard).toContainText("官方发布");
  await expect(officialCard).not.toContainText(REDACTED_CREATOR);
  await expect(normalCard).toContainText("Alice");
  await expect(officialCard).toHaveClass(/wk-mcp-card--official/);
  await expect(normalCard).not.toHaveClass(/wk-mcp-card--official/);
  await screenshot(authedPage, testInfo, "mcp-list-light-full.png");

  await officialCard.click();
  const detailModal = authedPage.getByRole("dialog");
  await expect(detailModal).toBeVisible();
  await expect(detailModal).toContainText("Official Search MCP");
  await expect(detailModal).toContainText("官方发布");
  await expect(detailModal).not.toContainText(REDACTED_CREATOR);
  await screenshot(authedPage, testInfo, "mcp-detail-light-full.png");

  await authedPage
    .getByRole("button", { name: "关闭" })
    .click()
    .catch(async () => {
      await authedPage.keyboard.press("Escape");
    });
  await expect(detailModal).not.toBeVisible();

  await normalCard.click();
  await expect(detailModal).toBeVisible();
  await expect(detailModal).toContainText("Community Search MCP");
  await expect(detailModal).toContainText("Alice");
  await expect(detailModal).not.toContainText("官方发布");
  await screenshot(authedPage, testInfo, "mcp-normal-detail-light-full.png");
  await authedPage.getByRole("button", { name: "关闭" }).click();
  await expect(detailModal).not.toBeVisible();

  await authedPage.evaluate(() =>
    document.body.setAttribute("theme-mode", "dark")
  );
  await screenshot(authedPage, testInfo, "mcp-list-dark-full.png");

  await authedPage.setViewportSize({ width: 390, height: 844 });
  await expect(officialCard).toBeVisible();
  await expect(normalCard).toBeVisible();
  await screenshot(authedPage, testInfo, "mcp-list-mobile-dark-full.png");

  expect(requests.some(({ url }) => url.includes(`${API_BASE}/mcps?`))).toBe(
    true
  );
  expect(
    requests.some(({ url }) => url.endsWith(`${API_BASE}/mcps/official-search`))
  ).toBe(true);
  expect(responses.some(({ visibility }) => visibility === "system")).toBe(
    true
  );
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(networkFailures).toEqual([]);

  await testInfo.attach("mcp-api-evidence.json", {
    body: Buffer.from(
      JSON.stringify(
        {
          fixtureType: "application-level API fixture",
          sensitiveFields: "creator_name redacted",
          environment: {
            browser: "Playwright Chromium",
            viewportDesktop: "default Desktop Chrome",
            viewportMobile: "390x844",
            locale: "zh-CN",
            themeModes: ["light", "dark"],
          },
          application: {
            startCommand: "pnpm dev",
            url: "http://localhost:3000/mcp-market/mcp?sid=e2etest",
            listRoute: "/mcp-market/mcp",
            detailRoute: "modal from /mcp-market/mcp via MCP card click",
          },
          runtimeSummary: {
            consoleErrors,
            pageErrors,
            networkFailures,
          },
          requests,
          responses,
        },
        null,
        2
      )
    ),
    contentType: "application/json",
  });
});
