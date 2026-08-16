/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/agent/S11-summary-agent-continue-refine.md
 *
 * S11: Agent 总结详情页继续优化 → 自动引用原总结.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS11SummaryAgentContinueRefine } from "../../../msw-handlers/s11-summary-agent-continue-refine";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S11 @p0 @summary @agent @summary-agent @summary-detail @summary-reference S11 — Agent 详情继续优化", () => {
  test("从 Agent 总结详情进入继续优化并自动引用原总结", async ({ authedPage }) => {
    await registerS11SummaryAgentContinueRefine(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();
    await expect(authedPage.getByText("S11 Agent 原总结")).toBeVisible({ timeout: 15_000 });
    await authedPage.getByText("S11 Agent 原总结").click();

    await expect(authedPage.getByTestId(T.detailTitle)).toBeVisible({
      timeout: 15_000,
    });
    await expect(authedPage.getByTestId(T.detailTitle)).toContainText("S11 Agent 原总结");
    await expect(authedPage.getByTestId(T.detailContinueRefineBtn)).toBeVisible();
    await expect(authedPage.getByTestId(T.detailContinueRefineBtn)).toContainText("继续优化");
    await authedPage.getByTestId(T.detailContinueRefineBtn).click();

    await expect(
      authedPage.getByText("你好，我是总结助手，想总结什么尽管告诉我。")
    ).toBeVisible({ timeout: 15_000 });
    // dropdown 反映当前模式（agent active）。
    await authedPage.getByTestId(T.createModeSwitch).click();
    await expect(authedPage.getByTestId(T.createAgentTab)).toHaveClass(/active/);
    // Agent → Normal 往返：切回后 topic 输入框重新挂载可见（P2-1/P2-2 覆盖）。
    await authedPage.getByTestId(T.createNormalTab).click();
    await expect(authedPage.getByTestId(T.createTopic)).toBeVisible();
    // 再切回 Agent 继续引用卡片断言。
    await authedPage.getByTestId(T.createModeSwitch).click();
    await authedPage.getByTestId(T.createAgentTab).click();
    await expect(authedPage.getByTestId(T.agentInput)).toBeVisible();
    const referenceCard = authedPage.getByTestId(T.agentRefCard);
    await expect(referenceCard.getByText("已引用")).toBeVisible();
    await expect(referenceCard.getByText("S11 Agent 原总结", { exact: true })).toBeVisible();

    await referenceCard.click();
    await expect(
      authedPage.getByTestId(T.agentRefSidePanel).getByTestId(T.agentRefSideTitle)
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      authedPage.getByTestId(T.agentRefSidePanel).getByTestId(T.agentRefSideTitle)
    ).toContainText("S11 Agent 原总结");
    await expect(
      authedPage.getByTestId(T.agentRefSideBody).getByText("S11 原总结风险清单")
    ).toBeVisible();
    await expect(authedPage.getByText("加载失败")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
