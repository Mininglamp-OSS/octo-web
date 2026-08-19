/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/agent/S10-summary-agent-reference-side-panel.md
 *
 * S10: Summary Agent 总结引用已有总结并打开右侧对照面板.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS10SummaryAgentReferenceSidePanel } from "../../../msw-handlers/s10-summary-agent-reference-side-panel";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  // CI leak target plus legacy mock host marker; workflow proxy-error grep remains the fail-closed guard.
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S10 @p1 @summary @agent @summary-agent @summary-reference S10 — Summary Agent 引用对照面板", () => {
  test("选择已有总结作为 Agent 引用后打开右侧对照面板", async ({ authedPage }) => {
    await registerS10SummaryAgentReferenceSidePanel(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();
    await expect(authedPage.getByText("暂无总结记录")).toBeVisible({ timeout: 15_000 });
    await authedPage.getByTestId(T.createEntry).click();

    await expect(authedPage.getByText("邀请同事一起总结信息")).toBeVisible({ timeout: 15_000 });
    await authedPage.getByTestId(T.listModeSwitch).click();
    await authedPage.getByTestId(T.listAgentTab).click();
    await expect(
      authedPage.getByText("你好，我是总结助手，想总结什么尽管告诉我。")
    ).toBeVisible({ timeout: 15_000 });

    const referenceEntry = authedPage.getByTestId(T.agentRefEntry);
    await expect(referenceEntry).toBeVisible();
    await referenceEntry.click();

    await expect(authedPage.getByText("选择要引用的总结")).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByTestId(T.agentRefSearchInput)).toBeVisible();
    await authedPage.getByText("S10 已有客户总结", { exact: true }).click();

    await expect(authedPage.getByText("已引用")).toBeVisible();
    const referenceCard = authedPage.getByTestId(T.agentRefCard);
    await expect(referenceCard.getByText("S10 已有客户总结", { exact: true })).toBeVisible();

    await referenceCard.click();
    await expect(
      authedPage.getByTestId(T.agentRefSidePanel).getByTestId(T.agentRefSideTitle)
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      authedPage.getByTestId(T.agentRefSidePanel).getByTestId(T.agentRefSideTitle)
    ).toContainText("S10 已有客户总结");
    await expect(authedPage.getByText(/以下内容为该总结的最新版本/)).toBeVisible();
    await expect(authedPage.getByText("历史风险需要继续跟进")).toBeVisible();

    await authedPage.getByTestId(T.agentRefRemoveBtn).click();
    await expect(authedPage.getByText("已引用")).toHaveCount(0);
    await expect(authedPage.getByTestId(T.agentRefEntry)).toBeVisible();
    await expect(authedPage.getByTestId(T.agentRefSidePanel)).toHaveCount(0);
    await expect(authedPage.getByText("加载失败")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
