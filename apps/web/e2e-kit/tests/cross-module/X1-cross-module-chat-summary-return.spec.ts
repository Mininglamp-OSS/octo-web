/* eslint-disable no-undef -- e2e code runs in Node */
/**
 * spec: e2e-kit/case-specs/cross-module/X1-cross-module-chat-summary-return.md
 *
 * X1: Chat 与 Summary Panel 返回链路.
 */
import { test, expect } from "../../fixtures-authed";
import { installMockImRuntime } from "../../_kit/mock-im-runtime";
import { registerX1CrossModuleChatSummaryReturn } from "../../msw-handlers/x1-cross-module-chat-summary-return";
import { T } from "../summary/_testids";

test("@X1 @p1 @cross-module @chat @summary @deep-link Chat 进入 Summary 详情后返回当前会话", async ({ authedPage }) => {
  await registerX1CrossModuleChatSummaryReturn(authedPage);
  await installMockImRuntime(authedPage, {
    currentUid: "e2e-user-1",
    spaceId: "e2e-space-001",
    users: [{ uid: "e2e-user-1", name: "E2E Tester", robot: 0 }],
    groups: [{ group_no: "s22-project-group", name: "S22 项目群" }],
    conversations: [{ channelId: "s22-project-group", channelType: 2, unread: 0 }],
    messages: [{ channelId: "s22-project-group", channelType: 2, messageSeq: 1, fromUid: "e2e-user-1", content: { type: 1, text: "S22 项目群历史消息" } }],
    subscribers: [{ uid: "e2e-user-1", name: "E2E Tester", channelId: "s22-project-group", channelType: 2, role: 1, robot: 0 }],
  });

  await authedPage.getByRole("button", { name: "会话" }).click();
  await authedPage.getByRole("button", { name: "最近" }).click();
  await expect(authedPage.getByText("S22 项目群", { exact: true })).toBeVisible({ timeout: 15_000 });
  await authedPage.getByText("S22 项目群", { exact: true }).click();
  await expect(authedPage.locator(".wk-chat-conversation-header-channel-info-name", { hasText: "S22 项目群" })).toBeVisible({ timeout: 15_000 });

  await authedPage.getByTestId(T.chatPanelHeaderBtn).click();
  const panel = authedPage.getByTestId(T.chatPanel);
  await expect(panel.getByRole("heading", { name: "聊天内的智能总结" })).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByText("S22 聊天内总结", { exact: true })).toBeVisible();
  await panel.getByText("S22 聊天内总结", { exact: true }).click();
  await expect(panel.getByText("S22 聊天内详情正文", { exact: true })).toBeVisible({ timeout: 15_000 });

  await panel.getByTestId(T.chatPanelBackBtn).click();
  await expect(panel.getByRole("heading", { name: "聊天内的智能总结" })).toBeVisible();
  await expect(panel.getByText("S22 聊天内总结", { exact: true })).toBeVisible();
  await expect(
    authedPage.locator(".wk-chat-conversation-header-channel-info-name", { hasText: "S22 项目群" }),
  ).toBeVisible();
});
