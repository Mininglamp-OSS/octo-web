/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/chat/S22-summary-chat-panel-history-detail.md
 *
 * S22: 聊天 header 智能总结入口 → 聊天内 Summary Panel 历史 → 内嵌详情.
 */
import { test, expect } from "../../../fixtures-authed";
import { installMockImRuntime } from "../../../_kit/mock-im-runtime";
import { registerS22SummaryChatPanelHistoryDetail } from "../../../msw-handlers/s22-summary-chat-panel-history-detail";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S22 @p1 @summary @chat @summary-panel @summary-detail S22 — 聊天内 Summary Panel", () => {
  test("从聊天 header 打开 Summary Panel 并进入历史详情", async ({ authedPage }) => {
    await registerS22SummaryChatPanelHistoryDetail(authedPage);
    await installMockImRuntime(authedPage, {
      currentUid: "e2e-user-1",
      spaceId: "e2e-space-001",
      users: [{ uid: "e2e-user-1", name: "E2E Tester", robot: 0 }],
      groups: [{ group_no: "s22-project-group", name: "S22 项目群" }],
      conversations: [{ channelId: "s22-project-group", channelType: 2, unread: 0 }],
      messages: [
        {
          channelId: "s22-project-group",
          channelType: 2,
          messageSeq: 1,
          fromUid: "e2e-user-1",
          content: { type: 1, text: "S22 项目群历史消息" },
        },
      ],
      subscribers: [
        { uid: "e2e-user-1", name: "E2E Tester", channelId: "s22-project-group", channelType: 2, role: 1, robot: 0 },
      ],
    });
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "会话" }).click();
    await authedPage.getByRole("button", { name: "最近" }).click();
    await expect(authedPage.getByText("S22 项目群", { exact: true })).toBeVisible({ timeout: 15_000 });
    await authedPage.getByText("S22 项目群", { exact: true }).click();

    await expect(
      authedPage.locator(".wk-chat-conversation-header-channel-info-name", { hasText: "S22 项目群" })
    ).toBeVisible({ timeout: 15_000 });

    await authedPage.getByTestId(T.chatPanelHeaderBtn).click();
    const panel = authedPage.getByTestId(T.chatPanel);
    await expect(panel.getByRole("heading", { name: "聊天内的智能总结" })).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText("S22 聊天内总结", { exact: true })).toBeVisible();
    await expect(panel.getByText("已完成", { exact: true })).toBeVisible();

    await panel.getByText("S22 聊天内总结", { exact: true }).click();
    await expect(panel.getByTestId(T.chatPanelBackBtn)).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByTestId(T.chatPanelBackBtn)).toContainText("返回");
    await expect(panel.getByTestId(T.detailPage)).toBeVisible();
    await expect(panel.getByText("AI 摘要")).toBeVisible();
    await expect(panel.getByText("S22 聊天内详情正文")).toBeVisible();
    await expect(panel.getByText("加载失败")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
