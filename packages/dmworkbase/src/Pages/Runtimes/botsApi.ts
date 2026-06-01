// Bot CRUD client for PoC4. Sits next to BotsTab so the API surface is
// localized to the runtimes module — if we promote this later we can move
// it to dmworkbase/src/api.
import WKApp from '../../App';

export type RuntimeKind = 'openclaw' | 'claude' | 'codex' | 'hermes';

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
  status: 'provisioning' | 'bot_minted' | 'dispatched' | 'active' | 'failed' | 'archived';
  error_msg?: string;
  created_at: string;
  updated_at: string;
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
  created_at: string;
  content?: string | null;
  action?: string;
  detail?: Record<string, unknown>;
}

const base = '/api'; // vite proxy strips /api → /v1 on octo-server

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  const token = (WKApp as any)?.loginInfo?.token;
  if (token) h.token = token;
  const spaceId = (WKApp as any)?.shared?.currentSpaceId;
  if (spaceId) h['X-Space-Id'] = spaceId;
  return h;
}

function unwrap<T>(env: any): T {
  // octo-server wraps responses; data may be at top-level or under .data
  if (env && typeof env === 'object' && 'data' in env) return env.data as T;
  return env as T;
}

export async function listBots(params: { runtime_kind?: RuntimeKind; owner_uid?: string } = {}): Promise<Bot[]> {
  const sp = new URLSearchParams();
  sp.set('space_id', (WKApp as any)?.shared?.currentSpaceId ?? '');
  if (params.runtime_kind) sp.set('runtime_kind', params.runtime_kind);
  if (params.owner_uid) sp.set('owner_uid', params.owner_uid);
  const res = await fetch(`${base}/v1/runtimes/bots?${sp}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`listBots: ${res.status}`);
  const env = await res.json();
  const payload = unwrap<{ bots?: Bot[] }>(env);
  return (payload as any)?.bots ?? (env.bots ?? []);
}

export async function createBot(req: CreateBotReq): Promise<Bot> {
  const res = await fetch(`${base}/v1/runtimes/bots`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`createBot ${res.status}: ${body}`);
  }
  const env = await res.json();
  return unwrap<Bot>(env);
}

export async function getBot(id: number): Promise<Bot> {
  const res = await fetch(`${base}/v1/runtimes/bots/${id}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`getBot: ${res.status}`);
  const env = await res.json();
  return unwrap<Bot>(env);
}

export async function archiveBot(id: number): Promise<void> {
  const res = await fetch(`${base}/v1/runtimes/bots/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`archiveBot: ${res.status}`);
}

export async function getBotFeed(id: number, limit = 50): Promise<BotFeedItem[]> {
  const res = await fetch(`${base}/v1/runtimes/bots/${id}/feed?limit=${limit}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`getBotFeed: ${res.status}`);
  const env = await res.json();
  const payload = unwrap<{ items?: BotFeedItem[] }>(env);
  // server may return {items: []} or just the array
  if (Array.isArray(payload)) return payload as any as BotFeedItem[];
  return (payload as any)?.items ?? [];
}
