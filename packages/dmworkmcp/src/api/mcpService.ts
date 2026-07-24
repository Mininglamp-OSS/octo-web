import axios, { AxiosRequestConfig } from "axios";
import { WKApp, buildAcceptLanguage, t, DEFAULT_REQUEST_TIMEOUT_MS } from "@octo/base";
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
  UpdateMcpParams,
} from "../types/mcp";
import {
  MCP_CATEGORY_LABELS,
  MCP_CATEGORY_ORDER,
  MOCK_MCP_DETAILS,
  MOCK_MCP_LIST,
  MOCK_PROBED_TOOLS,
} from "../mock/mcpMock";
import { CATEGORY_KEY_ALL, slugifyServerName } from "../utils/constants";
import { McpListError, classifyMcpListError, executeMcpListRequest } from "./mcpListError";

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
//   fetchMcpMine(params)   → list restricted to caller-owned records
//   fetchMcpDetail(id)     → full detail
//   probeMcpTools(req)     → "try connect / fetch tool list" (see LSC-70)
//   createMcp(params)      → create a new MCP entry
//   updateMcp(id, params)  → PATCH — owner-only partial update
//   deleteMcp(id)          → DELETE — owner-only soft delete
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

/**
 * Reject presigned upload / download URLs whose scheme is not http(s), or
 * whose http-scheme host is not a loopback (dev proxy). Blocks the obvious
 * bad schemes — `javascript:`, `data:`, `file:` — before an anchor.href /
 * axios.put reaches them.
 *
 * Scope: this is scheme-level defense-in-depth only. An `https://` URL
 * pointing at an internal / metadata host (`https://10.x`,
 * `https://169.254.169.254`) still passes; that class of concern needs a
 * host allowlist against the known storage origin, which the marketplace
 * hasn't published yet. Blast radius is bounded either way — the PUT
 * carries only the user-selected icon bytes with no app credentials (raw
 * axios, no interceptors).
 */
function assertSafeUploadURL(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(t("mcp.create.iconUploadFailed"));
  }
  if (u.protocol === "https:") return;
  if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return;
  throw new Error(t("mcp.create.iconUploadFailed"));
}

// ─── Mock implementations ──────────────────────────────────────────────────

/** Category pill counts over an arbitrary MCP set. Callers pass the same
 *  filtered slice they showed as items, so pill numbers stay coherent with
 *  the visible list — matches the real backend's `/mcp_categories` which
 *  respects `created_by_type` (issue #894 follow-up). */
function buildCategories(source: McpListItem[] = MOCK_MCP_LIST): McpCategory[] {
  const counts = new Map<string, number>();
  for (const item of source) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }
  return MCP_CATEGORY_ORDER.map((key) => ({
    key,
    label: MCP_CATEGORY_LABELS[key] ?? key,
    count: key === "all" ? source.length : counts.get(key) ?? 0,
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
  const createdBy = params.createdByType;
  const tags = params.tags ?? [];
  const filtered = source.filter((item) => {
    const matchCategory = category === "all" || item.category === category;
    const matchKeyword =
      !keyword ||
      item.name.toLowerCase().includes(keyword) ||
      item.slogan.toLowerCase().includes(keyword);
    // Legacy fixtures without createdByType are treated as human — same
    // read-side default the wire mapper applies for pre-#894 records.
    const rowType = item.createdByType ?? "human";
    const matchCreatedBy = !createdBy || rowType === createdBy;
    // Multi-tag filter is AND: a row must carry every selected tag. Mirrors
    // the backend semantics in octo-marketplace (mcp-v1.md §4.2).
    const matchTags =
      tags.length === 0 || tags.every((tag) => item.tags.includes(tag));
    return matchCategory && matchKeyword && matchCreatedBy && matchTags;
  });
  const offset = params.offset && params.offset > 0 ? params.offset : 0;
  const limit =
    params.limit && params.limit > 0 ? params.limit : filtered.length;
  const items = filtered.slice(offset, offset + limit);
  return delay({
    items,
    total: filtered.length,
    categories: buildCategories(filtered),
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

/** Mock counterpart of PATCH /mcps/{id}. Full-replace semantics: the UI
 *  always sends every field, so we rebuild the detail from the params and
 *  swap the list projection in place. */
async function updateMcpMock(
  id: string,
  params: UpdateMcpParams
): Promise<McpDetail> {
  const idx = MOCK_MCP_DETAILS.findIndex((d) => d.id === id);
  if (idx === -1) throw new Error(`MCP not found: ${id}`);
  const prev = MOCK_MCP_DETAILS[idx];
  const next = buildDetailFromCreate(id, params);
  // Preserve server-owned fields — the wire never lets the client change
  // these, so the mock must match: creator identity and the provenance
  // triple (issue #894). Otherwise a mock edit of a bot record would
  // silently drop its 🤖 badge on the next read.
  next.creatorName = prev.creatorName;
  next.createdByType = prev.createdByType;
  next.createdByBotUid = prev.createdByBotUid;
  next.createdByBotName = prev.createdByBotName;
  MOCK_MCP_DETAILS[idx] = next;
  const listIdx = MOCK_MCP_LIST.findIndex((it) => it.id === id);
  if (listIdx !== -1) MOCK_MCP_LIST[listIdx] = projectListItem(next);
  return delay(next, 300);
}

/** Mock counterpart of DELETE /mcps/{id}. Owner-only in the real service;
 *  the mock has no owner model so we always allow. */
async function deleteMcpMock(id: string): Promise<void> {
  const dIdx = MOCK_MCP_DETAILS.findIndex((d) => d.id === id);
  if (dIdx !== -1) MOCK_MCP_DETAILS.splice(dIdx, 1);
  const lIdx = MOCK_MCP_LIST.findIndex((it) => it.id === id);
  if (lIdx !== -1) MOCK_MCP_LIST.splice(lIdx, 1);
  return delay(undefined, 300);
}

/** Turn a create-form payload into a fully-populated detail record. */
function buildDetailFromCreate(id: string, params: CreateMcpParams): McpDetail {
  const quickStart: McpQuickStart = {
    transport: params.transport,
    serverName: params.name.trim(),
    slug: slugifyServerName(params.slug?.trim() ? params.slug : params.name),
    url: params.url || undefined,
    headers:
      params.headers && Object.keys(params.headers).length
        ? params.headers
        : undefined,
    headersUserSupplied:
      params.headersUserSupplied && params.headersUserSupplied.length
        ? params.headersUserSupplied
        : undefined,
    command: params.command || undefined,
    args: params.args && params.args.length ? params.args : undefined,
    env: params.env && Object.keys(params.env).length ? params.env : undefined,
    envUserSupplied:
      params.envUserSupplied && params.envUserSupplied.length
        ? params.envUserSupplied
        : undefined,
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

/** Derive the list-card projection from a full detail. Carries provenance
 *  through (issue #894) so a bot-created record keeps its 🤖 badge on the
 *  card view after create/update in USE_MOCK mode. */
function projectListItem(d: McpDetail): McpListItem {
  return {
    id: d.id,
    name: d.name,
    slogan: d.slogan,
    category: d.category,
    tags: d.tags,
    toolCount: d.toolCount,
    icon: d.icon,
    createdByType: d.createdByType,
    createdByBotUid: d.createdByBotUid,
    createdByBotName: d.createdByBotName,
    creatorName: d.creatorName,
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

/** Serialise axios request params as repeated keys (`?a=1&a=2`) instead of
 *  axios 0.25's default `?a[]=1&a[]=2`. gin's QueryArray on the marketplace
 *  backend only recognises the plain-repeat form; a bracketed key would
 *  silently become a single-string param that never matches. Also drops
 *  undefined/null keys so callers can just pass an optional value without
 *  pre-filtering. Exported so the wire contract can be pinned in unit
 *  tests without spinning up an axios instance. */
export function serializeMcpParams(
  params: Record<string, unknown> | undefined
): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        usp.append(key, String(item));
      }
    } else {
      usp.append(key, String(value));
    }
  }
  return usp.toString();
}

const mcpAxios = axios.create({
  baseURL: "",
  // Isolated instance (no shared interceptors), so it never picks up the
  // 20s default that APIClient.initAxios sets on the axios singleton — set
  // the same ceiling explicitly to avoid the UI-hang class of bug that
  // DEFAULT_REQUEST_TIMEOUT_MS was introduced to close.
  timeout: DEFAULT_REQUEST_TIMEOUT_MS,
  paramsSerializer: serializeMcpParams,
});

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
 * Marketplace errors use the OCTO `{error:{code,message,details,hint}}` envelope. When we
 * recognize the wire `code` we surface a localized copy so a Chinese UI
 * doesn't show the backend's English `message`; unknown codes fall through to
 * the wire message. Falls back to the axios error string when the body is
 * missing.
 */
function extractErrorMessage(err: unknown): string {
  const axiosErr = err as {
    response?: { data?: { error?: { message?: string; code?: string } } };
  };
  const wire = axiosErr?.response?.data?.error;
  const code = wire?.code;
  const localized = code ? localizedForCode(code) : "";
  const raw =
    localized ||
    wire?.message ||
    code ||
    (err instanceof Error ? err.message : "Request failed");
  return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
}

/** Map a standard OCTO error code to a localized string via i18n. Returns
 *  empty string if the code is unknown; caller falls back to the wire
 *  message. Keeping the mapping table here keeps the i18n keys colocated
 *  with the codes and greppable. */
function localizedForCode(code: string): string {
  const KNOWN: Record<string, string> = {
    DUPLICATE: "mcp.errors.nameTaken",
    VALIDATION_ERROR: "mcp.errors.invalidRequest",
    FORBIDDEN: "mcp.errors.forbidden",
    NOT_FOUND: "mcp.errors.notFound",
    AUTH_REQUIRED: "mcp.errors.unauthorized",
    INTERNAL_ERROR: "mcp.errors.internal",
  };
  const key = KNOWN[code];
  return key ? t(key) : "";
}

/**
 * Marketplace success bodies use the OCTO `{data:...}` envelope.
 */
async function get<T>(
  path: string,
  params?: Record<string, unknown>,
  config?: AxiosRequestConfig
): Promise<T> {
  try {
    const resp = await mcpAxios.get(`${BASE}${path}`, { params, ...config });
    return resp.data.data as T;
  } catch (err) {
    if (axios.isCancel(err)) throw err;
    throw new McpListError(classifyMcpListError(err));
  }
}

async function post<T>(path: string, data?: unknown): Promise<T> {
  try {
    const resp = await mcpAxios.post(`${BASE}${path}`, data);
    return resp.data.data as T;
  } catch (err) {
    if (axios.isCancel(err)) throw err;
    throw new Error(extractErrorMessage(err));
  }
}

async function patch<T>(path: string, data?: unknown): Promise<T> {
  try {
    const resp = await mcpAxios.patch(`${BASE}${path}`, data);
    return resp.data.data as T;
  } catch (err) {
    if (axios.isCancel(err)) throw err;
    throw new Error(extractErrorMessage(err));
  }
}

async function del(path: string): Promise<void> {
  try {
    await mcpAxios.delete(`${BASE}${path}`);
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
interface McpListItemWire {
  mcp_id: string;
  name: string;
  slogan: string;
  category: string;
  icon: string;
  tags: string[];
  tool_count: number;
  visibility?: McpListItem["visibility"];
  creator_name?: string;
  created_by_type?: McpListItem["createdByType"];
  created_by_bot_uid?: string;
  created_by_bot_name?: string;
  transport?: McpListItem["transport"];
  source?: McpListItem["source"];
  verification_status?: McpListItem["verificationStatus"];
  match_reasons?: string[];
  relevance?: number;
  updated_at?: string;
}

interface McpDetailWire extends McpListItemWire {
  quick_start: {
    transport: McpQuickStart["transport"];
    server_name: string;
    slug?: string;
    url?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    env_user_supplied?: string[];
    headers?: Record<string, string>;
    headers_user_supplied?: string[];
    // Legacy marker (mcp-v1.md §5.2). No longer sent on new records —
    // Bearer auth is expressed as an `Authorization` row + toggle ON —
    // but pre-toggle records still carry `auth_type: "bearer"` without a
    // matching `Authorization` header entry. mapDetail synthesizes the
    // missing user-supplied entry so the copy-paste snippet keeps
    // rendering an Authorization line for those records.
    auth_type?: "bearer" | "none";
  };
  tools: McpDetail["tools"];
  usage_examples: string[];
  faqs: McpDetail["faqs"];
  notes: string[];
  created_at?: string;
  updated_at?: string;
}

interface McpListResponseWire {
  data: McpListItemWire[];
  pagination: { total: number; page: number; page_size: number };
}

function mapListItem(raw: McpListItemWire): McpListItem {
  return {
    id: raw.mcp_id,
    name: raw.name ?? "",
    // Fall back to empty string / 0 so downstream renderers that call
    // .toLowerCase() (Highlight) or format the tool count don't crash on a
    // null field slipping in from a legacy record or partial response.
    slogan: raw.slogan ?? "",
    category: raw.category,
    icon: raw.icon,
    tags: raw.tags ?? [],
    toolCount: raw.tool_count ?? 0,
    visibility: raw.visibility,
    creatorName: raw.creator_name,
    createdByType: raw.created_by_type,
    createdByBotUid: raw.created_by_bot_uid,
    createdByBotName: raw.created_by_bot_name,
    transport: raw.transport, source: raw.source,
    verificationStatus: raw.verification_status,
    matchReasons: raw.match_reasons ?? [], relevance: raw.relevance,
    updatedAt: raw.updated_at,
  };
}

function mapDetail(raw: McpDetailWire): McpDetail {
  const item = mapListItem(raw);
  // Guard against a missing `quick_start` block on the wire — while
  // McpDetailWire types it as required, a null/absent value from a legacy
  // record or a partial backend response would otherwise crash the whole
  // detail-modal fetch with `Cannot read properties of null`. Fall back to
  // an empty stdio-shaped block so the modal renders with an empty
  // quick-access tab instead of blowing up.
  const q = raw.quick_start ?? ({} as McpDetailWire["quick_start"]);
  // Legacy-bearer migration shim: records created before the
  // user_supplied toggle model expressed Bearer auth via
  // `auth_type: "bearer"` alone, without a matching Authorization row.
  // The snippet renderer no longer looks at auth_type, so without
  // synthesizing an entry here those old snippets ship WITHOUT an
  // Authorization line at all. Rebuild a user-supplied Authorization
  // slot so consumers still see a placeholder to fill in. Only fires
  // when the wire had no Authorization key already (any explicit row
  // wins over the marker).
  let headers = q.headers;
  let headersUserSupplied = q.headers_user_supplied;
  if (q.auth_type === "bearer") {
    const hasAuthKey = !!(
      headers &&
      Object.keys(headers).some((k) => k.toLowerCase() === "authorization")
    );
    if (!hasAuthKey) {
      headers = { ...(headers ?? {}), Authorization: "" };
      headersUserSupplied = [
        ...(headersUserSupplied ?? []),
        "Authorization",
      ];
    }
  }
  return {
    ...item,
    quickStart: {
      transport: q.transport ?? "stdio",
      serverName: q.server_name ?? raw.name ?? "",
      slug: q.slug,
      url: q.url,
      command: q.command,
      args: q.args,
      env: q.env,
      envUserSupplied: q.env_user_supplied,
      headers,
      headersUserSupplied,
    },
    tools: raw.tools ?? [],
    usageExamples: raw.usage_examples ?? [],
    faqs: raw.faqs ?? [],
    notes: raw.notes ?? [],
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function toWireParams(params: CreateMcpParams | UpdateMcpParams) {
  return {
    name: params.name,
    slug: params.slug,
    slogan: params.slogan,
    category: params.category,
    icon: params.icon,
    tags: params.tags,
    transport: params.transport,
    url: params.url,
    command: params.command,
    args: params.args,
    env: params.env,
    env_user_supplied: params.envUserSupplied,
    headers: params.headers,
    headers_user_supplied: params.headersUserSupplied,
    tools: params.tools,
    usage_examples: params.usageExamples,
    faqs: params.faqs,
    notes: params.notes,
    visibility: params.visibility,
  };
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
  query.category = params.categories?.length ? params.categories[0] : (params.category ?? CATEGORY_KEY_ALL);
  if (params.createdByType) {
    query.created_by_type = params.createdByType;
  }
  // Relevance is only meaningful with a keyword — every row scores 0 otherwise,
  // making the sort order arbitrary. When browsing, surface freshest first.
  query.sort = keyword ? "relevance" : "updated";
  // Multi-tag filter — mcp-v1.md §4.2 accepts `tag` as repeatable OR
  // comma-separated. We use REPEATED params (`tag=a&tag=b&tag=c`) so a
  // tag value that happens to contain a comma still round-trips intact;
  // comma-joining would let the backend re-split "v1.0,beta" into two
  // wrong tags and produce silent empty results.
  if (params.tags?.length) {
    query.tag = params.tags;
  }
  const pageSize = params.limit && params.limit > 0 ? params.limit : 20;
  query.page_size = pageSize;
  query.page = Math.floor((params.offset ?? 0) / pageSize) + 1;
  // Category counts must honour the SAME `created_by_type` filter as the
  // item list, otherwise the pill numbers become misleading when a source
  // filter is active (issue #894 follow-up). `/mcps/mine` scopes to the
  // caller via mode=mine; the source filter piggy-backs on top. Both are
  // passed through the shared axios params serializer, so there's a single
  // wire-shape truth for repeated-array values.
  const categoryParams: Record<string, unknown> = {};
  if (path === "/mcps/mine") categoryParams.mode = "mine";
  if (params.createdByType) categoryParams.created_by_type = params.createdByType;
  const [resp, categoryWire] = await executeMcpListRequest(() => Promise.all([
      mcpAxios.get<McpListResponseWire>(`${BASE}${path}`, { params: query }),
      mcpAxios
        .get<{ data: { key: string; count: number }[] }>(`${BASE}/mcp_categories`, {
          params: categoryParams,
        })
        .then((r) => r.data.data),
    ]));
  const items = (resp.data.data ?? []).map(mapListItem);
  const categoryCounts = new Map(
    categoryWire.map((item) => [item.key, item.count])
  );
  const categories: McpCategory[] = MCP_CATEGORY_ORDER.map((key) => ({
    key,
    label: categoryLabel(key),
    count: categoryCounts.get(key) ?? 0,
  }));
  return { items, total: resp.data.pagination.total, categories };
}

async function fetchMcpDetailReal(id: string): Promise<McpDetail> {
  return get<McpDetailWire>(`/mcps/${encodeURIComponent(id)}`).then(mapDetail);
}

async function probeMcpToolsReal(
  req: McpProbeRequest
): Promise<McpProbeResult> {
  // POST /mcps/probe runs an MCP initialize + tools/list handshake against a
  // remote server and returns the wire shape below (mcp-v1.md §4.7). The
  // endpoint returns HTTP 200 in both success and operational-failure cases
  // (ok=false + in-body error). Only auth / malformed body / stdio transport
  // return the standard error envelope with a non-2xx status; those become
  // thrown Errors via post(), which the caller renders as a Toast.
  //
  // stdio transport is short-circuited here so we don't round-trip a request
  // the server is guaranteed to reject with `probe_unsupported`. The wizard
  // hides the button under `isProbeAvailable` anyway; this belt+braces path
  // just returns a clean in-body error for any programmatic caller.
  if (req.transport === "stdio") {
    return {
      ok: false,
      tools: [],
      error: {
        code: "command_not_found",
        message: "stdio probe must run in the desktop client",
      },
    };
  }
  const raw = await post<{
    is_ok: boolean;
    tools: McpProbeResult["tools"];
    server_info?: McpProbeResult["serverInfo"];
    error?: McpProbeResult["error"];
  }>("/mcps/_probe", req);
  return {
    ok: raw.is_ok,
    tools: raw.tools ?? [],
    serverInfo: raw.server_info,
    error: raw.error,
  };
}

async function createMcpReal(params: CreateMcpParams): Promise<{ id: string }> {
  // POST /mcps returns 201 with the full McpDetail; the frontend picks up `id`
  // from the response (mcp-v1.md §4.1). Server derives id / creatorName /
  // toolCount / timestamps and ignores any client-supplied values for them, so
  // the flat create body is sent as-is (§3.3).
  const detail = await post<McpDetailWire>("/mcps", toWireParams(params));
  return { id: detail.mcp_id };
}

/** PATCH /mcps/{id} — owner-only partial update (mcp-v1.md §4.5). The UI
 *  always sends the full form, so every field is present and the backend
 *  effectively replaces all mutable fields; returns 200 with the updated
 *  McpDetail. 403 → forbidden, 404 → not_found are surfaced by the shared
 *  error mapper. */
async function updateMcpReal(
  id: string,
  params: UpdateMcpParams
): Promise<McpDetail> {
  return patch<McpDetailWire>(
    `/mcps/${encodeURIComponent(id)}`,
    toWireParams(params)
  ).then(mapDetail);
}

/** DELETE /mcps/{id} — owner-only soft delete (mcp-v1.md §4.6). Returns
 *  204 No Content on success. */
async function deleteMcpReal(id: string): Promise<void> {
  return del(`/mcps/${encodeURIComponent(id)}`);
}

/**
 * Upload an MCP icon and return the persisted URL to write onto the `icon`
 * field.
 *
 * Uses marketplace's presigned URL flow (POST /api/v1/mcp/upload/icon) —
 * same channel octo-admin uses. The client asks marketplace for a
 * pre-signed PUT URL + a persistent download URL, PUTs the bytes directly
 * to storage, then stores the download URL on the MCP record. The `id`
 * parameter is ignored (kept for signature compatibility with the mock and
 * older callers); marketplace assigns its own UUID to the object key.
 *
 * Prior implementation rode on the main IM's `file/upload/credentials`
 * endpoint. Two upload channels for the same feature was operational churn
 * — marketplace's own storage layer handles both admin and user paths now,
 * so this frontend uses one.
 */
async function uploadMcpIconReal(_id: string, file: File): Promise<string> {
  interface McpIconInitResponse {
    object_key: string;
    presigned_url: string;
    expires_in: number;
    method: string;
    headers: Record<string, string>;
    download_url: string;
  }

  const init = await mcpAxios.post<{ data: McpIconInitResponse }>(
    `${resolveBaseURL()}${BASE}/mcp_icon_uploads`,
    {
      file_name: file.name || "icon",
      file_size: file.size,
      content_type: file.type || "application/octet-stream",
    }
  );
  if (
    !init.data?.data?.presigned_url ||
    !init.data?.data?.download_url
  ) {
    throw new Error(t("mcp.create.iconUploadFailed"));
  }
  const { presigned_url, download_url, headers } = init.data.data;
  // Defense-in-depth: the presigned URLs come back from our own marketplace
  // backend, but any downstream misconfiguration/compromise could point them
  // at an internal address or a non-HTTPS host. Only allow https:// (or
  // http:// on localhost for dev proxies).
  assertSafeUploadURL(presigned_url);
  assertSafeUploadURL(download_url);

  // PUT the icon bytes through a dedicated axios instance with no
  // interceptors. Prior implementation used the default `axios` singleton,
  // but `packages/dmworkbase/src/Service/APIClient.ts` registers a GLOBAL
  // request interceptor on that singleton which injects `token: <session>`
  // and `X-Space-Id: ...` on every request. The presigned URL points at an
  // external storage origin (not marketplace), so those headers would leak
  // the caller's session token to a third-party host — flagged as P1
  // credential exposure in PR#851 review (yujiawei). `axios.create()` here
  // is a fresh instance that never picked up the interceptor, so no
  // credentials cross the origin. It also avoids the sibling risk of some
  // S3/OSS presigners rejecting unsigned/unexpected headers with
  // `SignatureDoesNotMatch`.
  const rawAxios = axios.create();
  const putResp = await rawAxios.put(presigned_url, file, {
    headers: headers ?? {},
    timeout: 2 * 60 * 1000,
    // Disable axios's default JSON transform — we want the file bytes
    // sent as-is, not stringified.
    transformRequest: [(data) => data],
  });
  if (!(putResp.status >= 200 && putResp.status < 300)) {
    throw new Error(t("mcp.create.iconUploadFailed"));
  }
  return download_url;
}

/** Mock icon upload — returns an object URL so the mock detail renders the
 *  freshly-picked image without a backend round-trip. */
async function uploadMcpIconMock(_id: string, file: File): Promise<string> {
  return delay(URL.createObjectURL(file), 200);
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

/** One tag suggestion in the tag-filter popover (mcp-v1.md §4.8). */
export interface McpTagSuggestion {
  name: string;
  count: number;
}

/** GET /market/api/v1/mcp_tags — tag suggestions for the search-bar
 *  popover. Backend aggregates across the caller's visible set (system +
 *  space rows), sorted by descending count. Empty `query` returns every
 *  visible tag; the backend clamps `limit` to [1, 100] with default 50.
 *  Pass `mode: "mine"` when the popover opens from the "我的" tab so
 *  suggestions match `GET /mcps/mine`. */
export function fetchMcpTags(
  query = "",
  opts: { signal?: AbortSignal; limit?: number; mode?: "all" | "mine" } = {}
): Promise<McpTagSuggestion[]> {
  return USE_MOCK
    ? fetchMcpTagsMock(query, opts)
    : fetchMcpTagsReal(query, opts);
}

async function fetchMcpTagsMock(
  query: string,
  opts: { signal?: AbortSignal; limit?: number; mode?: "all" | "mine" }
): Promise<McpTagSuggestion[]> {
  // Aggregate from the in-memory mock list. `mode: "mine"` mirrors
  // fetchMcpMineMock's owner filter (creatorName === caller). Signal +
  // limit honored for parity with the real backend so the mock behaves
  // the same in dev harnesses; the mock body is otherwise unreachable in
  // production (USE_MOCK is a `const false` at :59).
  if (opts.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const source =
    opts.mode === "mine"
      ? MOCK_MCP_LIST.filter((it) => it.creatorName === (WKApp.loginInfo?.name || ""))
      : MOCK_MCP_LIST;
  const counts = new Map<string, number>();
  for (const item of source) {
    for (const tag of item.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  const kw = query.trim().toLowerCase();
  const items: McpTagSuggestion[] = [];
  counts.forEach((count, name) => {
    if (kw && !name.toLowerCase().includes(kw)) return;
    items.push({ name, count });
  });
  items.sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name));
  // Backend clamps `limit` to [1, 100] with default 50.
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const trimmed = items.slice(0, limit);
  return new Promise<McpTagSuggestion[]>((resolve, reject) => {
    const timer = setTimeout(() => resolve(trimmed), MOCK_DELAY_MS);
    opts.signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

async function fetchMcpTagsReal(
  query: string,
  opts: { signal?: AbortSignal; limit?: number; mode?: "all" | "mine" }
): Promise<McpTagSuggestion[]> {
  const params: Record<string, unknown> = {};
  if (query.trim()) params.q = query.trim();
  if (opts.limit && opts.limit > 0) params.limit = opts.limit;
  if (opts.mode === "mine") params.mode = "mine";
  // Route through the shared get<T>() helper so 4xx/5xx/network failures
  // are classified into McpListError like every other read endpoint. The
  // helper re-throws axios cancels unchanged, so the caller's abort branch
  // still fires. Array.isArray guard covers a non-list envelope (`{}` or
  // `{data:null}`) surfacing as an empty suggestions list.
  const data = await get<McpTagSuggestion[] | null>(`/mcp_tags`, params, {
    signal: opts.signal,
  });
  return Array.isArray(data) ? data : [];
}

/**
 * Try-connect + fetch tool list. Mock returns a fake tool set after a delay;
 * the real implementation is provided by the Electron main process (LSC-70).
 */
export function probeMcpTools(req: McpProbeRequest): Promise<McpProbeResult> {
  return USE_MOCK ? probeMcpToolsMock(req) : probeMcpToolsReal(req);
}

/**
 * Whether "try connect / fetch tool list" is actually wired up. Real remote
 * probing (streamable-http / sse) is served by POST /mcps/probe on the
 * marketplace backend (mcp-v1.md §4.7). stdio probing still requires the
 * desktop client's Electron IPC (LSC-70) and is short-circuited to an in-body
 * `command_not_found` error inside probeMcpToolsReal — the button surfaces
 * regardless so the user can always kick off a remote probe.
 */
export const isProbeAvailable = true;

export function createMcp(params: CreateMcpParams): Promise<{ id: string }> {
  return USE_MOCK ? createMcpMock(params) : createMcpReal(params);
}

/** PATCH /mcps/{id} — owner-only partial update. Returns the updated detail. */
export function updateMcp(
  id: string,
  params: UpdateMcpParams
): Promise<McpDetail> {
  return USE_MOCK ? updateMcpMock(id, params) : updateMcpReal(id, params);
}

/** DELETE /mcps/{id} — owner-only soft delete. */
export function deleteMcp(id: string): Promise<void> {
  return USE_MOCK ? deleteMcpMock(id) : deleteMcpReal(id);
}

/**
 * Upload an MCP icon to object storage (POST /mcps/{id}/icon, multipart).
 * Returns the persisted storage URL to store on the `icon` field.
 */
export function uploadMcpIcon(id: string, file: File): Promise<string> {
  return USE_MOCK ? uploadMcpIconMock(id, file) : uploadMcpIconReal(id, file);
}
