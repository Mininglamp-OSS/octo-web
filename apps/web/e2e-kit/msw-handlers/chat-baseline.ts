/**
 * chat / IM 场景 MSW baseline handlers.
 *
 * 覆盖 /chat 页面 bootstrap 打的所有 endpoint, 让 chat 页在 mock 模式下能起来.
 * 数据源尽量返 empty / 单条 fixture, 让业务组件 render 到 "空态 or 单会话"
 * 的稳定分支; 具体 case (如 C989) 再叠 handler 覆盖.
 *
 * 依赖: mock-im-runtime (fake-provider) 已 install (fixtures-authed.ts 里默认装 empty seed).
 * IM connect / channel info / messages 走 fake-provider, 不走 HTTP.
 *
 * URL 匹配约定: 用星号通配前缀 + 模块路径 (例 star-slash-common-slash-appconfig)
 * 兼容 apiClient.get 的多种前缀.
 */
import { http, HttpResponse } from "msw";

const MOCK_UID = "e2e-user-1";
const MOCK_SPACE_ID = "e2e-space-001";
const MOCK_APP_CONFIG = {
  docs_on: "0",
  dmloop_on: "0",
  dmpersonal_on: "0",
  thread_on: true,
  messages_search_on: true,
  message_reaction: { read: true, write: true },
  oidc_providers: [],
};

function appConfig() {
  let mailOn = false;
  try {
    mailOn = sessionStorage.getItem("__e2e_scenario") === "mail";
  } catch {
    // Keep the baseline config mail-disabled when storage is unavailable.
  }
  return { ...MOCK_APP_CONFIG, mail_on: mailOn ? "1" : "0" };
}

// Space fixture (单 space, 用户是 owner).
const MOCK_SPACE = {
  space_id: MOCK_SPACE_ID,
  name: "E2E Space",
  description: "",
  logo: "",
  create_at: "2026-07-20T10:00:00Z",
  update_at: "2026-07-20T10:00:00Z",
  space_no: "e2e-space",
  owner: MOCK_UID,
  status: 1,
  role: 1,
};

function chatFollowScenario(request?: Request): string {
  const header = request?.headers.get("x-e2e-chat-follow-scenario");
  if (header) return header;
  try { return new URL(request?.url ?? "").searchParams.get("e2e_chat_follow") ?? ""; }
  catch { return ""; }
}

function chatFollowFixtureGroups(request?: Request) {
  const sort = chatFollowScenario(request).startsWith("sort:");
  return sort
    ? [
        { group_no: "e2e-chat-layout-group-a", name: "E2E 关注群 A", category_sort: 0 },
        { group_no: "e2e-chat-layout-group-b", name: "E2E 关注群 B", category_sort: 1 },
      ]
    : [{ group_no: "e2e-chat-layout-group", name: "E2E Chat 布局群", category_sort: 1 }];
}

function chatFollowFixtureItems(request?: Request) {
  const scenario = chatFollowScenario(request);
  const sort = scenario.startsWith("sort:");
  const state = followScenarioState.get(scenario);
  if (scenario.startsWith("unfollow:") && state?.unfollowed) return [];
  return sort
    ? state?.order.map((target_id, index) => ({ target_type: 2, target_id, channel_type: 2, channel_id: target_id, timestamp: 1720000000, unread: 0, is_pinned: false, is_followed: true, category_id: "e2e-category", follow_sort: index + 1 })) ?? [
        { target_type: 2, target_id: "e2e-chat-layout-group-a", channel_type: 2, channel_id: "e2e-chat-layout-group-a", timestamp: 1720000000, unread: 0, is_pinned: false, is_followed: true, category_id: "e2e-category", follow_sort: 1 },
        { target_type: 2, target_id: "e2e-chat-layout-group-b", channel_type: 2, channel_id: "e2e-chat-layout-group-b", timestamp: 1720000000, unread: 0, is_pinned: false, is_followed: true, category_id: "e2e-category", follow_sort: 2 },
      ]
    : [{ target_type: 2, target_id: "e2e-chat-layout-group", channel_type: 2, channel_id: "e2e-chat-layout-group", timestamp: 1720000000, unread: 0, is_pinned: false, is_followed: true, category_id: "e2e-category", follow_sort: 1 }];
}

const followScenarioState = new Map<string, { unfollowed?: boolean; order: string[] }>();

export const chatBaselineHandlers = [
  // === Common / config ===
  http.get("*/api/v1/common/appconfig", () => HttpResponse.json(appConfig())),
  http.get("*/common/appconfig", () => HttpResponse.json(appConfig())),
  // shape: { version, list: [{ key, name, url }] } - 见 packages/dmworkbase/src/Service/EmojiService.ts:30
  http.get("*/api/v1/common/emojis", () =>
    HttpResponse.json({ version: 0, list: [] })
  ),
  http.get("*/common/emojis", () =>
    HttpResponse.json({ version: 0, list: [] })
  ),
  http.get("*/api/v1/health", () => HttpResponse.json({ ok: true })),
  http.get("*/health", () => HttpResponse.json({ ok: true })),
  http.get("*/voice/config", () =>
    HttpResponse.json({ enable: 0, provider: "", config: {} })
  ),
  http.get("*/api/v1/common/updater/android/1.0", () =>
    HttpResponse.json({ url: "https://example.com/download/android" })
  ),
  http.get("*/api/v1/common/updater/ios/1.0.0", () =>
    HttpResponse.json({ url: "https://example.com/download/ios" })
  ),
  http.get("*/message/prohibit_words/sync", () =>
    HttpResponse.json({ version: 0, words: [] })
  ),

  // === User / device / avatar ===
  http.get("*/users/:uid/avatar", () =>
    // avatar 通常返 image bytes, 但业务只关心是否 200 - 给一个空 buffer 兜底.
    HttpResponse.arrayBuffer(new Uint8Array([]).buffer, {
      headers: { "content-type": "image/png" },
    })
  ),
  http.get("*/groups/:groupNo/avatar", () =>
    // 与 user avatar 同理: group logo 可能为空, 但请求本身不该漏到 Vite proxy
    // (fake-provider 会为无 logo 的 group 派生 avatar 路径, 见 fake-provider.ts).
    HttpResponse.arrayBuffer(new Uint8Array([]).buffer, {
      headers: { "content-type": "image/png" },
    })
  ),
  http.get("*/group/avatar_palette", () =>
    // 空 colors 会走前端 fallback palette, 但请求本身不该漏到 Vite proxy.
    HttpResponse.json({ size: 0, colors: [] })
  ),
  http.get("*/api/v1/group/avatar_palette", () =>
    HttpResponse.json({ size: 0, colors: [] })
  ),
  http.get("*/user/devices/:deviceId", () =>
    // 400 表示设备未注册, App.tsx 里 syncClientMsgDeviceId 已有静默 fallback.
    HttpResponse.json({ msg: "device not found" }, { status: 400 })
  ),

  // === Space ===
  http.get("*/space/my", () => HttpResponse.json([MOCK_SPACE])),
  http.get("*/spaces/:spaceId/categories", ({ request }) => HttpResponse.json(
    chatFollowScenario(request)
      ? [{ category_id: "e2e-category", name: "工作", sort: 0, is_default: false,
          groups: chatFollowFixtureGroups(request) }]
      : []
  )),
  http.get("*/user/space/setting", () =>
    // 用户在 space 里的个人设置 (通知 / 免打扰 / hidden bots 等), 空对象兜底.
    HttpResponse.json({ mute: 0, hidden_bots: [], notify_level: 0 })
  ),
  http.get("*/user/notification-pause", () =>
    HttpResponse.json({
      paused: false,
      paused_until: null,
      revision: 0,
      server_time: new Date().toISOString(),
    })
  ),
  http.put("*/user/language", () => HttpResponse.json({})),

  // === Contacts / friends ===
  http.get("*/friend/sync", () => HttpResponse.json([])),
  http.get("*/group/my", () => HttpResponse.json([])),
  http.get("*/space/:spaceId/members", () => HttpResponse.json([])),
  http.delete("*/user/reddot/friendApply", () => HttpResponse.json({})),

  // === Sidebar ===
  http.post("*/sidebar/sync", ({ request }) => HttpResponse.json(
    chatFollowScenario(request)
      ? { items: chatFollowFixtureItems(request),
          version: 1, follow_version: 1 }
      : { conversations: [], groups: [], users: [] }
  )),
  http.post("*/follow/channel/unfollow", ({ request }) => {
    const scenario = chatFollowScenario(request);
    if (scenario.startsWith("unfollow:")) {
      const state = followScenarioState.get(scenario) ?? { order: [] };
      state.unfollowed = true;
      followScenarioState.set(scenario, state);
    }
    return HttpResponse.json({});
  }),
  http.put("*/follow/sort", async ({ request }) => {
    const scenario = chatFollowScenario(request);
    if (scenario.startsWith("sort:")) {
      const body = await request.json().catch(() => null) as { items?: Array<{ target_id?: string; sort?: number }> } | null;
      const items = body?.items ?? [];
      const order = items
        .filter((item) => typeof item.target_id === "string" && typeof item.sort === "number")
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
        .map((item) => item.target_id as string);
      if (order.length !== 2 || !order.includes("e2e-chat-layout-group-a") || !order.includes("e2e-chat-layout-group-b")) {
        return HttpResponse.json({ error: "invalid sort fixture payload" }, { status: 400 });
      }
      const state = followScenarioState.get(scenario) ?? { order };
      state.order = order;
      followScenarioState.set(scenario, state);
    }
    return HttpResponse.json({});
  }),
  http.post("*/message/channel/sync", () =>
    HttpResponse.json({ messages: [] })
  ),
  http.post("*/api/v1/message/channel/sync", () =>
    HttpResponse.json({ messages: [] })
  ),
  // showConversation() reads per-conversation metadata after opening a chat.
  // Keep this in the baseline so a passing interaction cannot leak to Vite's
  // dead CI proxy and become a false green.
  http.post("*/conversations/:channelId/:channelType/extra", () =>
    HttpResponse.json({})
  ),
  http.get("*/conversations/:channelId/:channelType/extra", () =>
    HttpResponse.json({})
  ),
  http.get("*/groups/:groupNo/threads", () => HttpResponse.json([])),
  http.post("*/messages/_search_all", () =>
    HttpResponse.json({ items: [], data: [], pagination: {} })
  ),
  http.post("*/search/global", () => HttpResponse.json({ friends: [], groups: [], messages: [] })),

  // === OBO / persona ===
  http.get("*/api/v1/obo/grants", () => HttpResponse.json([])),
  http.get("*/obo/grants", () => HttpResponse.json([])),

  // === Summary ===
  // 空列表, 界面停在"暂无总结"稳定分支; 不返 200 会无限重试打爆 network.
  http.get("*/summary/api/v1/summaries", () =>
    HttpResponse.json({ code: 0, message: "ok", data: { items: [], total: 0 } })
  ),
  http.get("*/summary/api/v1/summary-templates", () =>
    HttpResponse.json({ templates: [], custom_template_limit: 30 })
  ),
];
