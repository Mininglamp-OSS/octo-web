/* eslint-disable no-undef -- e2e code runs in Node */
import { test, expect } from "../../fixtures-authed";
import { installMockImRuntime, type MockSeed } from "../../_kit/mock-im-runtime";

const CHAT_GROUP = "e2e-chat-group";
const CHAT_GROUP_NAME = "E2E Chat 群";
const HISTORY_MESSAGE = "欢迎来到 E2E Chat";

function chatSeed(overrides: Partial<MockSeed> = {}): MockSeed {
  return {
    currentUid: "e2e-user-1",
    spaceId: "e2e-space-001",
    users: [
      { uid: "e2e-user-1", name: "E2E Tester", robot: 0 },
      { uid: "e2e-user-2", name: "E2E Sender", robot: 0 },
    ],
    groups: [{ group_no: CHAT_GROUP, name: CHAT_GROUP_NAME }],
    conversations: [
      {
        channelId: CHAT_GROUP,
        channelType: 2,
        unread: 0,
        timestamp: Math.floor(Date.now() / 1000),
      },
    ],
    messages: [
      {
        channelId: CHAT_GROUP,
        channelType: 2,
        messageSeq: 1,
        fromUid: "e2e-user-2",
        content: { type: 1, text: HISTORY_MESSAGE },
      },
    ],
    subscribers: [],
    ...overrides,
  };
}

async function openChat(page: Parameters<typeof installMockImRuntime>[0]) {
  await page.getByRole("button", { name: "会话" }).click();
  const recentTab = page.getByRole("button", { name: "最近", exact: true });
  await expect(recentTab).toBeVisible();
  await recentTab.click();
}

async function openSeededConversation(
  page: Parameters<typeof installMockImRuntime>[0],
) {
  await installMockImRuntime(page, chatSeed());
  await openChat(page);
  await expect(page.getByText(CHAT_GROUP_NAME, { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByText(CHAT_GROUP_NAME, { exact: true }).click();
  await expect(page.getByText(HISTORY_MESSAGE, { exact: false })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("@CH1 @p0 @chat @chat-shell", () => {
  test("登录后进入 Chat shell", async ({ authedPage }) => {
    await openChat(authedPage);
    await expect(authedPage.getByRole("button", { name: "会话" })).toBeVisible();
    await expect(authedPage.getByRole("button", { name: "找人聊天" })).toBeVisible();
  });
});

test.describe("@CH2 @p0 @chat @conversation", () => {
  test("从最近会话打开并显示历史消息", async ({ authedPage }) => {
    await openSeededConversation(authedPage);
  });
});

test.describe("@CH3 @p1 @chat @conversation @composer", () => {
  test("发送文本消息后消息流出现新消息", async ({ authedPage }) => {
    await openSeededConversation(authedPage);

    const editor = authedPage.locator('[contenteditable="true"]').last();
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.click();
    await editor.pressSequentially("E2E 文本消息");
    await editor.press("Enter");

    await expect(
      authedPage.locator(".wk-conversation-messages").getByText("E2E 文本消息", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("@CH4 @p1 @chat @empty-state", () => {
  test("无最近会话时显示空态入口", async ({ authedPage }) => {
    await openChat(authedPage);
    await expect(authedPage.getByText("还没有会话", { exact: true })).toBeVisible();
    await expect(
      authedPage.getByText("从通讯录选择联系人开始聊天", { exact: true }),
    ).toBeVisible();
    await expect(authedPage.getByRole("button", { name: "找人聊天" })).toBeVisible();
  });
});
