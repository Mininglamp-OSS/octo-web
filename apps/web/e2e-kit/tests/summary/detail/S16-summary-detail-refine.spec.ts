/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/detail/S16-summary-detail-refine.md
 *
 * S16: Summary 详情按意见调整.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS16SummaryDetailRefine } from "../../../msw-handlers/s16-summary-detail-refine";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S16 @p0 @summary @detail @summary-refine S16 — 继续优化保存", () => {
  for (const conflict of [false, true]) {
    test(
      conflict
        ? "版本冲突保留预览并允许另存"
        : "继续优化保存新版本更新共享正文",
      async ({ authedPage }) => {
        await registerS16SummaryDetailRefine(authedPage, conflict);
        const ctx = startRequestMonitor(authedPage, sanityConfig);
        await authedPage.getByRole("button", { name: "智能总结" }).click();
        await authedPage.getByText("S16 可调整总结", { exact: true }).click();
        await expect(authedPage.getByTestId(T.detailRegenerateBtn)).toHaveCount(
          0
        );
        await authedPage.getByTestId(T.detailContinueRefineBtn).click();
        const workbench = authedPage.getByTestId("summary-workbench");
        await expect(workbench).toBeVisible();
        await workbench.locator("textarea").fill("S16 请补充风险说明");
        await workbench
          .getByRole("button", { name: "发送", exact: true })
          .click();
        await expect(
          workbench.getByText("S16 已按意见调整正文", { exact: true })
        ).toBeVisible();
        await expect(
          workbench.getByRole("button", { name: "保存为新总结", exact: true })
        ).toBeVisible();
        const saveResponse = authedPage.waitForResponse(
          (response) =>
            response.url().endsWith("/summaries/agent") &&
            response.request().method() === "POST"
        );
        await workbench
          .getByRole("button", { name: "保存新版本", exact: true })
          .click();
        expect((await saveResponse).status()).toBe(conflict ? 409 : 200);
        if (conflict) {
          await expect(
            workbench.getByRole("button", { name: "保存新版本", exact: true })
          ).toBeEnabled();
          await expect(
            workbench.getByText("S16 已按意见调整正文", { exact: true })
          ).toBeVisible();
          await workbench
            .getByRole("button", { name: "保存为新总结", exact: true })
            .click();
          const dialog = authedPage.getByRole("dialog");
          await dialog.getByRole("textbox").fill("S16 独立副本");
          await dialog
            .getByRole("button", { name: "confirm", exact: true })
            .click();
          await expect(authedPage.getByTestId(T.detailTitle)).toContainText(
            "S16 独立副本"
          );
        } else {
          await expect(authedPage.getByTestId(T.detailTitle)).toContainText(
            "S16 可调整总结"
          );
          await expect(
            authedPage.getByText("S16 已按意见调整正文", { exact: true })
          ).toBeVisible();
        }
        const state = await authedPage.evaluate(
          () => (window as any).__s16State__
        );
        expect(state.targetCalls).toBe(1);
        expect(state.saves).toHaveLength(conflict ? 2 : 1);
        expect(state.saves[0].body).toMatchObject({
          save_mode: "new_version",
          target: {
            task_id: 16016,
            result_kind: "team",
            expected_revision: "s16-original-revision",
          },
          agent_message_id: 160162,
          snapshot_version: 1,
          expected_artifact_version: 1,
        });
        expect(state.saves[0].key).toBeTruthy();
        if (conflict) {
          expect(state.saves[1].body.save_mode).not.toBe("new_version");
          expect(state.saves[1].body.target).toBeUndefined();
          expect(state.saves[1].key).not.toBe(state.saves[0].key);
        }
        await sanityCheck(authedPage, ctx);
      }
    );
  }
});
