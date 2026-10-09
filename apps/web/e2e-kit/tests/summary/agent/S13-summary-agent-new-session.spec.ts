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

    // v2 workbench 由列表页「+」直接进入，不再经过 Legacy Agent tab。
    await authedPage.getByTestId(T.listModeSwitch).click();
    await expect(authedPage.getByTestId(T.workbenchFeature)).toBeVisible({ timeout: 15_000 });

    await authedPage.getByRole("button", { name: "引用总结", exact: true }).click();
    await expect(authedPage.getByText("选择要引用的总结")).toBeVisible({ timeout: 15_000 });
    await authedPage.getByText("S13 可引用总结", { exact: true }).click();

    await expect(
      authedPage.getByRole("button", { name: "引用总结: S13 可引用总结" })
    ).toBeVisible();

    await authedPage
      .getByRole("textbox", { name: "描述你想总结的内容和要求" })
      .fill("S13 第一轮问题");
    await authedPage.getByRole("button", { name: "发送", exact: true }).click();

    await expect(authedPage.getByText("S13 第一轮问题")).toBeVisible();
    await expect(authedPage.getByText("S13 Agent 已生成第一轮回复")).toBeVisible({ timeout: 15_000 });

    await authedPage.getByTestId(T.agentNewSessionBtn).click();
    await expect(
      authedPage.getByRole("button", { name: "引用总结: S13 可引用总结" })
    ).toHaveCount(0);
    await expect(
      authedPage.getByRole("button", { name: "引用总结", exact: true })
    ).toBeVisible();
    await expect(authedPage.getByText("S13 第一轮问题")).toHaveCount(0);
    await expect(authedPage.getByText("S13 Agent 已生成第一轮回复")).toHaveCount(0);
    await expect(
      authedPage.getByRole("textbox", { name: "描述你想总结的内容和要求" })
    ).toBeVisible();

    await expect(authedPage.getByTestId(T.workbenchLastSession)).toBeVisible();
    await authedPage.getByTestId(T.workbenchLastSession).click();
    await expect(authedPage.getByText("S13 第一轮问题")).toBeVisible();
    await expect(authedPage.getByText("S13 Agent 已生成第一轮回复")).toBeVisible();

    await sanityCheck(authedPage, ctx);
  });
});
