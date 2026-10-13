import { test, expect } from "../../fixtures-authed";
import { installMockImRuntime, type MockSeed } from "../../_kit/mock-im-runtime";
import { registerChatLifecycleHandlers } from "../../msw-handlers/chat-layout";

test("@p1 browser attachments require leave confirmation and are discarded on confirmed navigation", async ({ authedPage: page }) => {
  const groups = [{ group_no: "draft-leave-a", name: "Draft Leave A" }, { group_no: "draft-leave-b", name: "Draft Leave B" }];
  const seed: MockSeed = {
    currentUid: "e2e-user-1", spaceId: "e2e-space-001",
    users: [{ uid: "e2e-user-1", name: "E2E Tester" }], groups,
    conversations: groups.map(group => ({ channelId: group.group_no, channelType: 2, unread: 0, timestamp: Math.floor(Date.now() / 1000) })),
    messages: [], subscribers: [],
  };
  await registerChatLifecycleHandlers(page);
  await installMockImRuntime(page, seed);
  await page.getByRole("button", { name: "会话" }).click();
  await page.getByRole("button", { name: "最近", exact: true }).click();
  await page.getByText("Draft Leave A", { exact: true }).click();
  await expect(page.locator('[contenteditable="true"]')).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles({ name: "local-only.txt", mimeType: "text/plain", buffer: Buffer.from("browser attachment") });
  const composer = page.locator(".wk-messageinput-box");
  await expect(composer.getByText("local-only.txt", { exact: true })).toBeVisible();
  await page.getByText("Draft Leave B", { exact: true }).click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "取消", exact: true }).click();
  await expect(composer.getByText("local-only.txt", { exact: true })).toBeVisible();
  await page.getByText("Draft Leave B", { exact: true }).click();
  await modal.getByRole("button", { name: "继续切换", exact: true }).click();
  await expect(modal).toBeHidden();
  await page.getByText("Draft Leave A", { exact: true }).click();
  await expect(composer).toBeVisible();
  await expect(composer.getByText("local-only.txt", { exact: true })).toHaveCount(0);
});
