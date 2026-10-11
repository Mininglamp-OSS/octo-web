import { test, expect } from "../../fixtures-authed";
import { installMockImRuntime } from "../../_kit/mock-im-runtime";

test("standalone browser chat has no native screenshot action and preserves normal composition", async ({ authedPage }) => {
  await installMockImRuntime(authedPage, {
    currentUid: "e2e-user-1", spaceId: "e2e-space-001",
    users: [{ uid: "e2e-user-1", name: "E2E Tester", robot: 0 }],
    groups: [{ group_no: "screenshot-browser", name: "Screenshot browser compatibility" }],
    conversations: [{ channelId: "screenshot-browser", channelType: 2, unread: 0, timestamp: Math.floor(Date.now() / 1000) }],
    messages: [], subscribers: [],
  });
  await authedPage.getByRole("button", { name: "会话", exact: true }).click();
  await authedPage.getByRole("button", { name: "最近", exact: true }).click();
  await authedPage.getByText("Screenshot browser compatibility", { exact: true }).click();
  const editor = authedPage.locator('.wk-conversation [contenteditable="true"]').last();
  await expect(editor).toBeVisible();
  await expect(authedPage.getByTestId("input-screenshot-btn")).toHaveCount(0);
  await expect(authedPage.getByRole("button", { name: /^(截图|Screenshot)$/ })).toHaveCount(0);
  await editor.fill("Browser chat still works");
  await expect(editor).toHaveText("Browser chat still works");
  await editor.press("Enter");
  await expect(authedPage.locator(".wk-conversation-messages").getByText("Browser chat still works", { exact: true })).toBeVisible();
});
