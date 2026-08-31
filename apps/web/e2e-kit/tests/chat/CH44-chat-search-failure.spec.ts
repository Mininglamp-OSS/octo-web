import { test, expect } from "../../fixtures-authed";
import { installMockImRuntime, type MockSeed } from "../../_kit/mock-im-runtime";
import { registerCH44ChatSearchFailure } from "../../msw-handlers/ch44-chat-search-failure";

const GROUP_ID = "e2e-chat-search-failure";
const GROUP_NAME = "E2E 搜索失败群";

test("@CH44 @p1 @chat @search @failure 会话搜索失败显示错误提示", async ({ authedPage }) => {
  const seed: MockSeed = {
    currentUid: "e2e-user-1", spaceId: "e2e-space-001",
    users: [{ uid: "e2e-user-1", name: "E2E Tester" }, { uid: "e2e-user-2", name: "E2E Sender" }],
    groups: [{ group_no: GROUP_ID, name: GROUP_NAME }],
    conversations: [{ channelId: GROUP_ID, channelType: 2, unread: 0, timestamp: Math.floor(Date.now() / 1000) }],
    messages: [], subscribers: [],
  };
  await installMockImRuntime(authedPage, seed);
  await registerCH44ChatSearchFailure(authedPage);
  await authedPage.getByRole("button", { name: "会话" }).click();
  await authedPage.getByRole("button", { name: "最近", exact: true }).click();
  await expect(authedPage.getByText(GROUP_NAME, { exact: true })).toBeVisible({ timeout: 15_000 });
  await authedPage.getByText(GROUP_NAME, { exact: true }).click();
  await expect(authedPage.locator('[contenteditable="true"]')).toBeVisible({ timeout: 15_000 });
  await authedPage.getByTestId("channel-search-entry").click();
  await authedPage.getByPlaceholder("输入关键字搜索").fill("失败搜索");
  await expect(authedPage.getByText("搜索失败，请稍后重试", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(authedPage.getByText("暂无匹配结果", { exact: true })).toHaveCount(0);
});
