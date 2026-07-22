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
 * 兼容 apiClient.get 的多种前缀. 参考 loop-empty.ts 现有 handler 写法.
 */
import { http, HttpResponse } from "msw";

const MOCK_UID = "e2e-user-1";
const MOCK_SPACE_ID = "e2e-space-001";

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

export const chatBaselineHandlers = [
  // === Common / config ===
  // shape: { version, list: [{ key, name, url }] } - 见 packages/dmworkbase/src/Service/EmojiService.ts:30
  http.get("http://localhost:3000/api/v1/common/emojis", () =>
    HttpResponse.json({ version: 0, list: [] })
  ),
  http.get("*/voice/config", () =>
    HttpResponse.json({ enable: 0, provider: "", config: {} })
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
  http.get("*/user/devices/:deviceId", () =>
    // 400 表示设备未注册, App.tsx 里 syncClientMsgDeviceId 已有静默 fallback.
    HttpResponse.json({ msg: "device not found" }, { status: 400 })
  ),

  // === Space ===
  http.get("*/space/my", () => HttpResponse.json([MOCK_SPACE])),
  http.get("*/spaces/:spaceId/categories", () => HttpResponse.json([])),
  http.get("*/user/space/setting", () =>
    // 用户在 space 里的个人设置 (通知 / 免打扰 / hidden bots 等), 空对象兜底.
    HttpResponse.json({ mute: 0, hidden_bots: [], notify_level: 0 })
  ),

  // === Contacts / friends ===
  http.get("*/friend/sync", () => HttpResponse.json([])),
  http.delete("*/user/reddot/friendApply", () => HttpResponse.json({})),

  // === Sidebar ===
  http.post("*/sidebar/sync", () =>
    HttpResponse.json({ conversations: [], groups: [], users: [] })
  ),

  // === Summary ===
  // 空列表, 界面停在"暂无总结"稳定分支; 不返 200 会无限重试打爆 network.
  http.get("*/summary/api/v1/summaries", () =>
    HttpResponse.json({ code: 0, message: "ok", data: { items: [], total: 0 } })
  ),
];
