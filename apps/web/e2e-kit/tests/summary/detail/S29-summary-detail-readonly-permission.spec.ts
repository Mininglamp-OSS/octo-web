/* eslint-disable no-undef -- e2e code runs in Node */
/** spec: e2e-kit/case-specs/summary/detail/S29-summary-detail-readonly-permission.md */
import { test, expect } from "../../../fixtures-authed";
import { registerS29SummaryDetailReadonlyPermission } from "../../../msw-handlers/s29-summary-detail-readonly-permission";
import { T } from "../_testids";

test("@S29 @p1 @summary @detail @summary-permission @readonly Summary 只读成员不能编辑团队总结", async ({ authedPage }) => {
  await registerS29SummaryDetailReadonlyPermission(authedPage);
  await authedPage.getByRole("button", { name: "智能总结" }).click();
  await expect(authedPage.getByText("S29 只读总结", { exact: true })).toBeVisible({ timeout: 15_000 });
  await authedPage.getByText("S29 只读总结", { exact: true }).click();

  await expect(authedPage.getByTestId(T.detailTitle)).toContainText("S29 只读总结", { timeout: 15_000 });
  await expect(authedPage.getByText("S29 只读正文内容", { exact: true })).toBeVisible();
  await expect(authedPage.getByTestId(T.detailEditBtn)).toHaveCount(0);
  await expect(authedPage.getByTestId(T.editorTextarea)).toHaveCount(0);
});
