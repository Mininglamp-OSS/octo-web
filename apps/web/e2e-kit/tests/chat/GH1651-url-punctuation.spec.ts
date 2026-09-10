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
  // example.com or sending messages to a live IM service.
  await page.context().route("https://example.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "URL navigation OK",
    })
  );
  const popupPromise = page.waitForEvent("popup");
  await page
    .locator('[data-locate-message-row="true"]')
    .filter({ hasText: "GH1651 boundaries" })
    .getByRole("link", { name: "https://example.com/a", exact: true })
    .click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL("https://example.com/a");
  await popup.close();
});
