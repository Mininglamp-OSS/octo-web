/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/detail/S14-summary-detail-version-restore.md
 *
 * S14: Summary 详情版本记录 → 历史预览 → 恢复版本.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS14SummaryDetailVersionRestore } from "../../../msw-handlers/s14-summary-detail-version-restore";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S14 @p1 @summary @detail @summary-detail @summary-version S14 — Summary 版本记录恢复", () => {
  test("预览历史版本并恢复为当前版本", async ({ authedPage }) => {
    await registerS14SummaryDetailVersionRestore(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();
    await expect(authedPage.getByText("S14 版本总结")).toBeVisible({ timeout: 15_000 });
    await authedPage.getByText("S14 版本总结").click();

    await expect(authedPage.getByTestId(T.detailTitle)).toBeVisible({
      timeout: 15_000,
    });
    await expect(authedPage.getByTestId(T.detailTitle)).toContainText("S14 版本总结");
    await expect(authedPage.getByText("S14 当前版本内容")).toBeVisible();
    await expect(authedPage.getByTestId(T.detailVersionTrigger)).toBeVisible({
      timeout: 15_000,
    });
    await expect(authedPage.getByTestId(T.detailVersionTrigger)).toContainText("版本记录");
    await expect(authedPage.getByTestId(T.detailVersionTrigger)).toContainText("2");

    await authedPage.getByTestId(T.detailVersionTrigger).click();
    const versionPanel = authedPage.getByTestId(T.versionPanel);
    await expect(versionPanel.getByRole("heading", { name: "版本记录" })).toBeVisible();
    await expect(versionPanel.getByText("保留最近 3 个版本")).toBeVisible();
    await expect(versionPanel.getByTestId(T.versionCard(2))).toContainText("V2");
    await expect(versionPanel.getByTestId(T.versionCard(2))).toContainText("当前版本");
    await expect(versionPanel.getByTestId(T.versionCard(1))).toContainText("V1");

    await versionPanel.getByTestId(T.versionCard(1)).click();
    await expect(authedPage.getByText("正在查看 V1 历史版本")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("S14 历史版本内容")).toBeVisible();
    await expect(versionPanel.getByTestId(T.versionRestoreBtn)).toBeVisible();
    await expect(versionPanel.getByTestId(T.versionRestoreBtn)).toContainText("恢复此版本");

    await versionPanel.getByTestId(T.versionRestoreBtn).click();
    await expect(authedPage.getByText("已恢复到所选版本")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("S14 历史版本已恢复")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("S14 当前版本内容")).toHaveCount(0);
    await expect(authedPage.getByText("加载失败")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
