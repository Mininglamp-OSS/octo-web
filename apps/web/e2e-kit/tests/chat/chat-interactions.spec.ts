/* eslint-disable no-undef -- e2e code runs in Node */
// @spec apps/web/e2e-kit/case-specs/chat/CH9-chat-message-context-menu.md
// @spec apps/web/e2e-kit/case-specs/chat/CH11-chat-mention-candidates.md
// @spec apps/web/e2e-kit/case-specs/chat/CH12-chat-reply-message.md
// @spec apps/web/e2e-kit/case-specs/chat/CH13-chat-message-reaction.md
// @spec apps/web/e2e-kit/case-specs/chat/CH14-chat-message-forward.md
// @spec apps/web/e2e-kit/case-specs/chat/CH15-chat-message-revoke.md
// @spec apps/web/e2e-kit/case-specs/chat/CH16-chat-message-multiselect.md
// @spec apps/web/e2e-kit/case-specs/chat/CH17-chat-composer-emoji-send.md
// @spec apps/web/e2e-kit/case-specs/chat/CH18-chat-composer-attachment.md
// @spec apps/web/e2e-kit/case-specs/chat/CH19-chat-thread-create.md
// @spec apps/web/e2e-kit/case-specs/chat/CH20-chat-channel-search.md
// @spec apps/web/e2e-kit/case-specs/chat/CH29-chat-composer-emoji-submit.md
import { test, expect } from "../../fixtures-authed";
import {
  installMockImRuntime,
  type MockSeed,
} from "../../_kit/mock-im-runtime";
import { registerCh9ChatMessageHistory } from "../../msw-handlers/ch9-chat-message-history";
import { registerChatLifecycleHandlers } from "../../msw-handlers/chat-layout";

const GROUP_ID = "e2e-chat-context-menu-group";
const GROUP_NAME = "E2E Chat 消息群";
const HISTORY_MESSAGE = "E2E 历史文本消息";

function seed(currentRole = 0): MockSeed {
  return {
    currentUid: "e2e-user-1",
    spaceId: "e2e-space-001",
    users: [
      { uid: "e2e-user-1", name: "E2E Tester", robot: 0 },
      { uid: "e2e-user-2", name: "E2E Sender", robot: 0 },
    ],
    groups: [{ group_no: GROUP_ID, name: GROUP_NAME }],
    conversations: [
      {
        channelId: GROUP_ID,
        channelType: 2,
        unread: 0,
        timestamp: Math.floor(Date.now() / 1000),
      },
    ],
    messages: [
      {
        channelId: GROUP_ID,
        channelType: 2,
        messageSeq: 1,
        fromUid: "e2e-user-2",
        content: { type: 1, text: HISTORY_MESSAGE },
      },
    ],
    subscribers: [
      {
        channelId: GROUP_ID,
        channelType: 2,
        uid: "e2e-user-1",
        name: "E2E Tester",
        role: currentRole,
      },
      {
        channelId: GROUP_ID,
        channelType: 2,
        uid: "e2e-user-2",
        name: "E2E Sender",
      },
    ],
  };
}

function forwardSeed(): MockSeed {
  const base = seed();
  return {
    ...base,
    groups: [...base.groups, { group_no: "e2e-forward-target", name: "E2E 转发目标群" }],
    conversations: [...base.conversations, {
      channelId: "e2e-forward-target", channelType: 2, unread: 0,
      timestamp: Math.floor(Date.now() / 1000) - 10,
    }],
  };
}

async function openConversation(
  page: Parameters<typeof installMockImRuntime>[0],
  mockSeed: MockSeed,
  expectHistory = false
) {
  await installMockImRuntime(page, mockSeed);
  await page.getByRole("button", { name: "会话" }).click();
  const recentTab = page.getByRole("button", { name: "最近", exact: true });
  await expect(recentTab).toBeVisible();
  await recentTab.click();
  await expect(page.getByText(GROUP_NAME, { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByText(GROUP_NAME, { exact: true }).click();
  if (expectHistory) {
    await expect(page.getByText(HISTORY_MESSAGE, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  } else {
    await expect(page.locator('[contenteditable="true"]')).toBeVisible({
      timeout: 15_000,
    });
  }
}

test("@CH10 @p1 @chat @composer Shift+Enter 插入换行而不发送", async ({
  authedPage,
}) => {
  await openConversation(authedPage, seed());
  const editor = authedPage.locator('[contenteditable="true"]');
  await editor.click();
  await editor.pressSequentially("第一行");
  await editor.press("Shift+Enter");
  await editor.pressSequentially("第二行");

  await expect(editor).toContainText("第一行");
  await expect(editor).toContainText("第二行");
  await expect(
    authedPage.locator('[data-locate-message-row="true"]').getByText("第一行", { exact: true })
  ).toHaveCount(0);
});

test("@CH9 @p1 @chat @message-context-menu 消息右键菜单提供消息操作", async ({
  authedPage,
}) => {
  await registerCh9ChatMessageHistory(authedPage);
  await openConversation(authedPage, seed(), true);
  const message = authedPage.getByText(HISTORY_MESSAGE, { exact: true });
  await message.click({ button: "right" });

  await expect(authedPage.getByTestId("ctx-message-copy")).toBeVisible();
  await expect(authedPage.getByText("回复", { exact: true })).toBeVisible();
  await expect(authedPage.getByTestId("ctx-message-forward")).toBeVisible();
  await expect(authedPage.getByTestId("ctx-message-multiselect")).toBeVisible();
});

test("@CH11 @p1 @chat @composer @mention 输入 @ 后显示群成员候选", async ({
  authedPage,
}) => {
  await registerCh9ChatMessageHistory(authedPage);
  await openConversation(authedPage, seed(), true);
  const editor = authedPage.locator('[contenteditable="true"]');
  await editor.click();
  await editor.pressSequentially("@");

  await expect(authedPage.getByRole("listbox")).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    authedPage.getByRole("option", { name: "E2E Sender" })
  ).toBeVisible();
});

test("@CH12 @p1 @chat @message-context-menu 回复消息后显示回复态", async ({
  authedPage,
}) => {
  await registerCh9ChatMessageHistory(authedPage);
  await openConversation(authedPage, seed(), true);
  await authedPage
    .getByText(HISTORY_MESSAGE, { exact: true })
    .click({ button: "right" });
  await authedPage.getByText("回复", { exact: true }).click();

  const replyView = authedPage.locator(".wk-replyview-new");
  await expect(replyView).toBeVisible();
  await expect(replyView).toContainText("E2E Sender");
  await expect(replyView).toContainText(HISTORY_MESSAGE);
});

async function openMessageMenu(
  page: Parameters<typeof installMockImRuntime>[0],
  mockSeed: MockSeed = seed()
) {
  await registerCh9ChatMessageHistory(page);
  await openConversation(page, mockSeed, true);
  await page
    .getByText(HISTORY_MESSAGE, { exact: true })
    .click({ button: "right" });
}


test("@CH13 @p1 @chat @reaction 消息菜单打开贴表情选择器", async ({
  authedPage,
}) => {
  await openMessageMenu(authedPage);
  await authedPage.getByText("贴表情", { exact: true }).click();
  await expect(authedPage.getByRole("dialog")).toBeVisible();
  await expect(
    authedPage.locator(".wk-msg-reaction-picker-cell").first()
  ).toBeVisible();
});

test("@CH14 @p1 @chat @forward 消息菜单打开转发面板", async ({
  authedPage,
}) => {
  await openMessageMenu(authedPage);
  await authedPage.getByTestId("ctx-message-forward").click();
  await expect(
    authedPage.locator("#semi-modal-body").getByText("转发", { exact: true })
  ).toBeVisible();
});

test("@CH37 @p1 @chat @forward 选择目标并完成转发", async ({ authedPage }) => {
  await registerChatLifecycleHandlers(authedPage);
  await registerCh9ChatMessageHistory(authedPage);
  await openConversation(authedPage, forwardSeed(), true);
  await authedPage.getByText(HISTORY_MESSAGE, { exact: true }).click({ button: "right" });
  await authedPage.getByTestId("ctx-message-forward").click();
  const modal = authedPage.locator(".wk-fm");
  await expect(modal).toBeVisible();
  const confirm = modal.getByRole("button", { name: "确认", exact: true });
  await expect(confirm).toBeDisabled();
  await modal.getByText("全部群聊", { exact: true }).click();
  await modal.locator(".wk-fm-item").filter({ hasText: "E2E 转发目标群" }).click();
  const selectedConfirm = modal.getByRole("button", { name: /确认\(1\)/ });
  await expect(selectedConfirm).toBeEnabled();
  await selectedConfirm.click();
  await expect(modal).toBeHidden({ timeout: 15_000 });
});

test("@CH15 @p1 @chat @message-context-menu 自己的消息显示撤回入口", async ({
  authedPage,
}) => {
  await registerCh9ChatMessageHistory(authedPage, "e2e-user-1");
  await openConversation(authedPage, seed(1), true);
  await authedPage
    .getByText(HISTORY_MESSAGE, { exact: true })
    .click({ button: "right" });
  await expect(authedPage.getByText("撤回", { exact: true })).toBeVisible();
});

test("@CH40 @p1 @chat @message-lifecycle 撤回消息后显示撤回态", async ({ authedPage }) => {
  await registerChatLifecycleHandlers(authedPage);
  await registerCh9ChatMessageHistory(authedPage, "e2e-user-1");
  await openConversation(authedPage, seed(1), true);
  await authedPage.getByText(HISTORY_MESSAGE, { exact: true }).click({ button: "right" });
  await authedPage.getByText("撤回", { exact: true }).click();
  await expect(authedPage.getByText("你撤回了一条消息", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(authedPage.getByText(HISTORY_MESSAGE, { exact: true })).toHaveCount(0);
});

test("@CH16 @p1 @chat @message-context-menu 消息菜单进入多选模式", async ({
  authedPage,
}) => {
  await openMessageMenu(authedPage);
  await authedPage.getByTestId("ctx-message-multiselect").click();
  await expect(authedPage.getByTestId("multiselect-forward-btn")).toBeVisible();
  await expect(
    authedPage.getByTestId("multiselect-mergeforward-btn")
  ).toBeVisible();
});

test("@CH17 @p1 @chat @composer @emoji 选择输入表情后保留在编辑器", async ({
  authedPage,
}) => {
  await openConversation(authedPage, seed());
  await authedPage.locator(".wk-emojitoolbar .wk-iconclick").click();
  await expect(
    authedPage.locator(".wk-emojitoolbar-emojipanel-show")
  ).toBeVisible();
  const emojiButton = authedPage.locator(".wk-emojipanel-content li").first();
  await emojiButton.click();
  await expect(authedPage.locator('[contenteditable="true"]')).not.toHaveText(
    ""
  );
});

test("@CH29 @p1 @chat @composer @emoji 选择表情并提交后消息流出现新消息", async ({
  authedPage,
}) => {
  await openConversation(authedPage, seed());
  await authedPage.locator(".wk-emojitoolbar .wk-iconclick").click();
  const emojiButton = authedPage.locator(".wk-emojipanel-content li").first();
  await emojiButton.click();
  const editor = authedPage.locator('[contenteditable="true"]');
  await expect(editor).not.toHaveText("");
  const submittedText = await editor.innerText();
  await editor.press("Enter");
  await expect(editor).toHaveText("");
  await expect(authedPage.getByRole("img", { name: submittedText }))
    .toHaveCount(1, { timeout: 15_000 });
});

test("@CH18 @p1 @chat @composer @attachment 选择附件后显示待发送附件", async ({
  authedPage,
}) => {
  await openConversation(authedPage, seed());
  const fileInput = authedPage.locator('input[type="file"]').first();
  await fileInput.setInputFiles({
    name: "E2E 附件.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("e2e"),
  });
  await expect(
    authedPage.getByText("E2E 附件.txt", { exact: true })
  ).toBeVisible();
});

test("@CH38 @p1 @chat @composer @attachment 附件上传并发送后保留文件消息", async ({ authedPage }) => {
  await registerChatLifecycleHandlers(authedPage);
  await openConversation(authedPage, seed());
  const filename = "E2E 发送附件.txt";
  await authedPage.locator('input[type="file"]').first().setInputFiles({
    name: filename, mimeType: "text/plain", buffer: Buffer.from("e2e"),
  });
  const composerPreview = authedPage.locator(".wk-messageinput-box").getByText(filename, { exact: true });
  await expect(composerPreview).toBeVisible();
  await authedPage.locator('[contenteditable="true"]').press("Enter");
  await expect(composerPreview).toHaveCount(0, { timeout: 15_000 });
  await expect(authedPage.locator(".wk-message-item").filter({ hasText: filename })).toBeVisible({ timeout: 15_000 });
});

test("@CH39 @p1 @chat @message-lifecycle 多选删除消息后消息流移除", async ({ authedPage }) => {
  await registerChatLifecycleHandlers(authedPage);
  await openMessageMenu(authedPage);
  await authedPage.getByTestId("ctx-message-multiselect").click();
  await authedPage.getByTestId("multiselect-delete-btn").click();
  const confirm = authedPage.locator(".semi-modal-wrap").last();
  await expect(confirm).toBeVisible();
  await confirm.locator("button").last().click();
  await expect(authedPage.getByText(HISTORY_MESSAGE, { exact: true })).toHaveCount(0, { timeout: 15_000 });
});

test("@CH19 @p1 @chat @thread 消息菜单打开创建子区弹窗", async ({
  authedPage,
}) => {
  await openMessageMenu(authedPage);
  await authedPage.getByTestId("ctx-message-create-thread").click();
  await expect(
    authedPage
      .locator("#semi-modal-body")
      .getByText(/创建子区|新建子区/, { exact: false })
  ).toBeVisible();
});

test("@CH20 @p1 @chat @search 打开会话内搜索", async ({ authedPage }) => {
  await openConversation(authedPage, seed());
  await authedPage.getByTestId("channel-search-entry").click();
  await expect(authedPage.locator(".wk-channel-search-panel")).toBeVisible();
  await expect(authedPage.getByPlaceholder("输入关键字搜索")).toBeVisible();
});
