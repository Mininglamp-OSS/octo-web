import { test, expect } from "../../fixtures-authed";
import { installMockImRuntime, type MockSeed } from "../../_kit/mock-im-runtime";
import { registerChatLifecycleHandlers } from "../../msw-handlers/chat-layout";
import { registerCH43ChatAttachmentFailure } from "../../msw-handlers/ch43-chat-attachment-failure";

const GROUP_ID = "e2e-chat-attachment-failure";
const GROUP_NAME = "E2E 附件失败群";

test("@CH43 @p1 @chat @composer @attachment @retry 附件上传失败后保留待发送附件", async ({ authedPage }) => {
  const seed: MockSeed = {
    currentUid: "e2e-user-1", spaceId: "e2e-space-001",
    users: [{ uid: "e2e-user-1", name: "E2E Tester" }, { uid: "e2e-user-2", name: "E2E Sender" }],
    groups: [{ group_no: GROUP_ID, name: GROUP_NAME }],
    conversations: [{ channelId: GROUP_ID, channelType: 2, unread: 0, timestamp: Math.floor(Date.now() / 1000) }],
    messages: [], subscribers: [],
  };
  await registerChatLifecycleHandlers(authedPage);
  await registerCH43ChatAttachmentFailure(authedPage);
  await installMockImRuntime(authedPage, seed);
  await authedPage.getByRole("button", { name: "会话" }).click();
  await authedPage.getByRole("button", { name: "最近", exact: true }).click();
  await expect(authedPage.getByText(GROUP_NAME, { exact: true })).toBeVisible({ timeout: 15_000 });
  await authedPage.getByText(GROUP_NAME, { exact: true }).click();
  await expect(authedPage.locator('[contenteditable="true"]')).toBeVisible({ timeout: 15_000 });

  const filename = "E2E 失败附件.txt";
  await authedPage.locator('input[type="file"]').first().setInputFiles({ name: filename, mimeType: "text/plain", buffer: Buffer.from("e2e") });
  const editor = authedPage.locator('[contenteditable="true"]');
  await editor.pressSequentially("发送附件");
  await editor.press("Enter");
  await expect(authedPage.locator(".wk-message-item").getByText("发送附件", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(authedPage.locator(".wk-messageinput-box").getByText(filename, { exact: true })).toBeVisible();
  await expect(authedPage.locator(".wk-message-item").filter({ hasText: filename })).toHaveCount(0);
});
