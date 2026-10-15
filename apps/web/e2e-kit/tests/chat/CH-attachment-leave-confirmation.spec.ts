import { test, expect } from "../../fixtures-authed";
import { installMockImRuntime, type MockSeed } from "../../_kit/mock-im-runtime";
import { registerChatLifecycleHandlers } from "../../msw-handlers/chat-layout";

test("@p1 browser drafts retain ordered attachments and text across navigation and reload", async ({ authedPage: page }) => {
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
  const editor = page.locator('[contenteditable="true"]');
  const fileInput = page.locator('input[type="file"]').first();
  const composer = page.locator(".wk-messageinput-box");
  const rowA = page.locator('[data-object-id="draft-leave-a"]');
  const rowB = page.locator('[data-object-id="draft-leave-b"]');
  const extraBodies: Record<string, unknown>[] = [];
  page.on("request", request => {
    if (request.url().includes("/conversations/") && request.url().endsWith("/extra")) {
      extraBodies.push(request.postDataJSON());
    }
  });
  await fileInput.setInputFiles({ name: "file-a.zip", mimeType: "application/zip", buffer: Buffer.from("file a") });
  await editor.pressSequentially("between");
  await fileInput.setInputFiles({ name: "file-b.md", mimeType: "text/markdown", buffer: Buffer.from("file b") });
  await expect(composer.getByText("file-b.md", { exact: true })).toBeVisible();
  await expect(rowA.locator(".wk-reminder")).toHaveCount(0);
  await rowB.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(rowA.locator(".wk-conversationlist-item-lastmsg")).toHaveText("[草稿][file-a.zip]between[file-b.md]");
  await editor.pressSequentially("draft B");
  await rowA.click();
  await expect(editor).toHaveText("between");
  await expect(composer.getByText("file-a.zip", { exact: true })).toBeVisible();
  await expect(composer.getByText("file-b.md", { exact: true })).toBeVisible();
  await expect(rowA.locator(".wk-reminder")).toHaveCount(0);
  await expect(rowB.locator(".wk-conversationlist-item-lastmsg")).toContainText("[草稿]draft B");
  await composer.getByRole("button", { name: "移除", exact: true }).first().click();
  await rowB.click();
  await expect(rowA.locator(".wk-conversationlist-item-lastmsg")).toHaveText("[草稿]between[file-b.md]");
  await page.reload();
  await page.getByRole("button", { name: "会话" }).click();
  await page.getByRole("button", { name: "最近", exact: true }).click();
  await rowA.click();
  await expect(editor).toHaveText("between");
  await expect(composer.getByText("file-a.zip", { exact: true })).toHaveCount(0);
  await expect(composer.getByText("file-b.md", { exact: true })).toBeVisible();
  expect(extraBodies.length).toBeGreaterThan(0);
  expect(extraBodies.every(body => !("draft" in body))).toBe(true);
});
