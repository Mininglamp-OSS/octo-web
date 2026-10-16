import { test, expect } from "../../fixtures-authed";
import { installMockImRuntime, type MockSeed } from "../../_kit/mock-im-runtime";
import { registerChatLifecycleHandlers } from "../../msw-handlers/chat-layout";

for (const locale of ["zh-CN", "en-US"] as const) {
  test.describe(`draft recovery ${locale}`, () => {
    test.use({ authedLocale: locale });
    test("@p1 explicitly recovers interrupted attachment sends after reload", async ({ authedPage: page }, testInfo) => {
      await registerChatLifecycleHandlers(page);
      await installMockImRuntime(page, {
        currentUid: "e2e-user-1", spaceId: "e2e-space-001",
        users: [{ uid: "e2e-user-1", name: "E2E Tester" }],
        groups: [{ group_no: "interrupted-send", name: "Interrupted Send" }],
        conversations: [{ channelId: "interrupted-send", channelType: 2, unread: 0, timestamp: Math.floor(Date.now() / 1000) }],
        messages: [], subscribers: [],
      });
      const openChat = async () => {
        await page.getByRole("button", { name: locale === "zh-CN" ? "会话" : "Chats", exact: true }).click();
        await page.getByRole("button", { name: locale === "zh-CN" ? "最近" : "Recent", exact: true }).click();
        await page.locator('[data-object-id="interrupted-send"]').click();
      };
      await openChat();
      const composer = page.locator(".wk-messageinput-box");
      await expect(composer.locator('[contenteditable="true"]')).toBeVisible();
      await page.locator('input[type="file"]').first().setInputFiles({ name: "recover.zip", mimeType: "application/zip", buffer: Buffer.from("recover bytes") });
      await expect(composer.getByText("recover.zip", { exact: true })).toBeVisible();
      // Wait for staging, then reproduce a committed reservation whose owner
      // disappears before settlement. No subsequent send callback can run.
      await expect.poll(() => page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("octo-conversation-drafts");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const found = await new Promise<boolean>((resolve, reject) => {
          const tx = db.transaction("attachments", "readwrite");
          const store = tx.objectStore("attachments");
          const request = store.getAll();
          let found = false;
          request.onsuccess = () => {
            const file = request.result.find(item => item.name === "recover.zip");
            if (file) { found = true; store.put({ ...file, reserved: "crashed-send" }); }
          };
          tx.oncomplete = () => resolve(found);
          tx.onabort = () => reject(tx.error);
        });
        db.close();
        return found;
      })).toBe(true);
      // MSW cannot resolve a page-owned handler once its client unloads.
      await page.context().route("**/api/v1/conversations/interrupted-send/2/extra", async route => {
        if (route.request().method() !== "POST") return route.fallback();
        expect(route.request().postDataJSON()).toHaveProperty("draft", "");
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      });
      await page.reload();
      await openChat();
      const recover = composer.getByRole("button", { name: locale === "zh-CN" ? "恢复待确认附件" : "Restore unconfirmed attachments", exact: true });
      await expect(recover).toBeVisible();
      await expect(composer).toContainText(locale === "zh-CN" ? "有 1 个附件" : "Unconfirmed attachment deliveries: 1");
      await expect(composer).not.toContainText("{count}");
      await expect(composer.locator('[contenteditable="true"]')).toHaveCount(0);
      for (const theme of ["light", "dark"]) {
        await page.evaluate(theme => document.body.setAttribute("theme-mode", theme), theme);
        await composer.screenshot({ path: testInfo.outputPath(`${locale}-${theme}-interrupted-send.png`) });
      }
      await composer.getByRole("button", { name: locale === "zh-CN" ? "使用临时草稿" : "Use temporary draft", exact: true }).click();
      await expect(composer.locator('[contenteditable="true"]')).toBeVisible();
      await expect(composer.getByText("recover.zip", { exact: true })).toHaveCount(0);
      await page.reload();
      await openChat();
      await recover.click();
      await expect(composer.locator('[contenteditable="true"]')).toBeVisible();
      await expect(composer.getByText("recover.zip", { exact: true })).toBeVisible();
      await page.reload();
      await openChat();
      await expect(recover).toHaveCount(0);
      await expect(composer.getByText("recover.zip", { exact: true })).toBeVisible();
    });
    test("@p1 recovers from post-load quota failure without overwriting the saved copy", async ({ authedPage: page }, testInfo) => {
      await registerChatLifecycleHandlers(page);
      await installMockImRuntime(page, {
        currentUid: "e2e-user-1", spaceId: "e2e-space-001",
        users: [{ uid: "e2e-user-1", name: "E2E Tester" }],
        groups: [{ group_no: "quota-a", name: "Quota A" }],
        conversations: [{ channelId: "quota-a", channelType: 2, unread: 0, timestamp: Math.floor(Date.now() / 1000) }],
        messages: [], subscribers: [],
      });
      await page.getByRole("button", { name: locale === "zh-CN" ? "会话" : "Chats", exact: true }).click();
      await page.getByRole("button", { name: locale === "zh-CN" ? "最近" : "Recent", exact: true }).click();
      await page.locator('[data-object-id="quota-a"]').click();
      const editor = page.locator('.wk-messageinput-box [contenteditable="true"]');
      await expect(editor).toBeVisible();
      await editor.fill("last saved copy");
      const readSaved = () => page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("octo-conversation-drafts");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const result = await new Promise<string>((resolve, reject) => {
          const request = db.transaction("drafts").objectStore("drafts").getAll();
          request.onsuccess = () => resolve(JSON.stringify(request.result.find(record => record.key.includes("quota-a"))));
          request.onerror = () => reject(request.error);
        });
        db.close();
        return result;
      });
      await expect.poll(readSaved).toContain("last saved copy");
      const saved = await readSaved();
      await page.evaluate(() => {
        const original = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (stores, mode, options) {
          const names = typeof stores === "string" ? [stores] : Array.from(stores);
          if (this.name === "octo-conversation-drafts" && mode === "readwrite" && names.includes("drafts"))
            throw new DOMException("Injected quota failure", "QuotaExceededError");
          return original.call(this, stores, mode, options);
        };
      });
      await editor.fill("current unsaved message");
      const temporary = page.getByRole("button", { name: locale === "zh-CN" ? "使用临时草稿" : "Use temporary draft", exact: true });
      await expect(temporary).toBeVisible();
      await editor.press("Enter");
      await expect(editor).toHaveText("current unsaved message");
      for (const theme of ["light", "dark"]) {
        await page.evaluate(theme => document.body.setAttribute("theme-mode", theme), theme);
        await page.locator(".wk-messageinput-box").screenshot({ path: testInfo.outputPath(`${locale}-${theme}-save.png`) });
      }
      await temporary.click();
      await expect(editor).toHaveText("current unsaved message");
      await editor.press("Enter");
      await expect(editor).toHaveText("");
      expect(await readSaved()).toBe(saved);
    });
    test("@p1 retries failed reads and preserves saved content in temporary mode", async ({ authedPage: page }, testInfo) => {
      const groups = [{ group_no: "recovery-a", name: "Recovery A" }, { group_no: "recovery-b", name: "Recovery B" }];
      const seed: MockSeed = {
        currentUid: "e2e-user-1", spaceId: "e2e-space-001",
        users: [{ uid: "e2e-user-1", name: "E2E Tester" }], groups,
        conversations: groups.map(group => ({ channelId: group.group_no, channelType: 2, unread: 0, timestamp: Math.floor(Date.now() / 1000) })),
        messages: [], subscribers: [],
      };
      await registerChatLifecycleHandlers(page);
      await installMockImRuntime(page, seed);
      await page.getByRole("button", { name: locale === "zh-CN" ? "会话" : "Chats", exact: true }).click();
      await page.getByRole("button", { name: locale === "zh-CN" ? "最近" : "Recent", exact: true }).click();
      const rowA = page.locator('[data-object-id="recovery-a"]');
      const rowB = page.locator('[data-object-id="recovery-b"]');
      await rowA.click();
      const editor = page.locator('.wk-messageinput-box [contenteditable="true"]');
      await expect(editor).toBeVisible();
      await editor.fill("keep this saved draft");
      const readSaved = () => page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("octo-conversation-drafts");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const result = await new Promise<string | undefined>((resolve, reject) => {
          const request = db.transaction("drafts").objectStore("drafts").getAll();
          request.onsuccess = () => resolve(JSON.stringify(request.result.find(record => record.key.includes("recovery-a"))));
          request.onerror = () => reject(request.error);
        });
        db.close();
        return result;
      });
      await expect.poll(readSaved).toContain("keep this saved draft");
      await rowB.click();
      await expect(editor).toHaveText("");
      const failReads = (count: number) => page.evaluate(count => {
        const original = IDBDatabase.prototype.transaction;
        let remaining = count;
        IDBDatabase.prototype.transaction = function (stores, mode, options) {
          const names = typeof stores === "string" ? [stores] : Array.from(stores);
          if (this.name === "octo-conversation-drafts" && mode !== "readwrite" && names.includes("attachments") && remaining-- > 0)
            throw new DOMException("Injected attachment read failure", "UnknownError");
          return original.call(this, stores, mode, options);
        };
      }, count);
      await failReads(1);
      await rowA.click();
      const retry = page.getByRole("button", { name: locale === "zh-CN" ? "重新读取" : "Retry loading", exact: true });
      await expect(retry).toBeVisible();
      for (const theme of ["light", "dark"]) {
        await page.evaluate(theme => document.body.setAttribute("theme-mode", theme), theme);
        await page.locator(".wk-messageinput-box").screenshot({ path: testInfo.outputPath(`${locale}-${theme}-restore.png`) });
      }
      await retry.click();
      await expect(editor).toHaveText("keep this saved draft");
      await editor.press("End");
      await editor.pressSequentially(" after retry");
      await expect.poll(readSaved).toContain("after retry");
      const saved = await readSaved();
      await rowB.click();
      await expect(editor).toHaveText("");
      await failReads(1000);
      await rowA.click();
      await page.getByRole("button", { name: locale === "zh-CN" ? "使用临时草稿" : "Use temporary draft", exact: true }).click();
      await expect(editor).toBeVisible();
      await editor.fill("temporary message");
      await editor.press("Enter");
      await expect(editor).toHaveText("");
      expect(await readSaved()).toBe(saved);
    });
  });
}
