// @caseId GH1651
// @spec apps/web/e2e-kit/case-specs/chat/GH1651-url-punctuation.md
import { test, expect } from "../../fixtures-authed";
import { installMockImRuntime } from "../../_kit/mock-im-runtime";

test("@GH1651 @chat sent URLs keep prose punctuation outside their destinations", async ({
  authedPage: page,
}) => {
  const groupId = "e2e-url-punctuation";
  const groupName = "GH1651 URL test";
  await installMockImRuntime(page, {
    currentUid: "e2e-user-1",
    spaceId: "e2e-space-001",
    users: [{ uid: "e2e-user-1", name: "E2E Tester", robot: 0 }],
    groups: [{ group_no: groupId, name: groupName }],
    conversations: [
      {
        channelId: groupId,
        channelType: 2,
        unread: 0,
        timestamp: Math.floor(Date.now() / 1000),
      },
    ],
    messages: [],
    subscribers: [],
  });
  await page.getByRole("button", { name: "会话" }).click();
  await page.getByRole("button", { name: "最近", exact: true }).click();
  await page.getByText(groupName, { exact: true }).click();

  const editor = page.locator('[contenteditable="true"]');
  await expect(editor).toBeVisible();
  const cases = [
    {
      marker: "GH1651 screenshot",
      literal: true,
      body: "欧克，现在从https://github.com/Ranwanglc/octo-web的main拉去分支，然后开发一下，先不推pr,好了告诉我。",
      urls: ["https://github.com/Ranwanglc/octo-web"],
    },
    {
      marker: "GH1651 adjacent links",
      literal: true,
      body: "先看https://example.com/a的说明，再看https://example.com/b然后结束",
      urls: ["https://example.com/a", "https://example.com/b"],
    },
    {
      marker: "GH1651 punctuation with prose",
      literal: true,
      body: "https://github.com/Ranwanglc/octo-web,的main拉去分支。\nhttps://github.com/Ranwanglc/octo-web，的main拉去分支。",
      urls: [
        "https://github.com/Ranwanglc/octo-web",
        "https://github.com/Ranwanglc/octo-web",
      ],
    },
    {
      marker: "GH1651 original",
      literal: true,
      body: "https://example.com/repo-a/-/merge_requests/111,\nhttps://example.com/repo-b/-/merge_requests/222,\nhttps://example.com/repo-c/pull/333",
      urls: [
        "https://example.com/repo-a/-/merge_requests/111",
        "https://example.com/repo-b/-/merge_requests/222",
        "https://example.com/repo-c/pull/333",
      ],
    },
    {
      marker: "GH1651 boundaries",
      literal: true,
      body: "https://example.com/a，\nhttps://example.com/b。\n(https://example.com/Foo_(bar))。",
      urls: [
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/Foo_(bar)",
      ],
    },
    {
      marker: "GH1651 explicit",
      literal: false,
      body: "[explicit](https://example.com/explicit,)\n<https://example.com/angle;>",
      urls: ["https://example.com/explicit,", "https://example.com/angle;"],
    },
    {
      marker: "GH1651 math",
      literal: false,
      body: "$50\\% \\times x^2$ https://example.com/math，",
      urls: ["https://example.com/math"],
    },
  ];
  // Exercise all syntax in one message, including math's effect on positions.
  const lines = cases
    .map((sample) => `${sample.marker}\n${sample.body}`)
    .join("\n\n")
    .split("\n");
  await editor.click();
  for (let i = 0; i < lines.length; i += 1) {
    if (i > 0) await editor.press("Shift+Enter");
    if (lines[i]) await page.keyboard.insertText(lines[i]);
  }
  await editor.press("Enter");
  const message = page
    .locator('[data-locate-message-row="true"]')
    .filter({ hasText: "GH1651 original" });
  await expect(message).toBeVisible();
  for (const sample of cases) {
    const paragraph = message.locator("p").filter({ hasText: sample.marker });
    await expect(paragraph.getByRole("link")).toHaveCount(sample.urls.length);
    for (let i = 0; i < sample.urls.length; i += 1) {
      await expect(paragraph.getByRole("link").nth(i)).toHaveAttribute(
        "href",
        sample.urls[i]
      );
    }
    if (sample.literal) {
      await expect(paragraph).toHaveText(`${sample.marker}\n${sample.body}`);
    }
  }

  // Fulfill locally: verify the browser's actual navigation without contacting
  // external sites or sending messages to a live IM service.
  await page.context().route("https://example.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "URL navigation OK",
    })
  );
  await page.context().route("https://github.com/Ranwanglc/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "URL navigation OK",
    })
  );
  const popupPromise = page.waitForEvent("popup");
  await page
    .locator('[data-locate-message-row="true"] p')
    .filter({ hasText: "GH1651 screenshot" })
    .getByRole("link", {
      name: "https://github.com/Ranwanglc/octo-web",
      exact: true,
    })
    .click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL("https://github.com/Ranwanglc/octo-web");
  await popup.close();
  await message
    .locator("p")
    .filter({ hasText: "GH1651 screenshot" })
    .screenshot({
      path: test.info().outputPath("chinese-url-boundary.png"),
    });
});

test("@GH1651 @chat copy, edit punctuation and resend keeps automatic URLs as text", async ({
  authedPage: page,
}) => {
  const groupId = "e2e-url-copy";
  const groupName = "GH1651 copy test";
  const url = "https://github.com/Ranwanglc/octo-web";
  const source = `欧克，现在从${url}的main拉去分支，然后开发一下，先不推pr,干好了告诉我。`;
  await installMockImRuntime(page, {
    currentUid: "e2e-user-1",
    spaceId: "e2e-space-001",
    users: [
      { uid: "e2e-user-1", name: "E2E Tester", robot: 0 },
      { uid: "e2e-user-2", name: "E2E Sender", robot: 0 },
    ],
    groups: [{ group_no: groupId, name: groupName }],
    conversations: [
      {
        channelId: groupId,
        channelType: 2,
        unread: 0,
        timestamp: Math.floor(Date.now() / 1000),
      },
    ],
    messages: [],
    subscribers: [],
  });
  await page.getByRole("button", { name: "会话" }).click();
  await page.getByRole("button", { name: "最近", exact: true }).click();
  await page.getByText(groupName, { exact: true }).click();
  const editor = page.locator('[contenteditable="true"]');
  await editor.click();
  await page.keyboard.insertText(source);
  await editor.press("Enter");
  const sourceParagraph = page
    .locator('[data-locate-message-row="true"] .wk-markdown p')
    .filter({ hasText: source });
  await expect(sourceParagraph).toBeVisible();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await sourceParagraph.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press("Control+c");
  const clipboardHtml = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find((item) => item.types.includes("text/html"));
    return item ? (await item.getType("text/html")).text() : "";
  });
  expect(clipboardHtml).toContain('data-octo-autolink="true"');

  // The mock transport does not ACK sends. Start a fresh composer for the
  // resend; the browser clipboard retains the actual copied HTML across reload.
  await page.reload();
  await page.waitForFunction(() => (window as any).__MSW_READY__ === true);
  await page.getByRole("button", { name: "会话" }).click();
  await page.getByRole("button", { name: "最近", exact: true }).click();
  await page.getByText(groupName, { exact: true }).click();
  await editor.click();
  await editor.press("Control+v");
  await expect(editor).toHaveText(source);
  await expect(editor.locator("a")).toHaveCount(0);
  // Edit the pasted URL's boundary, exactly where the screenshot added a comma.
  await editor.evaluate((element, url) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent?.indexOf(url) ?? -1;
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index + url.length);
      range.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error("Copied URL missing from editor");
  }, url);
  await page.keyboard.insertText("，");
  const edited = source.replace(url, `${url}，`);
  await expect(editor).toHaveText(edited);
  await editor.press("Enter");
  const sent = page
    .locator('[data-locate-message-row="true"] .wk-markdown p')
    .filter({ hasText: edited });
  await expect(sent).toHaveText(edited);
  await expect(sent.getByRole("link")).toHaveCount(1);
  await expect(sent.getByRole("link")).toHaveText(url);
  await expect(sent.getByRole("link")).toHaveAttribute("href", url);
  await sent.screenshot({
    path: test.info().outputPath("copied-url-after-edit.png"),
  });
});
