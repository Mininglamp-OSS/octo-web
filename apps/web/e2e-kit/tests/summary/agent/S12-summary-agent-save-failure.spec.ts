/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/agent/S12-summary-agent-save-failure.md
 *
 * S12: Agent 保存为总结失败后保留当前对话.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS12SummaryAgentSaveFailure } from "../../../msw-handlers/s12-summary-agent-save-failure";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S12 @p1 @summary @agent @summary-agent @summary-create @error-state S12 — Agent 保存失败保留对话", () => {
  test("保存为总结业务失败后不清空 Agent 对话", async ({ authedPage }) => {
    await registerS12SummaryAgentSaveFailure(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();
    await expect(authedPage.getByText("暂无总结记录")).toBeVisible({ timeout: 15_000 });

    // 总结方式选择已上移到列表页「+」下拉（创建页内不再提供切换）：直接以 Agent 总结进入。
    await authedPage.getByTestId(T.listModeSwitch).click();
    await authedPage.getByTestId(T.listAgentTab).click();
    await authedPage.getByTestId(T.agentInput).fill("S12 生成保存失败测试内容");
    await authedPage.getByTestId(T.agentSendBtn).click();

    await expect(authedPage.getByText("S12 生成保存失败测试内容")).toBeVisible();
    await expect(authedPage.getByText("S12 Agent 已生成可保存内容")).toBeVisible({ timeout: 15_000 });

    await authedPage.getByTestId(T.agentSaveBtn).click();
    const saveDialog = authedPage.getByTestId(T.agentSaveDialog);
    await expect(saveDialog).toBeVisible();
    await expect(saveDialog.getByRole("heading", { name: "保存为总结" })).toBeVisible();
    await expect(authedPage.getByTestId(T.agentSaveTitleInput)).toHaveAttribute(
      "placeholder",
      "为这份总结起个标题"
    );
    await authedPage.getByTestId(T.agentSaveTitleInput).fill("S12 保存失败总结");
    await authedPage.getByTestId(T.agentSaveConfirmBtn).click();

    await expect(
      authedPage.getByText("当前对话还没有可保存的总结，请先与 AI 对话产出内容")
    ).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByText("S12 生成保存失败测试内容")).toBeVisible();
    await expect(authedPage.getByText("S12 Agent 已生成可保存内容")).toBeVisible();
    await expect(authedPage.getByTestId(T.detailTitle)).toHaveCount(0);
    await expect(authedPage.getByText("AI 总结已保存")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
