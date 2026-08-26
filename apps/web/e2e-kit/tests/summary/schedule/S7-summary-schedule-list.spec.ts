/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/schedule/S7-summary-schedule-list.md
 *
 * S7: Summary 详情页定时信息展示.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS7SummaryScheduleList } from "../../../msw-handlers/s7-summary-schedule-list";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";

const sanityConfig = {
  // CI leak target plus legacy mock host marker; workflow proxy-error grep remains the fail-closed guard.
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S7 @p1 @summary @schedule @summary-detail @summary-schedule S7 — Summary 详情定时信息", () => {
  test("打开带定时配置的总结后显示定时说明", async ({ authedPage }) => {
    await registerS7SummaryScheduleList(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();

    await expect(authedPage.getByText("S7 定时项目总结")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("S7 项目群")).toBeVisible();
    await authedPage.getByText("S7 定时项目总结").click();

    await expect(
      authedPage.getByRole("heading", { name: "S7 定时项目总结", level: 2 })
    ).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText(/定时：.*每周.*周一.*09:30/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(authedPage.getByText(/下次/)).toBeVisible();
    await expect(authedPage.getByText("S7 定时信息已展示")).toBeVisible();
    await expect(authedPage.getByText("定时已关闭")).toHaveCount(0);
    await expect(authedPage.getByText("加载失败")).toHaveCount(0);
    await expect(authedPage.getByText("网络连接异常，请检查网络后重试")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
