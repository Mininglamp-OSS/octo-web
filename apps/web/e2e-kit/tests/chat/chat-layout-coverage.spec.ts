/* eslint-disable no-undef -- e2e code runs in Node */
import { test, expect } from "../../fixtures-authed";
import { installMockImRuntime, type MockSeed } from "../../_kit/mock-im-runtime";
import { registerChatLayoutFollowData, registerChatFollowUnfollowFixture, registerChatFollowSortFixture, registerChatLayoutSearchResult, registerChatLayoutThreadCreate, registerChatLayoutGroupCreate } from "../../msw-handlers/chat-layout";
import { registerS22SummaryChatPanelHistoryDetail } from "../../msw-handlers/s22-summary-chat-panel-history-detail";

const GROUP_ID = "e2e-chat-layout-group";
const GROUP_NAME = "E2E Chat 布局群";
const RECENT_ONLY_GROUP_ID = "e2e-chat-layout-recent-only";
const RECENT_ONLY_GROUP_NAME = "E2E 最近未关注群";
function seed(): MockSeed { return { currentUid: "e2e-user-1", spaceId: "e2e-space-001",
  users: [{ uid: "e2e-user-1", name: "E2E Tester", robot: 0 }, { uid: "e2e-user-2", name: "E2E Sender", robot: 0 }],
  groups: [{ group_no: GROUP_ID, name: GROUP_NAME }],
  conversations: [{ channelId: GROUP_ID, channelType: 2, unread: 0, timestamp: Math.floor(Date.now() / 1000) }],
  messages: [{ channelId: GROUP_ID, channelType: 2, messageSeq: 1, fromUid: "e2e-user-2",
    content: { type: 1, text: "E2E 搜索命中消息" } }], subscribers: [] }; }

function sortSeed(): MockSeed { return { currentUid: "e2e-user-1", spaceId: "e2e-space-001",
  users: [{ uid: "e2e-user-1", name: "E2E Tester", robot: 0 }],
  groups: [{ group_no: "e2e-chat-layout-group-a", name: "E2E 关注群 A" }, { group_no: "e2e-chat-layout-group-b", name: "E2E 关注群 B" }],
  conversations: [
    { channelId: "e2e-chat-layout-group-a", channelType: 2, unread: 0, timestamp: 1720000000 },
    { channelId: "e2e-chat-layout-group-b", channelType: 2, unread: 0, timestamp: 1720000000 },
  ], messages: [], subscribers: [] }; }

function recentAndFollowSeed(): MockSeed {
  const base = seed();
  return {
    ...base,
    groups: [...base.groups, { group_no: RECENT_ONLY_GROUP_ID, name: RECENT_ONLY_GROUP_NAME }],
    conversations: [...base.conversations, {
      channelId: RECENT_ONLY_GROUP_ID, channelType: 2, unread: 0,
      timestamp: Math.floor(Date.now() / 1000) - 10,
    }],
  };
}

async function openChat(page: Parameters<typeof installMockImRuntime>[0]) {
  await page.getByRole("button", { name: "会话" }).click();
  await expect(page.getByRole("button", { name: /最近/ })).toBeVisible();
}
async function openConversation(page: Parameters<typeof installMockImRuntime>[0], reload = true) {
  await installMockImRuntime(page, seed());
  if (reload) await page.reload();
  await openChat(page);
  await page.getByRole("button", { name: "最近", exact: true }).click();
  await expect(page.getByText(GROUP_NAME, { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByText(GROUP_NAME, { exact: true }).click();
  await expect(page.locator('[contenteditable="true"]')).toBeVisible({ timeout: 15_000 });
}

async function registerChannelSettingUserInfo(
  page: Parameters<typeof installMockImRuntime>[0],
) {
  await page.evaluate(() => {
    type Msw = {
      worker: { use: (...handlers: unknown[]) => void };
      http: { get: (path: string, resolver: () => unknown) => unknown };
      HttpResponse: { json: (body: unknown) => unknown };
    };
    const msw = (window as unknown as { __msw?: Msw }).__msw;
    if (!msw) throw new Error("[chat-layout] MSW worker 未就绪");
    msw.worker.use(
      msw.http.get("*/users/e2e-user-2", () =>
        msw.HttpResponse.json({
          uid: "e2e-user-2",
          name: "E2E Sender",
          short_no: "e2e-2001",
          robot: 0,
          extra: {},
        }),
      ),
    );
  });
}


test("@CH21 @p1 @chat @sidebar 顶部搜索和添加入口打开面板", async ({ authedPage }) => {
  await openChat(authedPage);
  await authedPage.getByTestId("chat-global-search-entry").click();
  await expect(authedPage.getByRole("dialog").filter({ has: authedPage.getByPlaceholder(/搜索联系人/) })).toBeVisible();
  await authedPage.keyboard.press("Escape");
  await authedPage.getByTestId("chat-add-entry").click();
  await expect(authedPage.getByRole("list").getByText("发起群聊", { exact: true })).toBeVisible();
});

test("@CH34 @p1 @chat @sidebar @group-create 发起群聊完成创建", async ({ authedPage }) => {
  await registerChatLayoutGroupCreate(authedPage);
  await openChat(authedPage);
  await authedPage.getByTestId("chat-add-entry").click();
  await authedPage.getByRole("list").getByText("发起群聊", { exact: true }).click();
  const dialog = authedPage.locator(".octo-ui-modal__content").filter({ hasText: "发起群聊" });
  await expect(dialog).toBeVisible();
  await dialog.locator("input").first().fill("E2E 新建群");
  await dialog.getByText("E2E 建群成员", { exact: true }).click();
  await dialog.getByRole("button", { name: "确定" }).last().click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(authedPage.getByRole("heading", { name: "E2E 新建群" })).toBeVisible({ timeout: 15_000 });
});

test("@CH22 @p1 @chat @sidebar @follow 关注 Tab 展示已关注会话", async ({ authedPage }) => {
  await installMockImRuntime(authedPage, seed()); await registerChatLayoutFollowData(authedPage); await authedPage.reload(); await openChat(authedPage);
  await authedPage.getByRole("button", { name: "关注", exact: true }).click();
  await expect(authedPage.getByText(GROUP_NAME, { exact: true })).toBeVisible({ timeout: 15_000 });
});

test("@CH35 @p1 @chat @sidebar @follow 关注 Tab 展示真实关注会话", async ({ authedPage }) => {
  await installMockImRuntime(authedPage, recentAndFollowSeed()); await registerChatLayoutFollowData(authedPage); await authedPage.reload(); await openChat(authedPage);
  await authedPage.getByRole("button", { name: "最近", exact: true }).click();
  await expect(authedPage.getByText(GROUP_NAME, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(authedPage.getByText(RECENT_ONLY_GROUP_NAME, { exact: true })).toBeVisible({ timeout: 15_000 });
  await registerChatLayoutFollowData(authedPage);
  await authedPage.getByRole("button", { name: "关注", exact: true }).click();
  await expect(authedPage.getByText(GROUP_NAME, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(authedPage.getByText(RECENT_ONLY_GROUP_NAME, { exact: true })).toHaveCount(0);
});

test("@CH41 @p1 @chat @sidebar @follow 取消关注后会话从关注列表移除", async ({ authedPage }) => {
  await installMockImRuntime(authedPage, seed()); await registerChatFollowUnfollowFixture(authedPage); await authedPage.reload(); await openChat(authedPage);
  await authedPage.getByRole("button", { name: "关注", exact: true }).click();
  const item = authedPage.getByText(GROUP_NAME, { exact: true });
  await expect(item).toBeVisible({ timeout: 15_000 });
  await item.click({ button: "right" });
  await authedPage.getByText("取消关注", { exact: true }).click();
  await expect(item).toBeHidden({ timeout: 15_000 });
});

test("@CH42 @p1 @chat @sidebar @follow 关注会话拖拽后按新顺序展示", async ({ authedPage }) => {
  await installMockImRuntime(authedPage, sortSeed()); await registerChatFollowSortFixture(authedPage); await authedPage.reload(); await openChat(authedPage);
  await authedPage.getByRole("button", { name: "关注", exact: true }).click();
  const a = authedPage.locator('.wk-conv-compact-item[data-object-id="e2e-chat-layout-group-a"]');
  const b = authedPage.locator('.wk-conv-compact-item[data-object-id="e2e-chat-layout-group-b"]');
  await expect(a).toBeVisible({ timeout: 15_000 }); await expect(b).toBeVisible({ timeout: 15_000 });
  const initialA = await a.boundingBox();
  const initialB = await b.boundingBox();
  if (!initialA || !initialB || initialA.y >= initialB.y) throw new Error("关注会话初始顺序不是 A → B");
  const from = await a.locator(".wk-conv-compact-drag-handle").boundingBox();
  const to = await b.locator(".wk-conv-compact-drag-handle").boundingBox();
  if (!from || !to) throw new Error("关注会话排序拖拽 handle 不可见");
  const sortResponse = authedPage.waitForResponse((response) =>
    response.request().method() === "PUT" &&
    new URL(response.url()).pathname.endsWith("/follow/sort") &&
    response.status() === 200
  );
  await authedPage.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await authedPage.mouse.down();
  await authedPage.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await authedPage.mouse.up();
  const sortRequest = await sortResponse;
  const payload = sortRequest.request().postDataJSON() as {
    items?: Array<{ target_id?: string; sort?: number }>;
  };
  const requestOrder = (payload.items ?? [])
    .filter((item) => typeof item.target_id === "string" && typeof item.sort === "number")
    .sort((left, right) => (left.sort ?? 0) - (right.sort ?? 0))
    .map((item) => item.target_id);
  expect(requestOrder).toEqual([
    "e2e-chat-layout-group-b",
    "e2e-chat-layout-group-a",
  ]);
  await expect.poll(async () => {
    const aBox = await a.boundingBox();
    const bBox = await b.boundingBox();
    return aBox && bBox ? bBox.y < aBox.y : false;
  }).toBe(true);
});

test("@CH23 @p1 @chat @conversation 详情顶部显示标题并打开群详情", async ({ authedPage }) => {
  await openConversation(authedPage); await expect(authedPage.locator(".wk-chat-conversation-header-channel-info-name", { hasText: GROUP_NAME })).toBeVisible();
  await authedPage.getByTestId("chat-channel-setting-entry").click();
  await expect(authedPage.locator(".wk-chat-content-right")).toHaveClass(/wk-chat-channelsetting-open/);
});

test(
  "@CH43 @p1 @chat @conversation 群详情遮罩覆盖聊天浮动按钮",
  async ({ authedPage }) => {
    await installMockImRuntime(authedPage, {
      ...seed(),
      subscribers: [
        {
          uid: "e2e-user-1",
          name: "E2E Tester",
          channelId: GROUP_ID,
          channelType: 2,
          role: 1,
          status: 1,
        },
        {
          uid: "e2e-user-2",
          name: "E2E Sender",
          channelId: GROUP_ID,
          channelType: 2,
          status: 1,
        },
      ],
    });
    await registerChannelSettingUserInfo(authedPage);
    await openChat(authedPage);
    await authedPage
      .getByRole("button", { name: "最近", exact: true })
      .click();
    await authedPage.getByText(GROUP_NAME, { exact: true }).click();

    const messages = authedPage.locator(".wk-conversation-messages");
    await expect(messages).toBeVisible({ timeout: 15_000 });
    await messages.evaluate((element) => {
      Object.defineProperties(element, {
        scrollHeight: { configurable: true, value: 2_000 },
        clientHeight: { configurable: true, value: 600 },
      });
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    const scrollPositionView = authedPage.locator(
      ".wk-conversationpositionview",
    );
    const scrollButton = scrollPositionView
      .locator(".wk-conversationpositionview-item")
      .last();
    await expect(scrollButton).toHaveClass(/wk-reveale/);

    const channelSettingEntry = authedPage.getByTestId(
      "chat-channel-setting-entry",
    );
    await channelSettingEntry.click();
    const mask = authedPage.getByTestId("chat-channel-setting-mask");
    const panel = authedPage.locator(".wk-chat-channelsetting");
    await expect(mask).toBeVisible();
    await expect(panel).toBeVisible();
    await expect(panel).toBeFocused();
    await expect(panel).toHaveAttribute("aria-modal", "true");
    await expect(authedPage.locator(".wk-chat-content-chat")).toHaveAttribute(
      "inert",
      "",
    );
    await authedPage.keyboard.press("Shift+Tab");
    await expect
      .poll(() =>
        panel.evaluate((element) => element.contains(document.activeElement)),
      )
      .toBe(true);
    await authedPage.keyboard.press("Tab");
    await expect
      .poll(() =>
        panel.evaluate((element) => element.contains(document.activeElement)),
      )
      .toBe(true);

    const scrollButtonBox = await scrollButton.boundingBox();
    if (!scrollButtonBox) throw new Error("滚动到底部按钮没有可验证的布局位置");
    const panelCoversScrollButton = await panel.evaluate(
      (element, point) =>
        element.contains(document.elementFromPoint(point.x, point.y)),
      {
        x: scrollButtonBox.x + scrollButtonBox.width / 2,
        y: scrollButtonBox.y + scrollButtonBox.height / 2,
      },
    );
    expect(panelCoversScrollButton).toBe(true);

    const chatBox = await authedPage.locator(".wk-chat-content-chat").boundingBox();
    if (!chatBox) throw new Error("聊天区域没有可验证的布局位置");
    const maskCoversChatPane = await mask.evaluate(
      (element, point) => element === document.elementFromPoint(point.x, point.y),
      {
        x: chatBox.x + Math.min(80, chatBox.width / 2),
        y: chatBox.y + Math.min(80, chatBox.height / 2),
      },
    );
    expect(maskCoversChatPane).toBe(true);

    const member = panel
      .locator(".wk-subscribers-item")
      .filter({ hasText: "E2E Sender" });
    await expect(member).toBeVisible();
    await member.click();
    const userInfoModal = authedPage
      .locator(".octo-ui-modal__content")
      .filter({ hasText: "E2E Sender" });
    await expect(userInfoModal).toBeVisible();
    const userInfoAction = userInfoModal.locator("button").first();
    await expect(userInfoAction).toBeVisible();
    await userInfoAction.focus();
    await authedPage.keyboard.press("Tab");
    await expect
      .poll(() =>
        userInfoModal.evaluate((element) =>
          element.contains(document.activeElement),
        ),
      )
      .toBe(true);
    await authedPage.keyboard.press("Escape");
    await expect(userInfoModal).toBeHidden();
    await expect(mask).toBeVisible();

    await panel.focus();
    await authedPage.keyboard.press("Escape");
    await expect(mask).toHaveCount(0);
    await expect(channelSettingEntry).toBeFocused();

    await channelSettingEntry.click();
    await mask.click({ position: { x: 8, y: 8 } });
    await expect(mask).toHaveCount(0);
    await expect(
      authedPage.locator(".wk-chat-content-right"),
    ).not.toHaveClass(/wk-chat-channelsetting-open/);

    await authedPage.getByTestId("chat-thread-panel-entry").click();
    await expect(authedPage.getByText("子区", { exact: true })).toBeVisible();
  },
);

test("@CH24 @p1 @chat @thread 群详情顶部打开子区列表", async ({ authedPage }) => {
  await openConversation(authedPage); await authedPage.getByTestId("chat-thread-panel-entry").click();
  await expect(authedPage.getByText("子区", { exact: true })).toBeVisible({ timeout: 15_000 });
});

test("@CH32 @p1 @chat @thread 创建子区后列表显示新子区", async ({ authedPage }) => {
  await installMockImRuntime(authedPage, seed()); await authedPage.reload();
  await registerChatLayoutThreadCreate(authedPage);
  await openConversation(authedPage, false, true);
  await authedPage.getByTestId("chat-thread-panel-entry").click();
  await authedPage.getByText("新建子区", { exact: true }).click();
  const dialog = authedPage.locator(".wk-thread-modal");
  await expect(dialog).toBeVisible();
  await dialog.locator("input").fill("E2E 新建子区");
  await dialog.getByRole("button", { name: "创建" }).click();
  await expect(authedPage.getByText("E2E 新建子区", { exact: true })).toBeVisible({ timeout: 15_000 });
});

test("@CH25 @p1 @chat @search 会话搜索输入关键词后展示空结果", async ({ authedPage }) => {
  await installMockImRuntime(authedPage, seed()); await registerChatLayoutFollowData(authedPage); await authedPage.reload();
  await openConversation(authedPage, false); await authedPage.getByTestId("channel-search-entry").click();
  await authedPage.getByPlaceholder("输入关键字搜索").fill("不存在的消息");
  await expect(authedPage.getByText("暂无匹配结果", { exact: true })).toBeVisible({ timeout: 15_000 });
});

test("@CH28 @p1 @chat @search 会话搜索结果可定位回消息", async ({ authedPage }) => {
  await installMockImRuntime(authedPage, seed()); await authedPage.reload();
  await registerChatLayoutSearchResult(authedPage);
  await openConversation(authedPage, false);
  await authedPage.getByTestId("channel-search-entry").click();
  await authedPage.getByPlaceholder("输入关键字搜索").fill("搜索命中");
  await expect(authedPage.getByText("E2E 搜索命中消息", { exact: true })).toBeVisible({ timeout: 15_000 });
  const searchResult = authedPage.locator(".wk-channel-search-message-result").filter({ hasText: "E2E 搜索命中消息" });
  await searchResult.hover();
  await searchResult.getByRole("button", { name: "定位到聊天" }).click();
  await expect(authedPage.locator(".wk-chat-channel-search-panel")).toBeVisible();
  await expect(searchResult.getByRole("button", { name: "定位到聊天" })).toBeVisible();
});

test("@CH26 @p1 @chat @summary 详情顶部打开 Summary 面板", async ({ authedPage }) => {
  await installMockImRuntime(authedPage, seed()); await authedPage.reload();
  await registerS22SummaryChatPanelHistoryDetail(authedPage);
  await openConversation(authedPage, false); await authedPage.getByTestId("summary-chat-panel-header-btn").click();
  await expect(authedPage.getByTestId("summary-chat-panel")).toBeVisible({ timeout: 15_000 });
});
