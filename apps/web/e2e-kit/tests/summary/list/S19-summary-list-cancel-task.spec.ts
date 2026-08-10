/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/list/S19-summary-list-cancel-task.md
 *
 * S19: Summary 列表生成中任务取消.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS19SummaryListCancelTask, S19_TASK_ID } from "../../../msw-handlers/s19-summary-list-cancel-task";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S19 @p1 @summary @list @summary-list @summary-cancel S19 — Summary 列表取消任务", () => {
  test("生成中卡片可取消并刷新为已取消", async ({ authedPage }) => {
    await registerS19SummaryListCancelTask(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();
    await expect(authedPage.getByText("S19 可取消总结")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("AI正在分析聊天记录...")).toBeVisible();

    const card = authedPage.getByTestId(T.card(S19_TASK_ID));
    await card.getByTestId(T.cardMenu(S19_TASK_ID)).click();
    await authedPage.getByRole("menuitem", { name: "取消任务" }).click();

    await expect(authedPage.getByText("已取消总结任务")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("S19 可取消总结")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("已取消", { exact: true })).toBeVisible();
    await expect(authedPage.getByText("AI正在分析聊天记录...")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
