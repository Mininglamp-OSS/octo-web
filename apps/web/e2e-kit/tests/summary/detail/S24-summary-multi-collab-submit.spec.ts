/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/detail/S24-summary-multi-collab-submit.md
 *
 * S24: 多人 BY_PERSON 个人报告提交.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS24SummaryMultiCollabSubmit, S24_MY_USER_ID } from "../../../msw-handlers/s24-summary-multi-collab-submit";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S24 @p2 @summary @detail @summary-detail @multi-collab S24 — 多人个人报告提交", () => {
  test("提交我的总结后成员状态和团队汇总刷新", async ({ authedPage }) => {
    await registerS24SummaryMultiCollabSubmit(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();
    await expect(authedPage.getByText("S24 多人协作总结")).toBeVisible({ timeout: 15_000 });
    await authedPage.getByText("S24 多人协作总结").click();

    await expect(authedPage.getByTestId(T.detailTitle)).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByTestId(T.detailTitle)).toContainText("S24 多人协作总结");
    await expect(authedPage.getByText("你的个人总结已生成，提交后才会汇入团队总结。")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("我（待提交）")).toBeVisible();
    await expect(authedPage.getByText("S24 我的个人报告内容")).toBeVisible();

    await expect(authedPage.getByTestId(T.detailMyPendingRow).getByTestId(T.detailSubmitMyBtn)).toContainText("提交我的总结");
    await authedPage.getByTestId(T.detailMyPendingRow).getByTestId(T.detailSubmitMyBtn).click();

    await expect(authedPage.getByText("已提交", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByTestId(T.detailMemberRow(S24_MY_USER_ID)).getByText("已提交", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("S24 团队汇总已刷新", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("我（待提交）")).toHaveCount(0);
    await expect(authedPage.getByText("加载失败")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
