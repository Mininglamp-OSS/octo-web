// Bot CRUD client for PoC4. Sits next to BotsTab so the API surface is
// localized to the runtimes module — if we promote this later we can move
// it to dmworkbase/src/api.
import WKApp from '../../App';
import { t } from '../../i18n';

export type RuntimeKind = 'openclaw' | 'claude';

export const SUPPORTED_RUNTIME_KINDS: RuntimeKind[] = ['openclaw', 'claude'];

export function isSupportedRuntimeKind(s: string): s is RuntimeKind {
  return (SUPPORTED_RUNTIME_KINDS as string[]).includes(s);
}

// providerLabels: runtime kind 的用户可读名. 单源 export 让所有渲染入口
// (左树 device 行 / RuntimeDetail / CreateBotModal kind 列表) 显示
// 完全一致, 不再 "kind 列表用裸 'claude' / detail 显示 'Claude Code'" 漂移.
//
// 'Claude' 不加 'Code' 后缀 — 跟 OpenClaw 简洁度对齐.
export const providerLabels: Record<string, string> = {
  claude:   'Claude',
  openclaw: 'OpenClaw',
};

export interface Bot {
  id: number;
  space_id: string;
  owner_uid: string;
  runtime_id: number;
  runtime_kind: RuntimeKind;
  daemon_id: string;
  name: string;
  bot_uid: string;
  workspace_id: string;
  status: 'draft' | 'provisioning' | 'bot_minted' | 'dispatched' | 'active' | 'failed' | 'archived';
  error_msg?: string;
  created_at: string;
  updated_at: string;
}

// PR-2: bot.status enum → 用户可读中文标签. fleet 内部状态机的多个中
// 间态归为同一面向用户的"配置中"桶, 终态保持区分. 单源放 botsApi.ts
// 跟 Bot 类型一起, 让 index.tsx 左树跟 BotsTab 列表共用同一映射 (避免
// BotsTab 内联 ternary 漏 draft/archived 跟左树不一致, 抽到这里两侧
// import 同一份).
export function botStatusLabel(s: string): string {
  switch (s) {
    case 'active':       return t("base.runtimes.common.online");
    case 'failed':       return t("base.runtimes.botStatus.failed");
    case 'archived':     return t("base.runtimes.botStatus.archived");
    case 'draft':        return t("base.runtimes.botStatus.draft");
    case 'provisioning':
    case 'bot_minted':
    case 'dispatched':   return t("base.runtimes.botStatus.dispatched");
    default:             return s;
  }
}

export interface CreateBotReq {
  runtime_id: number;
  name: string;
  runtime_kind: RuntimeKind;
}

export interface BotFeedItem {
  kind: 'comment' | 'activity';
  id: string;
  matter_id: string;
  matter_title?: string;
  matter_seq_no?: number;
  created_at: string;
  content?: string | null;
  action?: string;
  detail?: Record<string, unknown>;
}

// fleet 经 nginx 的 /fleet/api 段挂载(fleet api.go A.1: `fleet/api` segment
// 由 nginx 加, strip 后转 fleet 的 /v1/<resource>); octo-server 主后端走 /api。
const fleetBase = '/fleet/api';
const serverBase = '/api';

// 桌面端 (Electron/Tauri) renderer 的 origin != API origin, 故所有服务路径都要
// 用从 apiClient.config.apiURL 推导出的绝对 origin 前缀。web 下 apiURL 是相对的
// ('/api/v1/'), apiOrigin() 解析为当前 origin, 路径保持同源、行为不变。
export function apiOrigin(): string {
  return new URL(WKApp.apiClient.config.apiURL, window.location.origin).origin;
}

// 给走全局 apiClient 的 fleet 调用复用(apiClient.baseURL 形式, 含 /v1/)。
// 懒求值: apiURL 在 bootstrap 时才设置, 顶层 const 会过早求值拿到空 origin。
export const fleetApiBase = () => `${apiOrigin()}/fleet/api/v1/`;

// 合并 plan 决策一+二 Phase 3A: fleet 已切到 AuthMiddleware 接 session token
// 直接 (跟 matter user-auth 一致), 不再换 JWT。authHeaders 注入 token: +
// X-Space-Id, 跟 axios 全局 interceptor 行为对齐。
async function authHeaders(): Promise<Record<string, string>> {
  const h: Record<string, string> = {};
  const sessionToken = (WKApp as any)?.loginInfo?.token;
  if (sessionToken) h.token = sessionToken;
  const spaceId = (WKApp as any)?.shared?.currentSpaceId;
  if (spaceId) h['X-Space-Id'] = spaceId;
  return h;
}

function unwrap<T>(env: any): T {
  // Peel exactly ONE top-level envelope layer: { data: X } -> X, else passthrough.
  // fleet/server both wrap success bodies as { data: ... } (R1 envelope).
  if (env && typeof env === 'object' && 'data' in env) return env.data as T;
  return env as T;
}

export async function listBots(params: { runtime_kind?: RuntimeKind; owner_uid?: string } = {}): Promise<Bot[]> {
  const sp = new URLSearchParams();
  sp.set('space_id', (WKApp as any)?.shared?.currentSpaceId ?? '');
  if (params.runtime_kind) sp.set('runtime_kind', params.runtime_kind);
  if (params.owner_uid) sp.set('owner_uid', params.owner_uid);
  // fleet GET /v1/bots is offset-paginated; pull the max page (100) since the
  // UI has no pager yet. Response is the R1 OffsetList {data:[...],pagination}.
  sp.set('page_size', '100');
  const res = await fetch(`${apiOrigin()}${fleetBase}/v1/bots?${sp}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`listBots: ${res.status}`);
  const env = await res.json();
  // fleet's list response is a SINGLE-layer R1 OffsetList — the top level IS
  // { "data": Bot[], "pagination": {...} }, i.e. `data` is ALREADY the array,
  // NOT a double-wrapped { "data": { "data": [...] } }.
  // Source of truth: octo-fleet internal/envelope OffsetList struct has
  // `Data []T json:"data"`, and ResponseOffset emits c.JSON(OffsetList{...})
  // directly — there is NO extra Data envelope wrapped around the OffsetList.
  // So unwrap() peels this one `.data` layer and yields Bot[] for the
  // downstream .map() / for..of. (A second unwrap would wrongly hit the
  // pagination object's absence of `.data` and return undefined.)
  return unwrap<Bot[]>(env) ?? [];
}

// createBot orchestrates the 3-step PR-A.2 bot mint flow because
// fleet and server are independent services that don't talk to each
// other. The browser is the only place that holds both a session
// (server) and the resulting bot_uid (server) AND knows which fleet
// row to update — so it owns the orchestration:
//
//   1. POST fleet  /runtimes/bots      → draft row, get bot.id
//   2. POST server /bot/mint           → IM bot created, get bot_uid
//   3. POST fleet  /runtimes/bots/:id/mint → promote draft to bot_minted
//                                            (or active for inert kinds)
//
// bot_token never touches the browser — it's minted into server's
// robot table and later fetched by the daemon via its daemon-scope
// JWT (GET /v1/bot/:bot_uid/token).
//
// Failure modes:
//   - Step 1 fails → modal shows error, nothing persisted
//   - Step 2 fails → fleet has a draft row (status='draft'); user can
//     retry from the bot list, or background sweeper can prune
//   - Step 3 fails → both bot_uid (in server) and draft (in fleet)
//     exist but aren't linked. UX shows retry; manual cleanup possible.
export async function createBot(req: CreateBotReq): Promise<Bot> {
  // Step 1: fleet draft.
  const draftRes = await fetch(`${apiOrigin()}${fleetBase}/v1/bots`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!draftRes.ok) {
    const body = await draftRes.text();
    throw new Error(`createBot draft ${draftRes.status}: ${body}`);
  }
  const draft = unwrap<Bot>(await draftRes.json());

  // Step 2: server mint OBO. Uses the existing session token (server
  // session auth), NOT the fleet JWT.
  const spaceId = (WKApp as any)?.shared?.currentSpaceId || '';
  const sessionToken = (WKApp as any)?.loginInfo?.token || '';
  const mintRes = await fetch(`${apiOrigin()}${serverBase}/v1/bot/mint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: sessionToken },
    body: JSON.stringify({ display_name: req.name, space_id: spaceId }),
  });
  if (!mintRes.ok) {
    const body = await mintRes.text();
    throw new Error(`createBot mint ${mintRes.status}: ${body}`);
  }
  const minted = unwrap<{ bot_uid: string }>(await mintRes.json());
  if (!minted?.bot_uid) throw new Error('createBot mint returned no bot_uid');

  // Step 3: fleet patch to link bot_uid + promote status.
  const patchRes = await fetch(`${apiOrigin()}${fleetBase}/v1/bots/${draft.id}/mint`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ bot_uid: minted.bot_uid }),
  });
  if (!patchRes.ok) {
    const body = await patchRes.text();
    throw new Error(`createBot patch ${patchRes.status}: ${body}`);
  }
  return unwrap<Bot>(await patchRes.json());
}

// PR-2: 删 getBot / archiveBot 死代码.
// archiveBot 当前是 fleet-only soft-delete, 完整 deprovision (跨 server
// robot row + WuKongIM channel + daemon 端 adapter resources e.g. openclaw
// workspace / cc-channel-octo bot config) 还没接通,
// 接通后再加回入口比留半截 dead export 干净. PR-N adapter.Deprovision
// 落地时一起加回.
//
// getBot 同样无 caller — 列表来自 listBots, 详情通过 BotsTab 持有的
// state.bots 拿. 真要单点查一个 id 时再加回.

export async function getBotFeed(botUid: string, limit = 50): Promise<BotFeedItem[]> {
  // Skip the round-trip for draft/provisioning bots where bot_uid is empty —
  // matter would 404 and FeedTab polls every 3s, so silent empty is correct.
  if (!botUid) return [];
  // Direct to matter (was: fleet /v1/runtimes/bots/:id/feed proxy → matter).
  // matter user-auth expects session `token:` header, not the fleet Bearer JWT,
  // and the new endpoint is space-agnostic (ownership checked via related_uids),
  // so X-Space-Id is omitted.
  const sessionToken = (WKApp as any)?.loginInfo?.token || '';
  const res = await fetch(`${apiOrigin()}/matter/api/v1/bots/${encodeURIComponent(botUid)}/feed?limit=${limit}`, {
    headers: sessionToken ? { token: sessionToken } : {},
  });
  if (!res.ok) throw new Error(`getBotFeed: ${res.status}`);
  const env = await res.json();
  const payload = unwrap<{ items?: BotFeedItem[] }>(env);
  // matter may return {items: []} or just the array
  if (Array.isArray(payload)) return payload as any as BotFeedItem[];
  return (payload as any)?.items ?? [];
}
