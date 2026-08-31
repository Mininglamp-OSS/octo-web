/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/list/S28-summary-invite-respond-failure.md
 *
 * S28: Summary 邀请响应失败保留待确认状态.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS28SummaryInviteRespondFailure } from "../../../msw-handlers/s28-summary-invite-respond-failure";
import { S25_ACCEPT_TASK_ID } from "../../../msw-handlers/s25-summary-invite-respond";
import { T } from "../_testids";

test("@S28 @p1 @summary @list @summary-list @summary-invite @error-state 邀请响应失败保留操作入口", async ({ authedPage }) => {
  await registerS28SummaryInviteRespondFailure(authedPage);
  await authedPage.getByRole("button", { name: "智能总结" }).click();

  const card = authedPage.getByTestId(T.card(S25_ACCEPT_TASK_ID));
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByTestId(T.cardAcceptBtn(S25_ACCEPT_TASK_ID)).click();

  await expect(authedPage.getByText("操作失败", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(card.getByTestId(T.cardAcceptBtn(S25_ACCEPT_TASK_ID))).toBeVisible();
  await expect(card.getByTestId(T.cardRejectBtn(S25_ACCEPT_TASK_ID))).toBeVisible();
  await expect(card).toContainText("S25 同意邀请总结");
});
