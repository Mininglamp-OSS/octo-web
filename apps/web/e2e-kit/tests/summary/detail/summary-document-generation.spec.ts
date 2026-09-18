import { test, expect } from "../../../fixtures-authed";
import { waitForMswReady } from "../../../_lib/e2eReady";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { registerDocumentGeneration } from "../../../msw-handlers/summary-document-generation";
import { T } from "../_testids";

for (const locale of ["zh-CN", "en-US"] as const) {
  for (const scenario of ["manual", "legacy", "ready"] as const) {
    test(`@p1 @summary document ${scenario} generation state (${locale})`, async ({ authedPage }, testInfo) => {
      // Query locale takes precedence over the shared fixture's storage locale.
      await authedPage.goto(`/?sid=e2etest&lang=${locale}`);
      await waitForMswReady(authedPage);
      await registerDocumentGeneration(authedPage, {
        scheduled: scenario === "legacy",
        ready: scenario === "ready",
      });
      const ctx = startRequestMonitor(authedPage, {
        realHosts: ["127.0.0.1:9", "mock.e2e.local"],
        apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
      });
      const failedApiResponses: string[] = [];
      authedPage.on("response", response => {
        if (new URL(response.url()).pathname.startsWith("/summary/api/") && response.status() >= 400) {
          failedApiResponses.push(`${response.status()} ${response.url()}`);
        }
      });
      await authedPage.getByRole("button", { name: locale === "zh-CN" ? "智能总结" : "AI Summary", exact: true }).click();
      await authedPage.getByTestId(T.card(30168)).click();
      await expect(authedPage.getByTestId(T.detailTitle)).toContainText("Document generation regression");
      const processing = authedPage.locator(".summary-detail-processing");
      if (scenario === "ready") {
        await expect(authedPage.getByText("Document result is ready.", { exact: true })).toBeVisible();
        await expect(processing).toHaveCount(0);
      } else {
        await expect(processing).toHaveCount(1);
        await expect(processing).toContainText(locale === "zh-CN" ? "正在生成总结..." : "Generating summary...");
      }
      const legacyText = locale === "zh-CN"
        ? "文档总结不支持定时更新，已有定时仅可关闭"
        : "Document summaries cannot run on a schedule. Existing schedules can only be turned off.";
      if (scenario === "legacy") {
        await expect(authedPage.locator(".summary-detail-content-inner").getByText(legacyText, { exact: true })).toBeVisible();
      } else {
        await expect(authedPage.getByText(legacyText, { exact: true })).toHaveCount(0);
      }
      await expect(authedPage.getByText(locale === "zh-CN" ? "文档总结暂不支持设置定时更新" : "Document summaries do not support scheduled updates yet.", { exact: true })).toHaveCount(0);
      await expect(authedPage.getByRole("button", { name: locale === "zh-CN" ? "确认参与" : "Confirm participation", exact: true })).toHaveCount(0);
      await expect(authedPage.getByRole("button", { name: locale === "zh-CN" ? "查看确认状态" : "View confirmation status", exact: true })).toHaveCount(0);
      await sanityCheck(authedPage, ctx);
      expect(failedApiResponses).toEqual([]);
      await authedPage.screenshot({ path: testInfo.outputPath("document-generation.png"), fullPage: true });
      await authedPage.evaluate(() => document.body.setAttribute("theme-mode", "dark"));
      await authedPage.screenshot({ path: testInfo.outputPath("document-generation-dark.png"), fullPage: true });
    });
  }
}
