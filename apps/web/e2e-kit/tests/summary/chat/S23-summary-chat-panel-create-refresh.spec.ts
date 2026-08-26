/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/summary/chat/S23-summary-chat-panel-create-refresh.md
 *
 * S23: 聊天内 Summary Panel 新建总结后刷新历史列表.
 */
import { test, expect } from "../../../fixtures-authed";
import { installMockImRuntime } from "../../../_kit/mock-im-runtime";
import { registerS23SummaryChatPanelCreateRefresh } from "../../../msw-handlers/s23-summary-chat-panel-create-refresh";
import { startRequestMonitor, sanityCheck } from "../../../_lib/sanity";
import { T } from "../_testids";

const sanityConfig = {
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

test.describe("@S23 @p2 @summary @chat @summary-panel @summary-create S23 — 聊天内新建刷新历史", () => {
  test("聊天内新建总结后回到历史列表", async ({ authedPage }) => {
    await registerS23SummaryChatPanelCreateRefresh(authedPage);
    await installMockImRuntime(authedPage, {
      currentUid: "e2e-user-1",
      spaceId: "e2e-space-001",
      users: [{ uid: "e2e-user-1", name: "E2E Tester", robot: 0 }],
      groups: [{ group_no: "s23-project-group", name: "S23 项目群" }],
      conversations: [{ channelId: "s23-project-group", channelType: 2, unread: 0 }],
      messages: [
        {
          channelId: "s23-project-group",
          channelType: 2,
          messageSeq: 1,
          fromUid: "e2e-user-1",
          content: { type: 1, text: "S23 项目群历史消息" },
        },
      ],
      subscribers: [
        { uid: "e2e-user-1", name: "E2E Tester", channelId: "s23-project-group", channelType: 2, role: 1, robot: 0 },
      ],
    });
    const ctx = startRequestMonitor(authedPage, sanityConfig);

    await authedPage.getByRole("button", { name: "会话" }).click();
    await authedPage.getByRole("button", { name: "最近" }).click();
    await expect(authedPage.getByText("S23 项目群", { exact: true })).toBeVisible({ timeout: 15_000 });
    await authedPage.getByText("S23 项目群", { exact: true }).click();

    await expect(
      authedPage.locator(".wk-chat-conversation-header-channel-info-name", { hasText: "S23 项目群" })
    ).toBeVisible({ timeout: 15_000 });

    await authedPage.getByTestId(T.chatPanelHeaderBtn).click();
    const panel = authedPage.getByTestId(T.chatPanel);
    await expect(panel.getByText("邀请同事一起总结信息")).toBeVisible({ timeout: 15_000 });

    await panel.getByTestId(T.createTopic).fill("S23 聊天内新建总结");
    await panel.getByTestId(T.createSubmit).click();

    await expect(authedPage.getByText("总结任务已创建")).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByRole("heading", { name: "聊天内的智能总结" })).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText("S23 聊天内新建总结", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText("加载失败")).toHaveCount(0);

    await sanityCheck(authedPage, ctx);
  });
});
