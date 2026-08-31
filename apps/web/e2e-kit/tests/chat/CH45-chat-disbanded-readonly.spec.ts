import { test, expect } from "../../fixtures-authed";
import { installMockImRuntime, type MockSeed } from "../../_kit/mock-im-runtime";

const GROUP_NAME = "E2E 已解散群";

test("@CH45 @p1 @chat @permission @readonly 已解散群聊进入只读状态", async ({ authedPage }) => {
  const seed: MockSeed = {
    currentUid: "e2e-user-1", spaceId: "e2e-space-001",
    users: [{ uid: "e2e-user-1", name: "E2E Tester" }],
    groups: [{ group_no: "e2e-disbanded-group", name: GROUP_NAME, extra: { status: 2 } }],
    conversations: [{ channelId: "e2e-disbanded-group", channelType: 2, unread: 0, timestamp: Math.floor(Date.now() / 1000) }],
    messages: [{ channelId: "e2e-disbanded-group", channelType: 2, messageSeq: 1, fromUid: "e2e-user-1", content: { type: 1, text: "解散前历史消息" } }],
    subscribers: [],
  };
  await installMockImRuntime(authedPage, seed);
  await authedPage.getByRole("button", { name: "会话" }).click();
  await authedPage.getByRole("button", { name: "最近", exact: true }).click();
  await expect(authedPage.getByText(GROUP_NAME, { exact: true })).toBeVisible({ timeout: 15_000 });
  await authedPage.getByText(GROUP_NAME, { exact: true }).click();
  await expect(authedPage.getByText("群聊已解散，无法发送消息", { exact: true })).toBeVisible();
  await expect(authedPage.locator('[contenteditable="true"]')).toHaveCount(0);
});
