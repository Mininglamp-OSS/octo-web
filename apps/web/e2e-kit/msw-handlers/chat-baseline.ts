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

function e2eScenario(_request?: Request): string {
  try {
    const fromStorage = sessionStorage.getItem("__e2e_scenario");
    if (fromStorage) return fromStorage;
  } catch { /* fall back to the default fixture */ }
  return "";
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
  role: 2,
};

const SP1_CREATED_SPACE = {
  space_id: "sp1-created-space",
  name: "SP1 新组织",
  description: "",
  logo: "",
  create_at: "2026-08-25T00:00:00Z",
  update_at: "2026-08-25T00:00:00Z",
  space_no: "sp1-created-space",
  owner: MOCK_UID,
  status: 1,
  role: 2,
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
    HttpResponse.json({ enabled: false, max_file_size: 5_000_000, max_duration: 60 })
  ),
  http.get("*/voice/local-config", () =>
    HttpResponse.json({ enabled: false, timeout_ms: null, probe_url: null, transcribe_url: null })
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
  http.get("*/space/my", ({ request }) => {
    if (!request.headers.get("token")) return HttpResponse.json([]);
    const scenario = e2eScenario(request);
    if (scenario === "sp1-space-gate-created") return HttpResponse.json([SP1_CREATED_SPACE]);
    if (scenario === "sp1-space-gate") {
      return HttpResponse.json([]);
    }
    return HttpResponse.json([MOCK_SPACE]);
  }),
  // Invite landing is the first request on SP2's fresh navigation, before the
  // page-specific handler can be installed. Keep only this boot fixture in the
  // baseline, and scope it to SP2 so other scenarios do not see invite data.
  http.get("*/space/invite/SP2-INVITE", ({ request }) => {
    if (e2eScenario(request) !== "sp2-space-invite-login") return HttpResponse.json({ msg: "not found" }, { status: 404 });
    return HttpResponse.json({ invite_code: "SP2-INVITE", space_id: "sp2-invite-space", space_name: "SP2 邀请空间", member_count: 1, max_users: 100 });
  }),
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
  http.get("*/api/v1/user/pinned", () => HttpResponse.json([])),
  http.get("*/user/pinned", () => HttpResponse.json([])),
  http.get("*/robot/my_bots", () => HttpResponse.json([
    {
      uid: "e2e-contact-bot",
      name: "E2E 助手",
      status: "added",
      description: "用于验证通讯录 Bot 发起会话",
    },
  ])),
  http.get("*/robot/space_bots", () => HttpResponse.json([
    {
      uid: "e2e-contact-bot",
      name: "E2E 助手",
      status: "added",
      description: "用于验证通讯录 Bot 发起会话",
    },
  ])),
  http.put("*/user/language", () => HttpResponse.json({})),

  // === Contacts / friends ===
  http.get("*/friend/sync", () => HttpResponse.json([])),
  http.get("*/group/my", () => HttpResponse.json([
    {
      group_no: "e2e-contact-group",
      name: "E2E 项目群",
      member_count: 3,
    },
  ])),
  http.get("*/space/:spaceId/members", () => HttpResponse.json([
    {
      uid: "e2e-contact-human",
      name: "E2E 联系人",
      avatar: "",
      role: 0,
      robot: 0,
    },
    {
      uid: "e2e-contact-bot",
      name: "E2E 助手",
      avatar: "",
      role: 0,
      robot: 1,
    },
  ])),
  http.get("*/users/e2e-contact-human", () => HttpResponse.json({
    uid: "e2e-contact-human",
    name: "E2E 联系人",
    follow: 1,
    robot: 0,
    role: 0,
  })),
  http.get("*/users/e2e-contact-bot", () => HttpResponse.json({
    uid: "e2e-contact-bot",
    name: "E2E 助手",
    username: "e2e-contact-bot",
    follow: 1,
    robot: 1,
    bot_description: "用于验证通讯录 Bot 发起会话",
    bot_creator_uid: "e2e-owner",
    bot_creator_name: "E2E Owner",
  })),
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
  // apiClient can retain the `/api/v1` prefix in browser requests. Keep explicit
  // variants because MSW's leading wildcard does not reliably consume multiple
  // path segments in every runtime, which previously leaked this call to Vite's
  // dead CI proxy.
  http.post("*/api/v1/conversations/:channelId/:channelType/extra", () =>
    HttpResponse.json({})
  ),
  http.get("*/api/v1/conversations/:channelId/:channelType/extra", () =>
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
  // 四个计数全字段返回: 窄端点 /summaries/attention 若 404, 前端会兜底读这里的
  // attention_count (见 packages/dmworksummary/src/api/summaryApi.ts
  // fetchSummaryAttentionCounts), 缺字段会被 assertAttentionCounts 判成畸形响应.
  http.get("*/summary/api/v1/summaries", () =>
    HttpResponse.json({ code: 0, message: "ok", data: {
      items: [], total: 0,
      attention_count: 0, unread_count: 0, pending_invitation_count: 0, pending_submission_count: 0,
    } })
  ),
  // 待关注红点的窄端点. 侧边栏 SummaryModule 挂在【所有已登录页面】上, 且带一条
  // 无人值守的兜底轮询 (utils/summaryAttentionPoll.ts, 15-60s 一拍), 所以这个请求
  // 会在任意 case 的任意时刻自行发出 —— 不是某个 case 的行为, 因此进 baseline 而
  // 不是 per-case handler. 漏装的后果是每个 case 都刷 Vite proxy error, e2e gate
  // 直接 block PR, 并让断言 consoleErrors 为空的用例 (如 @C37) 连带挂掉.
  //
  // 带不带 ?fresh=1 是同一条路由 (MSW 路径匹配忽略 query), 一个 handler 覆盖两种形态.
  // Match both absolute and same-origin relative requests. In the production-like
  // CI bundle this poll can be issued as a relative `/summary/...` URL, which a
  // leading-wildcard mask does not consistently match in the browser worker.
  http.get("/summary/api/v1/summaries/attention", () =>
    HttpResponse.json({ code: 0, message: "ok", data: {
      attention_count: 0, unread_count: 0, pending_invitation_count: 0, pending_submission_count: 0,
    } })
  ),
  http.get("*/summary/api/v1/summaries/attention", () =>
    HttpResponse.json({ code: 0, message: "ok", data: {
      attention_count: 0, unread_count: 0, pending_invitation_count: 0, pending_submission_count: 0,
    } })
  ),
  // Deep-link Summary requests can happen on the fresh document before the
  // per-case handler is installed. Keep these fallbacks scoped to S26 only.
  http.get("*/summary/api/v1/summaries/e2e-task-026", () => {
    if (e2eScenario() !== "s26-summary-standalone-links") return HttpResponse.json({ code: 404, message: "not found" }, { status: 404 });
    return HttpResponse.json({ code: 0, message: "ok", data: {
      task_id: 2601, task_no: "e2e-task-026", title: "S26 独立总结详情", topic: "S26 独立总结详情", summary_mode: 1, status: 3, trigger_type: 1,
      time_range_start: "2026-08-24T00:00:00Z", time_range_end: "2026-08-25T00:00:00Z", sources: [{ source_type: 1, source_id: "s26-source", source_name: "S26 项目群" }], participants: [],
      result: { content: "## S26 独立详情\n\n这是从任务链接直接打开的总结正文。", abstract: "S26 独立详情摘要", total_msg_count: 8, total_token_used: 100, model_version: "e2e-model", generated_at: "2026-08-25T08:00:00Z", version: 1, citations: [], team_citations: [] },
      error_message: null, creator_id: "e2e-user-1", creator_name: "E2E Tester", origin_channel_id: "s26-source", origin_channel_type: 2, created_at: "2026-08-25T08:00:00Z", updated_at: "2026-08-25T08:05:00Z", result_version: 1, preview: "S26 独立详情摘要", content: "## S26 独立详情\n\n这是从任务链接直接打开的总结正文。",
    } });
  }),
  http.post("*/summary/api/v1/summaries/2601/read", () => {
    if (e2eScenario() !== "s26-summary-standalone-links") return HttpResponse.json({ code: 404, message: "not found" }, { status: 404 });
    return HttpResponse.json({ code: 0, message: "ok", data: { is_unread: false, has_pending_invitation: false, needs_attention: false } });
  }),
  http.get("*/summary/api/v1/summaries/2601/versions", () => {
    if (e2eScenario() !== "s26-summary-standalone-links") return HttpResponse.json({ code: 404, message: "not found" }, { status: 404 });
    return HttpResponse.json({ code: 0, message: "ok", data: { versions: [], keep_limit: 3 } });
  }),
  http.get("*/summary/api/v1/summary-shares/e2e-share-026", () => {
    if (e2eScenario() !== "s26-summary-standalone-links") return HttpResponse.json({ code: 404, message: "not found" }, { status: 404 });
    return HttpResponse.json({ code: 0, message: "ok", data: { share_id: "e2e-share-026", source_accessible: true, snapshot: {
      id: 2602, task_id: 2601, task_no: "e2e-share-026", space_id: "e2e-space-001", title: "S26 分享总结", source_name: "S26 项目群", source_count: 1, participant_count: 2, message_count: 8, time_range_start: "2026-08-24T00:00:00Z", time_range_end: "2026-08-25T00:00:00Z", summary_mode: 1, result_version: 1, preview: "S26 分享正文", content: "## S26 分享详情\n\n这是从分享链接直接打开的总结正文。", created_at: "2026-08-25T08:00:00Z",
    } } });
  }),
  http.get("*/summary/api/v1/summary-templates", () =>
    HttpResponse.json({ templates: [], custom_template_limit: 30 })
  ),
];
