/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/list/S25-summary-invite-respond.md
 *
 * S25: Summary 列表待确认邀请同意 / 拒绝.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS25SummaryInviteRespond, S25_ACCEPT_TASK_ID, S25_REJECT_TASK_ID } from "../../../msw-handlers/s25-summary-invite-respond";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S25 @p2 @summary @list @summary-list @summary-invite S25 — Summary 邀请响应", () => {
  test("列表卡片同意和拒绝待确认邀请", async ({ authedPage }) => {
    await registerS25SummaryInviteRespond(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();
    const acceptCard = authedPage.getByTestId(T.card(S25_ACCEPT_TASK_ID));
    const rejectCard = authedPage.getByTestId(T.card(S25_REJECT_TASK_ID));

    await expect(acceptCard).toBeVisible({ timeout: 15_000 });
    await expect(rejectCard).toBeVisible();
    await expect(acceptCard).toContainText("S25 同意邀请总结");
    await expect(rejectCard).toContainText("S25 拒绝邀请总结");
    await expect(acceptCard.getByTestId(T.cardAcceptBtn(S25_ACCEPT_TASK_ID))).toBeVisible();
    await expect(acceptCard.getByTestId(T.cardAcceptBtn(S25_ACCEPT_TASK_ID))).toContainText("同意");
    await expect(rejectCard.getByTestId(T.cardRejectBtn(S25_REJECT_TASK_ID))).toBeVisible();
    await expect(rejectCard.getByTestId(T.cardRejectBtn(S25_REJECT_TASK_ID))).toContainText("拒绝");

    await acceptCard.getByTestId(T.cardAcceptBtn(S25_ACCEPT_TASK_ID)).click();
    await expect(authedPage.getByText("已同意")).toBeVisible({ timeout: 15_000 });
    await expect(acceptCard.getByTestId(T.cardAcceptBtn(S25_ACCEPT_TASK_ID))).toHaveCount(0);
    await expect(acceptCard.getByTestId(T.cardRejectBtn(S25_ACCEPT_TASK_ID))).toHaveCount(0);

    await rejectCard.getByTestId(T.cardRejectBtn(S25_REJECT_TASK_ID)).click();
    await expect(authedPage.getByText("已拒绝")).toBeVisible({ timeout: 15_000 });
    await expect(rejectCard.getByTestId(T.cardAcceptBtn(S25_REJECT_TASK_ID))).toHaveCount(0);
    await expect(rejectCard.getByTestId(T.cardRejectBtn(S25_REJECT_TASK_ID))).toHaveCount(0);
    await expect(authedPage.getByText("加载失败")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
