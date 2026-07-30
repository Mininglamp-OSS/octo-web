/* eslint-disable no-undef */
// spec: apps/web/e2e-kit/case-specs/TES8-profile-online-status.md
import { test, expect } from "../fixtures-authed";
import { installMockImRuntime } from "../_kit/mock-im-runtime";

const HUMAN_ONLINE_UID = "tes8-human-online";
const HUMAN_OFFLINE_UID = "tes8-human-offline";
const BOT_ONLINE_UID = "tes8-bot-online";
const SELF_UID = "e2e-user-1";

const HUMAN_ONLINE_NAME = "TES8 在线成员";
const HUMAN_OFFLINE_NAME = "TES8 离线成员";
const BOT_ONLINE_NAME = "TES8 Bot 在线";
const SELF_NAME = "E2E Tester";

test("@TES8 @p0 @chat @profile 资料详情在线状态专用 e2e", async ({ authedPage }, testInfo) => {
  const kf = (name: string) => testInfo.outputPath(`keyframes/${name}.png`);
  const nowSec = Math.floor(Date.now() / 1000);

  await installMockImRuntime(authedPage, {
    currentUid: SELF_UID,
    spaceId: "e2e-space-001",
    users: [
      {
        uid: HUMAN_ONLINE_UID,
        name: HUMAN_ONLINE_NAME,
        robot: 0,
        online: 1,
        last_offline: nowSec - 86400,
        realname_verified: 1,
        real_name: HUMAN_ONLINE_NAME,
        short_no: "tes8_online",
      },
      {
        uid: HUMAN_OFFLINE_UID,
        name: HUMAN_OFFLINE_NAME,
        robot: 0,
        online: 0,
        last_offline: nowSec - 2 * 3600,
        short_no: "tes8_offline",
      },
      {
        uid: BOT_ONLINE_UID,
        name: BOT_ONLINE_NAME,
        robot: 1,
        online: 1,
        last_offline: nowSec - 86400,
        short_no: "tes8_bot_online",
      },
      {
        uid: SELF_UID,
        name: SELF_NAME,
        robot: 0,
        online: 1,
        last_offline: nowSec - 86400,
        realname_verified: 1,
        real_name: SELF_NAME,
        short_no: "10000",
      },
    ],
    groups: [],
    conversations: [],
    messages: [],
    subscribers: [],
  });

  await authedPage.evaluate(
    ({ ids, now }) => {
      type MSW = {
        worker: { use: (...h: unknown[]) => void };
        http: { get: (u: string, h: unknown) => unknown; post: (u: string, h: unknown) => unknown };
        HttpResponse: { json: (b: unknown) => unknown };
      };
      const w = globalThis as unknown as { __msw?: MSW };
      if (!w.__msw) throw new Error("MSW not ready");
      const { worker, http: h, HttpResponse: R } = w.__msw;
      const profiles: Record<string, any> = {
        [ids.humanOnline]: {
          uid: ids.humanOnline,
          name: ids.humanOnlineName,
          short_no: "tes8_online",
          robot: 0,
          follow: 0,
          online: 1,
          last_offline: now - 86400,
          realname_verified: 1,
          real_name: ids.humanOnlineName,
        },
        [ids.humanOffline]: {
          uid: ids.humanOffline,
          name: ids.humanOfflineName,
          short_no: "tes8_offline",
          robot: 0,
          follow: 0,
          online: 0,
          last_offline: now - 2 * 3600,
          realname_verified: 0,
        },
        [ids.botOnline]: {
          uid: ids.botOnline,
          name: ids.botOnlineName,
          username: "tes8_bot_online",
          short_no: "tes8_bot_online",
          robot: 1,
          follow: 1,
          online: 1,
          last_offline: now - 86400,
          bot_description: "TES8 e2e bot",
          bot_creator_uid: ids.self,
          bot_creator_name: ids.selfName,
          bot_commands: "[]",
        },
        [ids.self]: {
          uid: ids.self,
          name: ids.selfName,
          short_no: "10000",
          robot: 0,
          follow: 0,
          online: 1,
          last_offline: now - 86400,
          realname_verified: 1,
          real_name: ids.selfName,
        },
      };
      const hit = (uid: string) => ({
        channel_id: uid,
        channel_type: 1,
        channel_name: profiles[uid].name,
        is_bot: profiles[uid].robot,
      });
      worker.use(
        h.post("*/search/global", async ({ request }: any) => {
          let keyword = "";
          try {
            const body = await request.json();
            keyword = String(body.keyword || body.q || "");
          } catch {}
          const friends = Object.keys(profiles)
            .filter((uid) => profiles[uid].name.includes(keyword))
            .map(hit);
          return R.json({ friends, groups: [], messages: [], files: [] });
        }),
        h.get("*/users/:uid", ({ params }: any) => {
          const uid = String(params.uid);
          return R.json(profiles[uid] || profiles[ids.self]);
        }),
        h.get("*/api/v1/users/:uid", ({ params }: any) => {
          const uid = String(params.uid);
          return R.json(profiles[uid] || profiles[ids.self]);
        }),
        h.get("*/agent-cards/:botId/report-status", () =>
          R.json({ code: 0, message: "ok", data: { reported: true } })
        ),
        h.get("*/api/v1/agent-cards/:botId/report-status", () =>
          R.json({ code: 0, message: "ok", data: { reported: true } })
        )
      );
    },
    {
      now: nowSec,
      ids: {
        humanOnline: HUMAN_ONLINE_UID,
        humanOnlineName: HUMAN_ONLINE_NAME,
        humanOffline: HUMAN_OFFLINE_UID,
        humanOfflineName: HUMAN_OFFLINE_NAME,
        botOnline: BOT_ONLINE_UID,
        botOnlineName: BOT_ONLINE_NAME,
        self: SELF_UID,
        selfName: SELF_NAME,
      },
    }
  );

  async function openSearchHit(keyword: string, options: { searchCloses?: boolean } = {}) {
    const { searchCloses = true } = options;
    await authedPage.getByRole("button", { name: "会话" }).click();
    await authedPage.waitForSelector(".wk-chat-header-actions", { timeout: 10_000 });
    await authedPage.locator(".wk-chat-header-actions .wk-chat-header-btn").first().click();
    const searchModal = authedPage.getByRole("dialog").filter({
      has: authedPage.getByPlaceholder(/搜索联系人/),
    });
    await expect(searchModal).toBeVisible({ timeout: 10_000 });
    await searchModal.getByPlaceholder(/搜索联系人/).fill(keyword);
    const contactHit = searchModal.getByText(keyword).first();
    await expect(contactHit).toBeVisible({ timeout: 10_000 });
    await contactHit.click();
    if (searchCloses) {
      await expect(searchModal).toBeHidden({ timeout: 10_000 });
    }
  }

  async function closeUserInfo() {
    await authedPage.locator(".wk-base-modal-userinfo .wk-route-header-close").click();
    await expect(authedPage.locator(".wk-base-modal-userinfo")).toBeHidden({ timeout: 10_000 });
  }

  await openSearchHit(HUMAN_ONLINE_NAME);
  const onlineDialog = authedPage.getByRole("dialog").filter({ hasText: HUMAN_ONLINE_NAME });
  await expect(onlineDialog.getByRole("status", { name: "在线" })).toBeVisible({ timeout: 10_000 });
  await authedPage.screenshot({ path: kf("01-human-online"), fullPage: true });
  await closeUserInfo();

  await openSearchHit(HUMAN_OFFLINE_NAME);
  const offlineDialog = authedPage.getByRole("dialog").filter({ hasText: HUMAN_OFFLINE_NAME });
  await expect(offlineDialog.getByRole("status", { name: /离线 2 小时前/ })).toBeVisible({ timeout: 10_000 });
  await authedPage.screenshot({ path: kf("02-human-offline"), fullPage: true });
  await closeUserInfo();

  await openSearchHit(SELF_NAME);
  const selfDialog = authedPage.getByRole("dialog").filter({ hasText: SELF_NAME });
  await expect(selfDialog).toBeVisible({ timeout: 10_000 });
  expect(await selfDialog.getByRole("status").count()).toBe(0);
  await authedPage.screenshot({ path: kf("03-self-hidden"), fullPage: true });
  await closeUserInfo();

  await openSearchHit(BOT_ONLINE_NAME, { searchCloses: false });
  const botDialog = authedPage.getByRole("dialog").filter({ hasText: BOT_ONLINE_NAME });
  await expect(botDialog.getByRole("status", { name: "在线" })).toBeVisible({ timeout: 10_000 });
  await expect(botDialog.getByText("已上报 Agent 信息")).toBeVisible({ timeout: 10_000 });
  await authedPage.screenshot({ path: kf("04-bot-online-chip"), fullPage: true });
});
