/* eslint-disable no-undef */
// C989: 顶部搜索 bot → 打开名片 → 点「发送消息」→ 断言外层搜索 modal 消失.
// bug fix: TabContacts BotDetailModal.onChat 加 hideModal 调用.
import { test, expect } from "../fixtures-authed";
import { installMockImRuntime } from "../_kit/mock-im-runtime";

// bot fixture: **已加好友的 bot** (issue #989 复现场景).
//   - TabContacts.renderItem 里 isBot(uid) === true 才走"点击开 BotDetailModal"分支;
//     isBot 是 channelInfoCache.get(uid).orgData.robot === 1 —— 所以要预热到 mock IM seed.
//   - BotDetailVM.isFriend=true 才显示"发送消息"按钮 —— follow=1.
const MOCK_BOT_UID = "e2e-bot-989";
const MOCK_BOT_NAME = "富贵儿测试 bot";

test("@C989 顶部搜索 bot → 名片发送消息 → 外层搜索弹窗关闭", async ({ authedPage }, testInfo) => {
  const kf = (name: string) =>
    testInfo.outputPath(`keyframes/${name}.png`);
  // 补 mock-im seed: 让 isBot(botUid) 返 true (chat 点击命中走开 BotDetailModal 分支)
  await installMockImRuntime(authedPage, {
    currentUid: "e2e-user-1",
    spaceId: "e2e-space-001",
    users: [
      {
        uid: MOCK_BOT_UID,
        name: MOCK_BOT_NAME,
        robot: 1,
      },
    ],
    groups: [],
    conversations: [],
    messages: [],
    subscribers: [],
  });

  // 装 case-specific handler 覆盖 /search/global 返 bot 命中
  await authedPage.evaluate(
    ({ botUid, botName }) => {
      type MSW = {
        worker: { use: (...h: unknown[]) => void };
        http: { get: (u: string, h: unknown) => unknown; post: (u: string, h: unknown) => unknown };
        HttpResponse: { json: (b: unknown) => unknown };
      };
      const w = globalThis as unknown as { __msw?: MSW };
      if (!w.__msw) throw new Error("MSW not ready");
      const { worker, http: h, HttpResponse: R } = w.__msw;
      worker.use(
        h.post("*/search/global", () =>
          R.json({
            friends: [
              {
                channel_id: botUid,
                channel_type: 1,
                channel_name: botName,
                is_bot: 1,
              },
            ],
            groups: [],
            messages: [],
            files: [],
          })
        ),
        h.get(`*/users/${botUid}`, () =>
          R.json({
            uid: botUid,
            name: botName,
            robot: 1,
            follow: 1,
          })
        )
      );
    },
    { botUid: MOCK_BOT_UID, botName: MOCK_BOT_NAME }
  );

  // 打开 chat 页 (fixture 已 goto /), SPA-nav 到 /chat
  await authedPage.getByRole("button", { name: "会话" }).click();

  // 顶部搜索按钮 (无 accessible name, 走 header 容器 scope)
  await authedPage.waitForSelector(".wk-chat-header-actions", { timeout: 10_000 });
  await authedPage.screenshot({ path: kf("01-chat-page"), fullPage: true });
  await authedPage.locator(".wk-chat-header-actions .wk-chat-header-btn").first().click();

  // 搜索 dialog
  const searchModal = authedPage.getByRole("dialog").filter({
    has: authedPage.getByPlaceholder(/搜索联系人/),
  });
  await expect(searchModal).toBeVisible({ timeout: 10_000 });
  await searchModal.getByPlaceholder(/搜索联系人/).fill("富贵儿");
  await authedPage.screenshot({ path: kf("02-search-hit"), fullPage: true });

  // 联系人命中项 — 点开 BotDetailModal
  const contactHit = searchModal.getByText(MOCK_BOT_NAME).first();
  await expect(contactHit).toBeVisible({ timeout: 10_000 });
  await contactHit.click();

  // BotDetailModal (定位靠 "发送消息" 按钮)
  const sendMsgBtn = authedPage.getByRole("button", { name: "发送消息" });
  await expect(sendMsgBtn).toBeVisible({ timeout: 10_000 });
  await authedPage.screenshot({ path: kf("03-bot-detail-modal"), fullPage: true });

  // 点「发送消息」触发 fix 路径:
  //   TabContacts.BotDetailModal.onChat → showConversation + setState({modal off}) + hideModal()
  await sendMsgBtn.click();

  // ⭐ 核心断言: 外层搜索 dialog 消失
  await expect(searchModal).toBeHidden({ timeout: 5_000 });
  await authedPage.screenshot({ path: kf("04-modal-closed"), fullPage: true });
});
