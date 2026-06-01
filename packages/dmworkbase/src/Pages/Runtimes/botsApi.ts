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
  status: 'draft' | 'provisioning' | 'bot_minted' | 'dispatched' | 'active' | 'failed' | 'archived';
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
  matter_title?: string;
  matter_seq_no?: number;
  created_at: string;
  content?: string | null;
  action?: string;
  detail?: Record<string, unknown>;
}

const base = '/api'; // vite proxy strips /api → /v1; /api/v1/runtimes goes to fleet :8092

// PR-A.2: fleet expects JWT (Bearer) instead of session token. Cache the
// JWT in-module; mirror the same pattern APIClient.getFleetJWT() uses.
// Kept here (rather than calling into APIClient) because botsApi.ts has
// always used raw fetch — letting it stay independent keeps the surface
// area contained.
let _jwt: { token: string; expiresAt: number } | null = null;

async function getFleetJWT(): Promise<string> {
  if (_jwt && _jwt.expiresAt > Date.now() + 60_000) return _jwt.token;
  const sessionToken = (WKApp as any)?.loginInfo?.token;
  if (!sessionToken) return '';
  const spaceId = (WKApp as any)?.shared?.currentSpaceId || '';
  try {
    const res = await fetch('/api/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_token: sessionToken, space_id: spaceId }),
    });
    if (!res.ok) return '';
    const j = await res.json();
    const tok = j?.token || j?.data?.token;
    const expiresIn = j?.expires_in || j?.data?.expires_in || 1800;
    if (!tok) return '';
    _jwt = { token: tok, expiresAt: Date.now() + Number(expiresIn) * 1000 };
    return tok;
  } catch {
    return '';
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const h: Record<string, string> = {};
  const jwt = await getFleetJWT();
  if (jwt) h.Authorization = 'Bearer ' + jwt;
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
  const res = await fetch(`${base}/v1/runtimes/bots?${sp}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`listBots: ${res.status}`);
  const env = await res.json();
  const payload = unwrap<{ bots?: Bot[] }>(env);
  return (payload as any)?.bots ?? (env.bots ?? []);
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
  const draftRes = await fetch(`${base}/v1/runtimes/bots`, {
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
  const mintRes = await fetch(`${base}/v1/bot/mint`, {
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
  const patchRes = await fetch(`${base}/v1/runtimes/bots/${draft.id}/mint`, {
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

export async function getBot(id: number): Promise<Bot> {
  const res = await fetch(`${base}/v1/runtimes/bots/${id}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`getBot: ${res.status}`);
  const env = await res.json();
  return unwrap<Bot>(env);
}

export async function archiveBot(id: number): Promise<void> {
  const res = await fetch(`${base}/v1/runtimes/bots/${id}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`archiveBot: ${res.status}`);
}

export async function getBotFeed(id: number, limit = 50): Promise<BotFeedItem[]> {
  const res = await fetch(`${base}/v1/runtimes/bots/${id}/feed?limit=${limit}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`getBotFeed: ${res.status}`);
  const env = await res.json();
  const payload = unwrap<{ items?: BotFeedItem[] }>(env);
  // server may return {items: []} or just the array
  if (Array.isArray(payload)) return payload as any as BotFeedItem[];
  return (payload as any)?.items ?? [];
}
