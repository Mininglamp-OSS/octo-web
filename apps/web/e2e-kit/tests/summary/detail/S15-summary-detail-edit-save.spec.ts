/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/detail/S15-summary-detail-edit-save.md
 *
 * S15: Summary 详情编辑取消 / 保存.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS15SummaryDetailEditSave } from "../../../msw-handlers/s15-summary-detail-edit-save";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S15 @p1 @summary @detail @summary-detail @summary-edit S15 — Summary 详情编辑保存", () => {
  test("失败的 Agent 总结用本人报告权限编辑，元信息不重复", async ({ authedPage }) => {
    await registerS15SummaryDetailEditSave(authedPage, 0, true);
    const ctx = startRequestMonitor(authedPage, sanityConfig);
    await authedPage.getByRole("button", { name: "智能总结" }).click();
    await expect(authedPage.getByTestId(T.card(15015))).toBeVisible();
    await authedPage.getByTestId(T.card(15015)).click();
    await expect(authedPage.getByText("S15 原始正文内容")).toBeVisible();
    await expect(authedPage.locator(".summary-detail-personal .summary-detail-meta-time")).toHaveCount(1);
    await authedPage.locator(".summary-detail-personal").getByRole("button", { name: /编辑$/ }).click();
    await authedPage.getByTestId(T.editorTextarea).fill("S15 失败后编辑成功");
    await authedPage.getByTestId(T.editorSaveBtn).click();
    await expect(authedPage.getByText("S15 失败后编辑成功", { exact: true })).toBeVisible();
    expect(await authedPage.evaluate(() =>
      (window as unknown as { __s15State__: { editCalls: number } }).__s15State__.editCalls
    )).toBe(1);
    await sanityCheck(authedPage, ctx);
  });

  for (const action of ["编辑", "重新生成"] as const) {
    test(`列表${action}等待慢详情加载，保留正文或默认提示词`, async ({ authedPage }) => {
      await registerS15SummaryDetailEditSave(authedPage, 1000);
      const ctx = startRequestMonitor(authedPage, sanityConfig);
      await authedPage.getByRole("button", { name: "智能总结" }).click();
      await expect(authedPage.getByTestId(T.card(15015))).toBeVisible();
      await authedPage.getByTestId(T.cardMenu(15015)).click();
      await authedPage.getByText(action, { exact: true }).click();
      if (action === "编辑") {
        await expect(authedPage.getByTestId(T.editorTextarea)).toBeVisible();
        await expect(authedPage.getByTestId(T.editorTextarea)).toContainText("S15 原始正文内容");
      } else {
        await expect(authedPage.getByTestId(T.regenerateModal)).toBeVisible();
        await authedPage.getByText("全部重新生成", { exact: true }).click();
        await expect(authedPage.locator('input[name="summary-regenerate-mode"][value="full"]')).toBeChecked();
        await expect(authedPage.getByTestId(T.regenerateInput)).toHaveValue("S15 可编辑总结");
      }
      await sanityCheck(authedPage, ctx);
    });
  }

  test("编辑取消不保存，再编辑保存后正文更新", async ({ authedPage }) => {
    await registerS15SummaryDetailEditSave(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();
    await expect(authedPage.getByText("S15 可编辑总结")).toBeVisible({ timeout: 15_000 });
    await authedPage.getByText("S15 可编辑总结").click();

    await expect(authedPage.getByTestId(T.detailTitle)).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByTestId(T.detailTitle)).toContainText("S15 可编辑总结");
    await expect(authedPage.getByText("S15 原始正文内容")).toBeVisible();

    await authedPage.getByTestId(T.detailEditBtn).click();
    const editor = authedPage.getByTestId(T.editorTextarea);
    await expect(editor).toBeVisible();
    await expect(editor).toHaveAttribute("placeholder", "编辑总结内容...");
    await editor.fill("## S15 可编辑总结\n\n- S15 草稿取消内容\n");
    await authedPage.getByTestId(T.editorCancelBtn).click();

    await expect(authedPage.getByText("S15 原始正文内容")).toBeVisible();
    await expect(authedPage.getByText("S15 草稿取消内容")).toHaveCount(0);

    await authedPage.getByTestId(T.detailEditBtn).click();
    await expect(editor).toBeVisible();
    await editor.fill("## S15 可编辑总结\n\n- S15 已保存正文内容\n");
    await authedPage.getByTestId(T.editorSaveBtn).click();

    await expect(authedPage.getByText("保存成功", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("S15 已保存正文内容")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("S15 草稿取消内容")).toHaveCount(0);
    await expect(authedPage.getByText("加载失败")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
