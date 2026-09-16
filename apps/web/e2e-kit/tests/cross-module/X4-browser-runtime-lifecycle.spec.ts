/* eslint-disable no-undef -- e2e code runs in Node */
// @caseId X4-browser-runtime-lifecycle
// @spec e2e-kit/case-specs/cross-module/X4-browser-runtime-lifecycle.md
import type { Page } from "@playwright/test";
import { test, expect, E2E_SID } from "../../fixtures-authed";
import { installMockImRuntime, type MockSeed } from "../../_kit/mock-im-runtime";
import { waitForMswReady } from "../../_lib/e2eReady";
import { registerCh6ChatClearUnread } from "../../msw-handlers/ch6-chat-clear-unread";

const GROUP_NAME = "Runtime browser group";

function seed(unread = 7): MockSeed {
  return {
    currentUid: "e2e-user-1",
    spaceId: "e2e-space-001",
    users: [{ uid: "e2e-user-1", name: "E2E Tester" }],
    groups: [{ group_no: "runtime-browser-group", name: GROUP_NAME }],
    conversations: [{
      channelId: "runtime-browser-group", channelType: 2, unread, timestamp: 100,
    }],
    messages: [],
    subscribers: [],
  };
}

async function openRecent(page: Page): Promise<void> {
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await page.getByRole("button", { name: /^最近/ }).click();
  await expect(page.getByText(GROUP_NAME, { exact: true })).toBeVisible();
}

test("@X4 @p1 @cross-module @runtime unread survives module unmount and reload", async ({ authedPage }) => {
  await authedPage.getByRole("button", { name: "通讯录", exact: true }).click();
  await expect(authedPage.getByText("全部联系人", { exact: true })).toBeVisible();
  await installMockImRuntime(authedPage, seed());
  await expect(authedPage).toHaveTitle(/^\(1\) /);

  for (let index = 0; index < 3; index++) {
    await openRecent(authedPage);
    await authedPage.getByRole("button", { name: "通讯录", exact: true }).click();
    await expect(authedPage.getByText("全部联系人", { exact: true })).toBeVisible();
    await expect(authedPage).toHaveTitle(/^\(1\) /);
  }

  await authedPage.reload();
  await expect(authedPage.getByText("全部联系人", { exact: true })).toBeVisible();
  await expect(authedPage).toHaveTitle(/^\(1\) /);
  await installMockImRuntime(authedPage, seed(0));
  await expect(authedPage).not.toHaveTitle(/^\(\d/);
  await openRecent(authedPage);
  await expect(authedPage.getByRole("button", { name: /^最近/ })).not.toContainText("7");
});

test("@X4 @p1 @cross-module @runtime browser Back and Forward restore unread titles", async ({ authedPage }) => {
  await installMockImRuntime(authedPage, seed());
  await openRecent(authedPage);
  await authedPage.getByRole("button", { name: "通讯录", exact: true }).click();
  await expect(authedPage.getByText("全部联系人", { exact: true })).toBeVisible();
  const contactsUrl = authedPage.url();
  await authedPage.getByRole("button", { name: "智能总结", exact: true }).click();
  await expect(authedPage).toHaveURL(/\/summary/);
  await expect(authedPage).toHaveTitle(/^\(1\) /);
  const summaryUrl = authedPage.url();

  await authedPage.goBack();
  await expect(authedPage).toHaveURL(contactsUrl);
  await expect(authedPage.getByText("全部联系人", { exact: true })).toBeVisible();
  await expect(authedPage).toHaveTitle(/^\(1\) /);
  await authedPage.goForward();
  await expect(authedPage).toHaveURL(summaryUrl);
  await expect(authedPage).toHaveTitle(/^\(1\) /);
});

test("@X4 @p1 @cross-module @runtime clearing unread in another tab updates an inactive module", async ({ authedPage }) => {
  await authedPage.getByRole("button", { name: "通讯录", exact: true }).click();
  await installMockImRuntime(authedPage, seed());
  await expect(authedPage).toHaveTitle(/^\(1\) /);

  const peer = await authedPage.context().newPage();
  try {
    await peer.goto(`/?sid=${E2E_SID}`);
    await waitForMswReady(peer);
    await installMockImRuntime(peer, seed());
    await registerCh6ChatClearUnread(peer);
    await openRecent(peer);
    await expect(peer).toHaveTitle(/^\(1\) /);
    await peer.getByText(GROUP_NAME, { exact: true }).click({ button: "right" });
    await peer.getByText("清除未读", { exact: true }).click();
    await expect(peer).not.toHaveTitle(/^\(\d/);
    await expect(authedPage).not.toHaveTitle(/^\(\d/);
    await authedPage.bringToFront();
    await expect(authedPage.getByText("全部联系人", { exact: true })).toBeVisible();
    await openRecent(authedPage);
    await expect(authedPage).not.toHaveTitle(/^\(\d/);
  } finally {
    await peer.close();
  }
});
