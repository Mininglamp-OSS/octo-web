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
  // On unload, MSW may lose its page client before dealloc's metadata POST
  // reaches the handler. Catch only this fixture's POST at the context level
  // (which also sees worker-owned passthrough), including after the page closes.
  // Normal navigation above still exercises the baseline MSW handler.
  await page.context().route("**/api/v1/conversations/draft-leave-*/2/extra", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON();
    expect(body).toHaveProperty("draft", "");
    extraBodies.push(body);
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.reload();
  await page.getByRole("button", { name: "会话" }).click();
  await page.getByRole("button", { name: "最近", exact: true }).click();
  await rowA.click();
  await expect(editor).toHaveText("between");
  await expect(composer.getByText("file-a.zip", { exact: true })).toHaveCount(0);
  await expect(composer.getByText("file-b.md", { exact: true })).toBeVisible();
  expect(extraBodies.length).toBeGreaterThan(0);
  expect(extraBodies.every(body => body.draft === "")).toBe(true);
});

test("@p1 failed blob storage requires cancel or explicit discard even when the document saves", async ({ authedPage: page }) => {
  const groups = [{ group_no: "quota-leave-a", name: "Quota Leave A" }, { group_no: "quota-leave-b", name: "Quota Leave B" }];
  await registerChatLifecycleHandlers(page);
  await installMockImRuntime(page, {
    currentUid: "e2e-user-1", spaceId: "e2e-space-001",
    users: [{ uid: "e2e-user-1", name: "E2E Tester" }], groups,
    conversations: groups.map(group => ({ channelId: group.group_no, channelType: 2, unread: 0, timestamp: Math.floor(Date.now() / 1000) })),
    messages: [], subscribers: [],
  });
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await page.getByRole("button", { name: "最近", exact: true }).click();
  const rowA = page.locator('[data-object-id="quota-leave-a"]');
  const rowB = page.locator('[data-object-id="quota-leave-b"]');
  await rowA.click();
  const composer = page.locator(".wk-messageinput-box");
  await expect(composer.locator('[contenteditable="true"]')).toBeVisible();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "attachments" && value.file instanceof Blob)
        throw new DOMException("Injected blob quota failure", "QuotaExceededError");
      return put.call(this, value, key);
    };
  });
  await page.locator('input[type="file"]').first().setInputFiles({ name: "unsaved.zip", mimeType: "application/zip", buffer: Buffer.from("only in memory") });
  await expect(composer.getByText("unsaved.zip", { exact: true })).toBeVisible();
  // Confirm the smaller document write succeeded, so it cannot accidentally
  // supply the leave veto that the missing blob must provide on its own.
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("octo-conversation-drafts");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<boolean>((resolve, reject) => {
        const tx = db.transaction(["drafts", "attachments"]);
        const documents = tx.objectStore("drafts").getAll();
        const files = tx.objectStore("attachments").getAll();
        tx.oncomplete = () => resolve(
          documents.result.some(record => record.key.includes("quota-leave-a") && record.draft.topAttachments.some((file: { name: string }) => file.name === "unsaved.zip")) &&
          files.result.length === 0
        );
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  })).toBe(true);
  await rowB.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("有未发送的附件");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(composer.getByText("unsaved.zip", { exact: true })).toBeVisible();
  await rowB.click();
  await dialog.getByRole("button", { name: "继续切换", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(composer.getByText("unsaved.zip", { exact: true })).toHaveCount(0);
  await rowA.click();
  await expect(dialog).toHaveCount(0);
  await expect(composer.getByText("unsaved.zip", { exact: true })).toHaveCount(0);
});
