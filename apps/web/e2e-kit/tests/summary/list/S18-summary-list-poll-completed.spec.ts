/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/list/S18-summary-list-poll-completed.md
 *
 * S18: Summary 列表生成中任务轮询到已完成并进入详情.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS18SummaryListPollCompleted } from "../../../msw-handlers/s18-summary-list-poll-completed";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S18 @p1 @summary @list @summary-list @summary-poll S18 — Summary 列表轮询完成", () => {
  test("生成中卡片通过 batch-status 轮询变为已完成", async ({ authedPage }) => {
    await registerS18SummaryListPollCompleted(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();
    await expect(authedPage.getByText("S18 轮询总结")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("AI正在分析聊天记录...")).toBeVisible();

    await expect(authedPage.getByText("已完成", { exact: true })).toBeVisible({ timeout: 8_000 });
    await authedPage.getByText("S18 轮询总结").click();

    await expect(authedPage.getByTestId(T.detailTitle)).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByTestId(T.detailTitle)).toContainText("S18 轮询总结");
    await expect(authedPage.getByText("AI 摘要")).toBeVisible();
    await expect(authedPage.getByText("S18 轮询后已完成", { exact: true })).toBeVisible();
    await expect(authedPage.getByText("加载失败")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
