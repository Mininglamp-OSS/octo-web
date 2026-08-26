/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId CH5-chat-context-menu
// @caseId CH6-chat-clear-unread
// @caseId CH7-chat-composer-settle
// @caseId CH8-chat-sidebar-badges

import { test, expect } from "../../fixtures-authed";
import { installMockImRuntime, type MockSeed } from "../../_kit/mock-im-runtime";
import { registerCh6ChatClearUnread } from "../../msw-handlers/ch6-chat-clear-unread";
import { registerCh8ChatSidebarBadges } from "../../msw-handlers/ch8-chat-sidebar-badges";

const GROUP_ID = "e2e-chat-supplement-group";
const GROUP_NAME = "E2E Chat 补充群";

function seed(unread = 0): MockSeed {
  return {
    currentUid: "e2e-user-1",
    spaceId: "e2e-space-001",
    users: [{ uid: "e2e-user-1", name: "E2E Tester", robot: 0 }],
    groups: [{ group_no: GROUP_ID, name: GROUP_NAME }],
    conversations: [{ channelId: GROUP_ID, channelType: 2, unread, timestamp: Math.floor(Date.now() / 1000) }],
    messages: [],
    subscribers: [],
  };
}

async function openRecent(page: Parameters<typeof installMockImRuntime>[0]) {
  await page.getByRole("button", { name: "会话" }).click();
  const recent = page.getByRole("button", { name: /^最近/ });
  await expect(recent).toBeVisible();
  await recent.click();
}

async function openMenu(page: Parameters<typeof installMockImRuntime>[0]) {
  const row = page.locator(`[data-object-id="${GROUP_ID}"]`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click({ button: "right" });
  await expect(page.getByText("置顶会话", { exact: true })).toBeVisible();
}

async function openConversation(page: Parameters<typeof installMockImRuntime>[0]) {
  await openRecent(page);
  await page.getByText(GROUP_NAME, { exact: true }).click();
  await expect(page.locator('[contenteditable="true"]')).toBeVisible({ timeout: 15_000 });
}

test.describe("@CH5 @p1 @chat @context-menu", () => {
  test("最近会话菜单显示当前操作矩阵", async ({ authedPage }) => {
    await installMockImRuntime(authedPage, seed(2));
    await openRecent(authedPage);
    await openMenu(authedPage);

    await expect(authedPage.getByText("清除未读", { exact: true })).toBeVisible();
    await expect(authedPage.getByText("设为免打扰", { exact: true })).toBeVisible();
    await expect(authedPage.getByText("标记为未读", { exact: true })).toHaveCount(0);
    await expect(authedPage.getByText("清空聊天记录", { exact: true })).toHaveCount(0);
    await expect(authedPage.getByText("关闭聊天窗口", { exact: true })).toHaveCount(0);
  });
});

test.describe("@CH6 @p1 @chat @unread", () => {
  test("清除未读后会话行不再显示未读数量", async ({ authedPage }) => {
    await registerCh6ChatClearUnread(authedPage);
    await installMockImRuntime(authedPage, seed(2));
    await openRecent(authedPage);
    await openMenu(authedPage);

    const row = authedPage.locator(`[data-object-id="${GROUP_ID}"]`);
    await expect(row.getByText("2", { exact: true })).toBeVisible();
    await authedPage.getByText("清除未读", { exact: true }).click();
    await expect(row.getByText("2", { exact: true })).toHaveCount(0);
  });
});

test.describe("@CH7 @p1 @chat @composer", () => {
  test("发送文本后编辑器消费原文并保留消息", async ({ authedPage }) => {
    await installMockImRuntime(authedPage, seed());
    await openConversation(authedPage);

    const editor = authedPage.locator('[contenteditable="true"]');
    await editor.click();
    await editor.pressSequentially("E2E transactional message");
    await editor.press("Enter");

    await expect(
      authedPage.getByText("E2E transactional message", { exact: true })
    ).toBeVisible({ timeout: 15_000 });
    await expect(editor).toHaveText("");
  });
});

test.describe("@CH8 @p1 @chat @sidebar", () => {
  test("关注为空时最近会话和最近角标保持稳定", async ({ authedPage }) => {
    await registerCh8ChatSidebarBadges(authedPage);
    await installMockImRuntime(authedPage, seed(1));
    await openRecent(authedPage);

    await expect(authedPage.getByText(GROUP_NAME, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(authedPage.getByRole("button", { name: /最近/ })).toContainText("1");
    await authedPage.getByRole("button", { name: "关注", exact: true }).click();
    await expect(authedPage.getByText(GROUP_NAME, { exact: true })).toHaveCount(0);
  });
});
