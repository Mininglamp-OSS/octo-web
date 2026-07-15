import axios, { AxiosRequestConfig } from "axios";
import { WKApp, buildAcceptLanguage, t } from "@octo/base";
import type {
  CreateMcpParams,
  ListMcpParams,
  ListMcpResponse,
  McpCategory,
  McpDetail,
  McpListItem,
  McpProbeRequest,
  McpProbeResult,
  McpQuickStart,
} from "../types/mcp";
import {
  MCP_CATEGORY_LABELS,
  MCP_CATEGORY_ORDER,
  MOCK_MCP_DETAILS,
  MOCK_MCP_LIST,
  MOCK_PROBED_TOOLS,
} from "../mock/mcpMock";
import { CATEGORY_KEY_ALL } from "../utils/constants";

// ═══════════════════════════════════════════════════════════════════════════
// MCP Market service layer
// ═══════════════════════════════════════════════════════════════════════════
//
// The UI (list page + detail/create modals) ONLY imports the exported
// functions below — it never talks to axios or the mock directly. This keeps
// data-fetching behind a single seam so switching from mock to the real
// backend is a one-line change.
//
//   ┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
//   │  Pages/UI   │ ──▶ │  this service    │ ──▶ │ mock OR api │
//   └─────────────┘     └──────────────────┘     └─────────────┘
//
// Public surface (stable signatures — the UI never sees mock vs real):
//   fetchMcpList(params)   → list + categories
//   fetchMcpDetail(id)     → full detail
//   probeMcpTools(req)     → "try connect / fetch tool list" (see LSC-70)
//   createMcp(params)      → create a new MCP entry
//
// The real implementations target the octo-marketplace MCP catalog v1
// (octo-marketplace/docs/api/mcp-v1.md). USE_MOCK toggles the whole surface;
// browse + create now run against the real backend. The request plumbing
// (axios instance + interceptors) mirrors the summary module
// (packages/dmworksummary/src/api/summaryApi.ts) so auth / space-id / language
// headers stay consistent across the app.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Single switch between mock and real implementations.
 * Keep as a const so the bundler tree-shakes the unused branch in prod.
 */
const USE_MOCK = false;

// Simulate network latency so loading states are exercised during dev.
const MOCK_DELAY_MS = 300;

function delay<T>(value: T, ms = MOCK_DELAY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

// ─── Mock implementations ──────────────────────────────────────────────────

function buildCategories(): McpCategory[] {
  const counts = new Map<string, number>();
  for (const item of MOCK_MCP_LIST) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }
  return MCP_CATEGORY_ORDER.map((key) => ({
    key,
    label: MCP_CATEGORY_LABELS[key] ?? key,
    count: key === "all" ? MOCK_MCP_LIST.length : counts.get(key) ?? 0,
  }));
}

async function fetchMcpListMock(
  params: ListMcpParams
): Promise<ListMcpResponse> {
  return fetchMcpListMockFiltered(params, MOCK_MCP_LIST);
}

/** Mock counterpart of /mcps/mine — restricts to items whose `creatorName`
 *  matches the current login name. Mock has no real owner_uid, but new
 *  creates stamp the login name (see buildDetailFromCreate), so this
 *  faithfully echoes "MCPs I created in this session". */
async function fetchMcpMineMock(
  params: ListMcpParams
): Promise<ListMcpResponse> {
  const me = WKApp.loginInfo?.name || "";
  const mine = MOCK_MCP_LIST.filter((item) => item.creatorName === me);
  return fetchMcpListMockFiltered(params, mine);
}

async function fetchMcpListMockFiltered(
  params: ListMcpParams,
  source: McpListItem[]
): Promise<ListMcpResponse> {
  const keyword = (params.keyword ?? "").trim().toLowerCase();
  const category = params.category ?? "all";
  const filtered = source.filter((item) => {
    const matchCategory = category === "all" || item.category === category;
    const matchKeyword =
      !keyword ||
      item.name.toLowerCase().includes(keyword) ||
      item.slogan.toLowerCase().includes(keyword);
    return matchCategory && matchKeyword;
  });
  const offset = params.offset && params.offset > 0 ? params.offset : 0;
  const limit = params.limit && params.limit > 0 ? params.limit : filtered.length;
  const items = filtered.slice(offset, offset + limit);
  return delay({
    items,
    total: filtered.length,
    categories: buildCategories(),
  });
}

async function fetchMcpDetailMock(id: string): Promise<McpDetail> {
  const detail = MOCK_MCP_DETAILS.find((d) => d.id === id);
  if (!detail) {
    throw new Error(`MCP not found: ${id}`);
  }
  return delay(detail);
}

async function probeMcpToolsMock(
  req: McpProbeRequest
): Promise<McpProbeResult> {
  // Mock probe: pretend to connect and fetch tools/list. Longer delay so the
  // loading state is visible. Real probing (esp. stdio) must be done by the
  // Electron main process — see LSC-70.
  // TODO: 后端提供真实探测接口
  const hasTarget = req.transport === "stdio" ? !!req.command : !!req.url;
  if (!hasTarget) {
    return delay(
      {
        ok: false,
        tools: [],
        // The UI translates by `code`; the service layer stays i18n-agnostic.
        error: {
          code: "init_failed" as const,
          message: "",
        },
      },
      600
    );
  }
  return delay(
    {
      ok: true,
      tools: MOCK_PROBED_TOOLS,
      serverInfo: { name: req.transport, version: "mock" },
    },
    800
  );
}

async function createMcpMock(params: CreateMcpParams): Promise<{ id: string }> {
  // In-memory persistence: mutate the same arrays fetchMcpList/Detail read
  // from, so a freshly-created MCP shows up at the top of the list and its
  // detail modal opens without a "not found" error. Session-only — a page
  // reload resets to the built-in fixtures, which is what we want for a
  // prototype (no leaking mock state across sessions).
  const id = slugify(params.name) || `mock-${Date.now()}`;
  const uniqueId = MOCK_MCP_DETAILS.some((d) => d.id === id)
    ? `${id}-${Date.now().toString(36)}`
    : id;
  const detail = buildDetailFromCreate(uniqueId, params);
  MOCK_MCP_DETAILS.unshift(detail);
  MOCK_MCP_LIST.unshift(projectListItem(detail));
  return delay({ id: uniqueId }, 400);
}

/** Turn a create-form payload into a fully-populated detail record. */
function buildDetailFromCreate(id: string, params: CreateMcpParams): McpDetail {
  const quickStart: McpQuickStart = {
    transport: params.transport,
    serverName: params.name.trim(),
    url: params.url || undefined,
    authType: params.authType,
    headers:
      params.headers && Object.keys(params.headers).length
        ? params.headers
        : undefined,
    command: params.command || undefined,
    args: params.args && params.args.length ? params.args : undefined,
    env: params.env && Object.keys(params.env).length ? params.env : undefined,
  };
  return {
    id,
    name: params.name.trim(),
    slogan: params.slogan,
    category: params.category,
    tags: params.tags ?? [],
    toolCount: params.tools.length,
    icon: params.icon,
    creatorName: WKApp.loginInfo?.name || "",
    quickStart,
    tools: params.tools,
    usageExamples: (params.usageExamples ?? []).filter((s) => s.trim()),
    faqs: (params.faqs ?? []).filter((f) => f.question.trim()),
    notes: (params.notes ?? []).filter((s) => s.trim()),
  };
}

/** Derive the list-card projection from a full detail. */
function projectListItem(d: McpDetail): McpListItem {
  return {
    id: d.id,
    name: d.name,
    slogan: d.slogan,
    category: d.category,
    tags: d.tags,
    toolCount: d.toolCount,
    icon: d.icon,
  };
}

/** ASCII/CJK-safe slug for the mock id. Falls back to "" so caller adds ts. */
function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9一-龥-]/g, "");
}

// ─── Real implementations (octo-marketplace MCP catalog v1) ─────────────────
// Wire contract: octo-marketplace/docs/api/mcp-v1.md. The catalog is mounted at
// <origin>/market/api/v1 (nginx / vite proxy strips the /market prefix to the
// service's own /api/v1), mirroring the summary + matter service convention.

const mcpAxios = axios.create({ baseURL: "" });

const BASE = "/market/api/v1";

function resolveBaseURL(): string {
  const apiURL = WKApp.apiClient?.config?.apiURL;
  if (!apiURL) return "";
  try {
    // Relative apiURL (Web) has no parsable origin → stay same-origin.
    return new URL(apiURL).origin;
  } catch {
    return "";
  }
}

mcpAxios.interceptors.request.use((config) => {
  config.baseURL = resolveBaseURL();
  config.headers = config.headers ?? {};
  config.headers["Accept-Language"] = buildAcceptLanguage();
  const token = WKApp.loginInfo.token;
  if (token) {
    config.headers["token"] = token;
  }
  const spaceId = WKApp.shared.currentSpaceId;
  if (spaceId) {
    config.headers["X-Space-Id"] = spaceId;
  }
  return config;
});

mcpAxios.interceptors.response.use(
  (resp) => resp,
  (err) => {
    if (err?.response?.status === 401) {
      WKApp.shared.logout();
    }
    return Promise.reject(err);
  }
);

/**
 * Marketplace error envelope is `{err:{code,message,details}}` (mcp-v1.md §2) —
 * distinct from the summary/matter `{code,message,data}` shape. When we
 * recognize the wire `code` we surface a localized copy so a Chinese UI
 * doesn't show the backend's English `message`; unknown codes fall through to
 * the wire message. Falls back to the axios error string when the body is
 * missing.
 */
function extractErrorMessage(err: unknown): string {
  const axiosErr = err as {
    response?: { data?: { err?: { message?: string; code?: string } } };
  };
  const wire = axiosErr?.response?.data?.err;
  const code = wire?.code;
  const localized = code ? localizedForCode(code) : "";
  const raw =
    localized ||
    wire?.message ||
    code ||
    (err instanceof Error ? err.message : "Request failed");
  return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
}

/** Map a `err.marketplace.*` code to a localized string via i18n. Returns
 *  empty string if the code is unknown; caller falls back to the wire
 *  message. Keeping the mapping table here keeps the i18n keys colocated
 *  with the codes and greppable. */
function localizedForCode(code: string): string {
  const KNOWN: Record<string, string> = {
    "err.marketplace.mcp.name_taken": "mcp.errors.nameTaken",
    "err.marketplace.mcp.secret_leaked": "mcp.errors.secretLeaked",
    "err.marketplace.mcp.forbidden": "mcp.errors.forbidden",
    "err.marketplace.mcp.not_found": "mcp.errors.notFound",
    "err.marketplace.mcp.invalid_visibility": "mcp.errors.invalidVisibility",
    "err.marketplace.mcp.invalid_transport": "mcp.errors.invalidTransport",
    "err.marketplace.mcp.invalid_request": "mcp.errors.invalidRequest",
    "err.marketplace.auth.unauthorized": "mcp.errors.unauthorized",
    "err.marketplace.auth.forbidden_space": "mcp.errors.forbiddenSpace",
    "err.marketplace.internal": "mcp.errors.internal",
  };
  const key = KNOWN[code];
  return key ? t(key) : "";
}

/**
 * Marketplace success bodies are the resource object directly (no
 * `{code,message,data}` wrapper — mcp-v1.md §3/§4). Return `resp.data` as-is.
 */
async function get<T>(
  path: string,
  params?: Record<string, unknown>,
  config?: AxiosRequestConfig
): Promise<T> {
  try {
    const resp = await mcpAxios.get(`${BASE}${path}`, { params, ...config });
    return resp.data as T;
  } catch (err) {
    if (axios.isCancel(err)) throw err;
    throw new Error(extractErrorMessage(err));
  }
}

async function post<T>(path: string, data?: unknown): Promise<T> {
  try {
    const resp = await mcpAxios.post(`${BASE}${path}`, data);
    return resp.data as T;
  } catch (err) {
    if (axios.isCancel(err)) throw err;
    throw new Error(extractErrorMessage(err));
  }
}

/**
 * Resolve a category label from the frontend i18n bundle. The backend returns
 * `{key,count}` only (mcp-v1.md §4.2); labels are the frontend's job so locales
 * evolve without a service redeploy. Falls back to the static map, then the raw
 * key, so an unknown key still renders something sensible.
 */
function categoryLabel(key: string): string {
  const translated = t(`mcp.category.${key}`);
  // i18n returns the key path back on a miss — treat that as "no translation".
  if (translated && translated !== `mcp.category.${key}`) return translated;
  return MCP_CATEGORY_LABELS[key] ?? key;
}

/** Wire shape of the list response before frontend label enrichment. */
interface McpListResponseWire {
  items: McpListItem[];
  total: number;
  categories: { key: string; count: number }[];
}

async function fetchMcpListReal(
  params: ListMcpParams
): Promise<ListMcpResponse> {
  return fetchMcpListPath("/mcps", params);
}

/** GET /mcps/mine — same shape, restricted to owner=caller (mcp-v1.md §4.3). */
async function fetchMcpMineReal(
  params: ListMcpParams
): Promise<ListMcpResponse> {
  return fetchMcpListPath("/mcps/mine", params);
}

/** Shared list-body handling: build query, hit path, enrich labels. */
async function fetchMcpListPath(
  path: string,
  params: ListMcpParams
): Promise<ListMcpResponse> {
  const query: Record<string, unknown> = {};
  const keyword = params.keyword?.trim();
  if (keyword) query.keyword = keyword;
  // `all` disables the filter server-side; send it verbatim per §0.
  query.category = params.category ?? CATEGORY_KEY_ALL;
  if (params.limit && params.limit > 0) query.limit = params.limit;
  if (params.offset && params.offset > 0) query.offset = params.offset;
  const resp = await get<McpListResponseWire>(path, query);
  const categories: McpCategory[] = (resp.categories ?? []).map((c) => ({
    key: c.key,
    label: categoryLabel(c.key),
    count: c.count,
  }));
  return { items: resp.items ?? [], total: resp.total ?? 0, categories };
}

async function fetchMcpDetailReal(id: string): Promise<McpDetail> {
  return get<McpDetail>(`/mcps/${encodeURIComponent(id)}`);
}

async function probeMcpToolsReal(
  _req: McpProbeRequest
): Promise<McpProbeResult> {
  // stdio probing must run in the Electron main process (LSC-70); the
  // marketplace REST surface has no `/probe` endpoint. Until the IPC path
  // lands, real probing is unavailable — the create wizard hides its probe
  // button (see isProbeAvailable) so this branch is never reached in the
  // browse+create flow. Throw instead of hitting a non-existent endpoint so a
  // stray call surfaces loudly rather than 404-ing.
  // TODO(LSC-70): route to the `mcp:probeTools` IPC and flip isProbeAvailable.
  throw new Error("probe_unavailable");
}

async function createMcpReal(params: CreateMcpParams): Promise<{ id: string }> {
  // POST /mcps returns 201 with the full McpDetail; the frontend picks up `id`
  // from the response (mcp-v1.md §4.1). Server derives id / creatorName /
  // toolCount / timestamps and ignores any client-supplied values for them, so
  // the flat create body is sent as-is (§3.3).
  const detail = await post<McpDetail>("/mcps", params);
  return { id: detail.id };
}

// ─── Public API (the only surface the UI imports) ──────────────────────────

export function fetchMcpList(
  params: ListMcpParams = {}
): Promise<ListMcpResponse> {
  return USE_MOCK ? fetchMcpListMock(params) : fetchMcpListReal(params);
}

/** GET /mcps/mine — restricted to the caller's own records. */
export function fetchMcpMine(
  params: ListMcpParams = {}
): Promise<ListMcpResponse> {
  return USE_MOCK ? fetchMcpMineMock(params) : fetchMcpMineReal(params);
}

export function fetchMcpDetail(id: string): Promise<McpDetail> {
  return USE_MOCK ? fetchMcpDetailMock(id) : fetchMcpDetailReal(id);
}

/**
 * Try-connect + fetch tool list. Mock returns a fake tool set after a delay;
 * the real implementation is provided by the Electron main process (LSC-70).
 */
export function probeMcpTools(req: McpProbeRequest): Promise<McpProbeResult> {
  return USE_MOCK ? probeMcpToolsMock(req) : probeMcpToolsReal(req);
}

/**
 * Whether "try connect / fetch tool list" is actually wired up. The marketplace
 * REST surface has no `/probe`; real probing needs the Electron main-process IPC
 * (LSC-70), which has not landed. So probing only works in mock mode today. The
 * create wizard consults this to hide its probe button when it would only fail.
 * TODO(LSC-70): return true once probeMcpToolsReal routes to `mcp:probeTools`.
 */
export const isProbeAvailable = USE_MOCK;

export function createMcp(params: CreateMcpParams): Promise<{ id: string }> {
  return USE_MOCK ? createMcpMock(params) : createMcpReal(params);
}
