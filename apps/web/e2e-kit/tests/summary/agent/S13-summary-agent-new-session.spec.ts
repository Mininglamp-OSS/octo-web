/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/agent/S13-summary-agent-new-session.md
 *
 * S13: Agent 新会话清空消息与引用.
 */
import { test, expect } from "../../../fixtures-authed";
import { registerS13SummaryAgentNewSession } from "../../../msw-handlers/s13-summary-agent-new-session";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S13 @p1 @summary @agent @summary-agent @summary-reference S13 — Agent 新会话", () => {
  test("新会话清空 Agent 消息和引用", async ({ authedPage }) => {
    await registerS13SummaryAgentNewSession(authedPage);
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "智能总结" }).click();
    await expect(authedPage.getByText("暂无总结记录")).toBeVisible({ timeout: 15_000 });
    await authedPage.getByTestId(T.createEntry).click();

    await expect(authedPage.getByText("邀请同事一起总结信息")).toBeVisible({ timeout: 15_000 });
    await authedPage.getByTestId(T.createAgentTab).click();
    await expect(
      authedPage.getByText("你好，我是总结助手，想总结什么尽管告诉我。")
    ).toBeVisible({ timeout: 15_000 });

    await authedPage.getByTestId(T.agentRefEntry).click();
    await expect(authedPage.getByText("选择要引用的总结")).toBeVisible({ timeout: 15_000 });
    await authedPage.getByText("S13 可引用总结", { exact: true }).click();

    const referenceCard = authedPage.getByTestId(T.agentRefCard);
    await expect(referenceCard.getByText("已引用")).toBeVisible();
    await expect(referenceCard.getByText("S13 可引用总结", { exact: true })).toBeVisible();

    await authedPage.getByTestId(T.agentInput).fill("S13 第一轮问题");
    await authedPage.getByTestId(T.agentSendBtn).click();

    await expect(authedPage.getByText("S13 第一轮问题")).toBeVisible();
    await expect(authedPage.getByText("S13 Agent 已生成第一轮回复")).toBeVisible({ timeout: 15_000 });

    await authedPage.getByTestId(T.agentNewSessionBtn).click();
    await expect(authedPage.getByText("已引用")).toHaveCount(0);
    await expect(authedPage.getByTestId(T.agentRefEntry)).toBeVisible();
    await expect(authedPage.getByText("S13 第一轮问题")).toHaveCount(0);
    await expect(authedPage.getByText("S13 Agent 已生成第一轮回复")).toHaveCount(0);
    await expect(
      authedPage.getByText("你好，我是总结助手，想总结什么尽管告诉我。")
    ).toBeVisible();

    await sanityCheck(authedPage, ctx);
  });
});
