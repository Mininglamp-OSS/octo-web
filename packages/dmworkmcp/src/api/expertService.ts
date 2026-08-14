import axios, { AxiosRequestConfig } from "axios";
import { WKApp, buildAcceptLanguage, t, DEFAULT_REQUEST_TIMEOUT_MS } from "@octo/base";
import type {
  ExpertAgent,
  ExpertItem,
  ExpertSquad,
} from "../mock/expertMock";
import {
  EXPERT_AGENTS,
  EXPERT_CATEGORIES,
  EXPERT_SQUADS,
} from "../mock/expertMock";
import {
  mapAgentDetail,
  mapAgentListItem,
  mapSquadDetail,
  mapSquadListItem,
} from "./expertWire";
import type {
  ExpertAgentDetailWire,
  ExpertAgentListItemWire,
  ExpertSquadDetailWire,
  ExpertSquadListItemWire,
} from "./expertWire";
import { CATEGORY_KEY_ALL } from "../utils/constants";
import {
  ExpertListError,
  classifyExpertListError,
  executeExpertListRequest,
} from "./expertListError";

// ═══════════════════════════════════════════════════════════════════════════
// Expert Marketplace service layer (专家市场)
// ═══════════════════════════════════════════════════════════════════════════
//
// The UI (list page + detail/publish modals) ONLY imports the exported
// functions below — it never talks to axios or the mock directly. This keeps
// data-fetching behind a single seam so switching from mock to the real
// backend is a one-line change (USE_MOCK). Mirrors mcpService.ts verbatim
// (isolated axios instance + interceptors + `{data:...}` envelope unwrapping).
//
// The real implementations target the octo-marketplace Expert catalog v1
// (octo-marketplace/docs/api/expert-v1.md), mounted at /market/api/v1. Unlike
// mcpService, requests stay SAME-ORIGIN (relative /market/api/v1/...): in dev
// the vite proxy forwards /market to the local marketplace, in prod the gateway
// routes it. We deliberately do NOT rewrite baseURL to the apiURL origin (which
// in dev is a remote test server without the expert endpoints).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Single switch between mock and real implementations. Real backend by default;
 * the mock branch stays working as a fallback / dev demo.
 */
const USE_MOCK = false;

// Simulate network latency so loading states are exercised during dev.
const MOCK_DELAY_MS = 200;

function delay<T>(value: T, ms = MOCK_DELAY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export type ExpertKindParam = "agent" | "squad";

/** List query params shared by all four list endpoints (expert-v1.md §4.2). */
export interface ListExpertParams {
  keyword?: string;
  /** Category NAME; "全部" / "all" disables the filter. */
  category?: string;
  tags?: string[];
  page?: number;
  pageSize?: number;
}

export interface ExpertListResult {
  items: ExpertItem[];
  total: number;
}

export interface ExpertCategoryCount {
  name: string;
  count: number;
}

// The "all" sentinel that disables the category filter — the frontend's
// localized chip (EXPERT_CATEGORIES[0]) and the backend's reserved
// CATEGORY_KEY_ALL ("all"). Sourced from the shared list, not re-typed.
const ALL_CATEGORY = EXPERT_CATEGORIES[0];

// ─── Request plumbing (mirrors mcpService.ts) ───────────────────────────────

/** Serialise axios request params as repeated keys (`?a=1&a=2`) instead of
 *  axios's default bracketed form. gin's QueryArray on the marketplace backend
 *  only recognises the plain-repeat form. Also drops undefined/null so callers
 *  can pass optional values without pre-filtering. Exported so the wire
 *  contract can be pinned in unit tests without an axios instance. */
export function serializeExpertParams(
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

const expertAxios = axios.create({
  baseURL: "",
  // Isolated instance (no shared interceptors) — set the same ceiling APIClient
  // uses so a hung request can't wedge the UI.
  timeout: DEFAULT_REQUEST_TIMEOUT_MS,
  paramsSerializer: serializeExpertParams,
});

const BASE = "/market/api/v1";
// Loop workspaces/runtimes are served by the fleet service (octo-fleet), NOT
// marketplace. Fleet's native paths are /v1/*; the public shape everywhere in
// this repo is /fleet/api/v1/* (vite.config.ts: the dev "/fleet/api/v1" rule
// proxies to a local fleet, prod nginx strips /fleet/api and forwards /v1/* —
// the daemon likewise calls OCTO_FLEET_URL + /v1/*). Same-origin like BASE —
// the request interceptor above attaches token + X-Space-Id, which fleet's
// auth middleware also reads.
const FLEET_BASE = "/fleet/api/v1";

expertAxios.interceptors.request.use((config) => {
  // Same-origin: leave baseURL empty so /market/api/v1/* is a relative path
  // served by the app origin (dev proxy / prod gateway). Do NOT rewrite it to
  // the apiURL origin — that host does not serve the expert endpoints in dev.
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

expertAxios.interceptors.response.use(
  (resp) => resp,
  (err) => {
    // Only a marketplace 401 means the session itself is invalid. A 401 from the
    // fleet service (secondary, reached via a different gateway path) must NOT
    // tear down the whole session — otherwise a fleet-only auth hiccup, or the
    // Loop-target prefetch that now fires on market mount, would silently log the
    // user out with no action. Fleet 401s propagate to the caller instead (the
    // dialog surfaces the error; the prefetch swallows it). A genuinely expired
    // session still logs out via the marketplace list calls the page makes.
    const url = (err?.config?.url as string | undefined) ?? "";
    if (
      err?.response?.status === 401 &&
      !url.startsWith(FLEET_BASE) &&
      // The view-tracking beacon is fire-and-forget: a 401 on it must never
      // tear down the session (the page's list calls are the authoritative
      // session probe and still log out on a genuinely expired token).
      !url.endsWith("/metrics/track")
    ) {
      WKApp.shared.logout();
    }
    return Promise.reject(err);
  }
);

/**
 * Marketplace errors use the OCTO `{error:{code,message}}` envelope. Recognised
 * codes surface a localized copy (reusing the mcp.errors.* keys) so a Chinese
 * UI doesn't show the backend's English message; unknown codes fall through to
 * the wire message, then the axios error string.
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

/** Map a standard OCTO error code to a localized string via i18n. Returns empty
 *  string on an unknown code so the caller falls back to the wire message. */
function localizedForCode(code: string): string {
  const KNOWN: Record<string, string> = {
    DUPLICATE: "mcp.errors.nameTaken",
    CONFLICT: "mcp.errors.nameTaken",
    VALIDATION_ERROR: "mcp.errors.invalidRequest",
    FORBIDDEN: "mcp.errors.forbidden",
    NOT_FOUND: "mcp.errors.notFound",
    AUTH_REQUIRED: "mcp.errors.unauthorized",
    INTERNAL_ERROR: "mcp.errors.internal",
  };
  const key = KNOWN[code];
  return key ? t(key) : "";
}

/** Marketplace success bodies use the OCTO `{data:...}` envelope. */
async function get<T>(
  path: string,
  params?: Record<string, unknown>,
  config?: AxiosRequestConfig
): Promise<T> {
  try {
    const resp = await expertAxios.get(`${BASE}${path}`, { params, ...config });
    return resp.data.data as T;
  } catch (err) {
    if (axios.isCancel(err)) throw err;
    throw new ExpertListError(classifyExpertListError(err));
  }
}

async function del(path: string): Promise<void> {
  try {
    await expertAxios.delete(`${BASE}${path}`);
  } catch (err) {
    if (axios.isCancel(err)) throw err;
    throw new Error(extractErrorMessage(err));
  }
}

/** GET against the fleet service. Unlike the marketplace helpers, fleet returns
 *  the payload bare at `resp.data` (no `{data:...}` envelope), so we do NOT
 *  unwrap `.data`. */
async function fleetGet<T>(
  path: string,
  params?: Record<string, unknown>
): Promise<T> {
  try {
    const resp = await expertAxios.get(`${FLEET_BASE}${path}`, { params });
    return resp.data as T;
  } catch (err) {
    if (axios.isCancel(err)) throw err;
    throw new Error(extractErrorMessage(err));
  }
}

// ─── Real implementations (octo-marketplace expert catalog v1) ──────────────

/** Wire envelope for the list endpoints. */
interface ExpertListResponseWire<W> {
  data: W[];
  pagination?: { total: number; page: number; page_size: number };
}

/** Build the query object for a list request. `category` is the NAME; the
 *  "all" sentinels ("全部" / "all") are omitted so the backend disables the
 *  filter. `tag` is sent as repeated params. */
function buildListQuery(params: ListExpertParams): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  const keyword = params.keyword?.trim();
  if (keyword) query.keyword = keyword;
  const category = params.category?.trim();
  if (category && category !== ALL_CATEGORY && category !== CATEGORY_KEY_ALL) {
    query.category = category;
  }
  if (params.tags?.length) query.tag = params.tags;
  query.page = params.page && params.page > 0 ? params.page : 1;
  query.page_size = params.pageSize && params.pageSize > 0 ? params.pageSize : 100;
  return query;
}

async function listPathReal<W>(
  path: string,
  params: ListExpertParams,
  map: (raw: W) => ExpertItem
): Promise<ExpertListResult> {
  const query = buildListQuery(params);
  const resp = await executeExpertListRequest(() =>
    expertAxios.get<ExpertListResponseWire<W>>(`${BASE}${path}`, { params: query })
  );
  const items = (resp.data.data ?? []).map(map);
  return { items, total: resp.data.pagination?.total ?? items.length };
}

const listExpertsReal = (params: ListExpertParams) =>
  listPathReal<ExpertAgentListItemWire>("/experts", params, mapAgentListItem);
const listMyExpertsReal = (params: ListExpertParams) =>
  listPathReal<ExpertAgentListItemWire>("/experts/mine", params, mapAgentListItem);
const listSquadsReal = (params: ListExpertParams) =>
  listPathReal<ExpertSquadListItemWire>("/squads", params, mapSquadListItem);
const listMySquadsReal = (params: ListExpertParams) =>
  listPathReal<ExpertSquadListItemWire>("/squads/mine", params, mapSquadListItem);

const getExpertReal = (id: string) =>
  get<ExpertAgentDetailWire>(`/experts/${encodeURIComponent(id)}`).then(mapAgentDetail);
const getSquadReal = (id: string) =>
  get<ExpertSquadDetailWire>(`/squads/${encodeURIComponent(id)}`).then(mapSquadDetail);

const deleteExpertReal = (id: string) => del(`/experts/${encodeURIComponent(id)}`);
const deleteSquadReal = (id: string) => del(`/squads/${encodeURIComponent(id)}`);

/** POST /metrics/track — bump the backend view counter. Only detail views are
 *  tracked (opening the modal), matching the skill market's semantics.
 *  Fire-and-forget: every failure is swallowed here so no call site ever has
 *  to remember to catch a rejection that carries no actionable signal. */
async function trackExpertViewReal(kind: ExpertKindParam, id: string): Promise<void> {
  try {
    await expertAxios.post(`${BASE}/metrics/track`, {
      resource_type: kind === "squad" ? "squad" : "expert",
      resource_id: id,
      event_type: "view",
    });
  } catch {
    // A lost view must never block or break the detail view.
  }
}

async function listExpertTagsReal(kind: ExpertKindParam): Promise<string[]> {
  const data = await get<{ name: string; count: number }[] | null>(
    "/expert_tags",
    { kind }
  );
  return Array.isArray(data) ? data.map((tag) => tag.name) : [];
}

async function listExpertCategoriesReal(
  kind: ExpertKindParam
): Promise<ExpertCategoryCount[]> {
  const data = await get<
    { expert_category_id: string; name: string; count: number }[] | null
  >("/expert_categories", { kind });
  return Array.isArray(data)
    ? data.map((c) => ({ name: c.name, count: c.count }))
    : [];
}

// ─── Mock implementations (session-local CRUD over module arrays) ───────────
// Mutable copies of the fixtures so USE_MOCK still demos create/update/delete
// within a session. A page reload resets to the built-in fixtures.
const mockAgents: ExpertAgent[] = EXPERT_AGENTS.map((a) => ({ ...a }));
const mockSquads: ExpertSquad[] = EXPERT_SQUADS.map((s) => ({ ...s }));

function matchesFilters(item: ExpertItem, params: ListExpertParams): boolean {
  const keyword = (params.keyword ?? "").trim().toLowerCase();
  const category = params.category;
  const tags = params.tags ?? [];
  const matchKeyword =
    !keyword ||
    item.name.toLowerCase().includes(keyword) ||
    item.summary.toLowerCase().includes(keyword) ||
    item.tags.some((tag) => tag.toLowerCase().includes(keyword));
  const matchCategory =
    !category ||
    category === ALL_CATEGORY ||
    category === CATEGORY_KEY_ALL ||
    item.category === category;
  const matchTags =
    tags.length === 0 || tags.every((tag) => item.tags.includes(tag));
  return matchKeyword && matchCategory && matchTags;
}

function paginate<T>(source: T[], params: ListExpertParams): { items: T[]; total: number } {
  const pageSize = params.pageSize && params.pageSize > 0 ? params.pageSize : 100;
  const page = params.page && params.page > 0 ? params.page : 1;
  const start = (page - 1) * pageSize;
  return { items: source.slice(start, start + pageSize), total: source.length };
}

function listMockFrom(
  source: ExpertItem[],
  params: ListExpertParams
): Promise<ExpertListResult> {
  const filtered = source.filter((item) => matchesFilters(item, params));
  const { items, total } = paginate(filtered, params);
  return delay({ items, total });
}

function isMine(item: ExpertItem): boolean {
  const self = t("mcp.expert.selfCreator");
  return item.mine === true || item.creatorName === self;
}

const listExpertsMock = (params: ListExpertParams) => listMockFrom(mockAgents, params);
const listSquadsMock = (params: ListExpertParams) => listMockFrom(mockSquads, params);
const listMyExpertsMock = (params: ListExpertParams) =>
  listMockFrom(mockAgents.filter(isMine), params);
const listMySquadsMock = (params: ListExpertParams) =>
  listMockFrom(mockSquads.filter(isMine), params);

const getExpertMock = (id: string): Promise<ExpertAgent> => {
  const found = mockAgents.find((a) => a.id === id);
  if (!found) throw new Error(`Expert not found: ${id}`);
  return delay({ ...found });
};
const getSquadMock = (id: string): Promise<ExpertSquad> => {
  const found = mockSquads.find((s) => s.id === id);
  if (!found) throw new Error(`Squad not found: ${id}`);
  return delay({ ...found });
};

const deleteExpertMock = (id: string): Promise<void> => {
  const idx = mockAgents.findIndex((a) => a.id === id);
  if (idx !== -1) mockAgents.splice(idx, 1);
  return delay(undefined);
};

const deleteSquadMock = (id: string): Promise<void> => {
  const idx = mockSquads.findIndex((s) => s.id === id);
  if (idx !== -1) mockSquads.splice(idx, 1);
  return delay(undefined);
};

const trackExpertViewMock = (kind: ExpertKindParam, id: string): Promise<void> => {
  const source: ExpertItem[] = kind === "squad" ? mockSquads : mockAgents;
  const found = source.find((item) => item.id === id);
  if (found) found.viewCount = (found.viewCount ?? 0) + 1;
  return delay(undefined);
};

function listExpertTagsMock(kind: ExpertKindParam): Promise<string[]> {
  const source: ExpertItem[] = kind === "squad" ? mockSquads : mockAgents;
  const counts = new Map<string, number>();
  for (const item of source) {
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const names = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
  return delay(names);
}

function listExpertCategoriesMock(
  kind: ExpertKindParam
): Promise<ExpertCategoryCount[]> {
  const source: ExpertItem[] = kind === "squad" ? mockSquads : mockAgents;
  const counts = new Map<string, number>();
  for (const item of source) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }
  const categories = EXPERT_CATEGORIES.filter((c) => c !== ALL_CATEGORY).map(
    (name) => ({ name, count: counts.get(name) ?? 0 })
  );
  return delay(categories);
}

// ─── Public API (the only surface the UI imports) ──────────────────────────

export function listExperts(params: ListExpertParams = {}): Promise<ExpertListResult> {
  return USE_MOCK ? listExpertsMock(params) : listExpertsReal(params);
}
export function listMyExperts(params: ListExpertParams = {}): Promise<ExpertListResult> {
  return USE_MOCK ? listMyExpertsMock(params) : listMyExpertsReal(params);
}
export function listSquads(params: ListExpertParams = {}): Promise<ExpertListResult> {
  return USE_MOCK ? listSquadsMock(params) : listSquadsReal(params);
}
export function listMySquads(params: ListExpertParams = {}): Promise<ExpertListResult> {
  return USE_MOCK ? listMySquadsMock(params) : listMySquadsReal(params);
}

export function getExpert(id: string): Promise<ExpertAgent> {
  return USE_MOCK ? getExpertMock(id) : getExpertReal(id);
}
export function getSquad(id: string): Promise<ExpertSquad> {
  return USE_MOCK ? getSquadMock(id) : getSquadReal(id);
}

export function deleteExpert(id: string): Promise<void> {
  return USE_MOCK ? deleteExpertMock(id) : deleteExpertReal(id);
}

export function deleteSquad(id: string): Promise<void> {
  return USE_MOCK ? deleteSquadMock(id) : deleteSquadReal(id);
}

/** Record one detail view for an expert ("agent") or squad. Fire-and-forget:
 *  never rejects — failures are swallowed inside (a lost view is meaningless
 *  to the user and must not surface). */
export function trackExpertView(kind: ExpertKindParam, id: string): Promise<void> {
  return USE_MOCK ? trackExpertViewMock(kind, id) : trackExpertViewReal(kind, id);
}

/** GET /expert_tags?kind= — tag names for the current tab's popover. */
export function listExpertTags(kind: ExpertKindParam): Promise<string[]> {
  return USE_MOCK ? listExpertTagsMock(kind) : listExpertTagsReal(kind);
}

/** GET /expert_categories?kind= — category chips with live counts (no "全部"). */
export function listExpertCategories(
  kind: ExpertKindParam
): Promise<ExpertCategoryCount[]> {
  return USE_MOCK
    ? listExpertCategoriesMock(kind)
    : listExpertCategoriesReal(kind);
}

// ─── Skill content (viewable SKILL.md text, doc §3.1) ───────────────────────
const getExpertSkillContentReal = (expertId: string, index: number) =>
  get<{ content?: string }>(`/experts/${encodeURIComponent(expertId)}/skill_md`, {
    i: index,
  }).then((d) => d.content ?? "");
const getSquadSkillContentReal = (
  squadId: string,
  memberKey: string,
  index: number
) =>
  get<{ content?: string }>(`/squads/${encodeURIComponent(squadId)}/skill_md`, {
    member: memberKey,
    i: index,
  }).then((d) => d.content ?? "");

/** GET /experts/{id}/skill_md?i= — stored SKILL.md text for one expert skill. */
export function getExpertSkillContent(
  expertId: string,
  index: number
): Promise<string> {
  return USE_MOCK
    ? delay(`(sample) skill #${index} content placeholder`)
    : getExpertSkillContentReal(expertId, index);
}

/** GET /squads/{id}/skill_md?member=&i= — a squad member's skill content. */
export function getSquadSkillContent(
  squadId: string,
  memberKey: string,
  index: number
): Promise<string> {
  return USE_MOCK
    ? delay(`(sample) member skill #${index} content placeholder`)
    : getSquadSkillContentReal(squadId, memberKey, index);
}

// ─── Skill package retrieval (whole .zip/.skill, doc §3.1) ───────────────────
// The detail view resolves a short-lived presigned GET URL and fetches + unzips
// the package client-side for the in-place file browser. There is no user-facing
// download; the *DownloadUrl helper names mirror the wire endpoint
// (skill_download / download_url).

/** Reject presigned URLs whose scheme isn't http(s); http only for localhost.
 *  Scheme-level guard mirroring the skills market's assertSafeExternalURL. */
function assertSafeExternalURL(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("invalid upload URL");
  }
  if (u.protocol === "https:") return;
  if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) {
    return;
  }
  throw new Error("unsupported upload URL scheme");
}

/** Ceiling for a fetched skill package (matches the backend upload cap). Guards
 *  the browser preview from a crafted/huge package before it's buffered. */
export const MAX_SKILL_PACKAGE_FETCH_BYTES = 20 * 1024 * 1024;

/** Fetch the raw bytes of a skill package from its presigned URL, for the
 *  client-side file browser. Scheme-guards the URL (rejecting "" and unsafe
 *  schemes), honours the caller's AbortSignal, and enforces
 *  MAX_SKILL_PACKAGE_FETCH_BYTES by STREAMING the body and cancelling as soon as
 *  the accumulated size exceeds the cap — so a missing/lying Content-Length
 *  can't force the tab to buffer an oversized (or infinite) response first. */
export async function fetchSkillPackage(
  url: string,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  assertSafeExternalURL(url); // throws on empty/unsafe URL
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`package fetch failed: ${resp.status}`);
  const declared = Number(resp.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_SKILL_PACKAGE_FETCH_BYTES) {
    throw new Error("package too large");
  }
  const reader = resp.body?.getReader();
  if (!reader) {
    // No readable stream (non-browser/edge case): fall back but still cap.
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > MAX_SKILL_PACKAGE_FETCH_BYTES) {
      throw new Error("package too large");
    }
    return buf;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_SKILL_PACKAGE_FETCH_BYTES) {
      await reader.cancel();
      throw new Error("package too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer as ArrayBuffer;
}

const getExpertSkillDownloadUrlReal = (id: string, index: number) =>
  get<{ download_url?: string }>(`/experts/${encodeURIComponent(id)}/skill_download`, {
    i: index,
  }).then((d) => d.download_url ?? "");
const getSquadSkillDownloadUrlReal = (id: string, memberKey: string, index: number) =>
  get<{ download_url?: string }>(`/squads/${encodeURIComponent(id)}/skill_download`, {
    member: memberKey,
    i: index,
  }).then((d) => d.download_url ?? "");

/** Resolve a presigned download URL for the expert's skill package. Used both to
 *  fetch + unzip the package client-side (file browser) and to trigger a download. */
export function getExpertSkillDownloadUrl(id: string, index: number): Promise<string> {
  return getExpertSkillDownloadUrlReal(id, index);
}

/** Resolve a presigned download URL for a squad member's skill package. */
export function getSquadSkillDownloadUrl(
  id: string,
  memberKey: string,
  index: number
): Promise<string> {
  return getSquadSkillDownloadUrlReal(id, memberKey, index);
}

// ─── Add-to-Loop: install an expert into a Loop workspace ───────────────────
// The marketplace backend orchestrates the install server-side (reads the
// expert spec, creates the agent + skills in the chosen workspace/runtime via
// octo-fleet, forwarding the user token). The frontend only picks a
// workspace + runtime and fires one install call. See the plan / expert-v1 doc.

/** A Loop workspace the current user can install into (picker option). */
export interface LoopWorkspace {
  id: string;
  name: string;
}

/** An agent runtime within a workspace (picker option). */
export interface LoopRuntime {
  id: string;
  name: string;
  status?: string;
}

// fleet wire shapes: WorkspaceResponse / AgentRuntimeResponse both key the
// identifier as `id` (NOT workspace_id/runtime_id — that was the marketplace
// guess). See octo-fleet internal/handler/{workspace,runtime}.go.
interface LoopWorkspaceWire {
  id: string;
  name?: string;
}
interface LoopRuntimeWire {
  id: string;
  name?: string;
  status?: string;
}

/** Fail loud on a fleet payload that is not a list. A routing miss (e.g. the
 *  SPA fallback answering 200 text/html because /fleet/api is not proxied, or
 *  an envelope change) must surface as the dialog's error state — coercing it
 *  to [] would render a permanent, plausible-looking "no workspaces" that is
 *  indistinguishable from the user genuinely having none. `null` stays a valid
 *  empty list (Go marshals a nil slice as null). */
function expectFleetList<T>(data: unknown): T[] {
  if (data === null || data === undefined) return [];
  if (!Array.isArray(data)) {
    throw new Error(t("mcp.expert.loopBadResponse"));
  }
  return data as T[];
}

/** GET /fleet/api/v1/workspaces — Loop workspaces the user belongs to (workspace picker). */
export async function listLoopWorkspaces(): Promise<LoopWorkspace[]> {
  const data = await fleetGet<LoopWorkspaceWire[] | null>("/workspaces");
  return expectFleetList<LoopWorkspaceWire>(data).map((w) => ({
    id: w.id,
    name: w.name ?? w.id,
  }));
}

/** GET /fleet/api/v1/runtimes?workspace_id= — runtimes in the chosen workspace (runtime picker). */
export async function listLoopRuntimes(
  workspaceId: string
): Promise<LoopRuntime[]> {
  const data = await fleetGet<LoopRuntimeWire[] | null>("/runtimes", {
    workspace_id: workspaceId,
  });
  return expectFleetList<LoopRuntimeWire>(data).map((rt) => ({
    id: rt.id,
    name: rt.name ?? rt.id,
    status: rt.status,
  }));
}

// ─── Loop target cache (workspaces + runtimes) ──────────────────────────────
// listLoopWorkspaces/listLoopRuntimes each hit the fleet gateway, and the
// "添加到回路" picker chains them (workspaces → the first workspace's runtimes),
// so a cold open waits on two sequential round-trips. Cache both per Space and
// warm them on market mount (prefetchLoopTargets) so the dialog's selects are
// populated by the time the user clicks a card. Promises — not just results —
// are cached, so a prefetch still in flight is shared with a modal opened
// before it resolves (no duplicate request).
let loopCacheSpaceId: string | null = null;
let cachedWorkspaces: Promise<LoopWorkspace[]> | null = null;
const cachedRuntimes = new Map<string, Promise<LoopRuntime[]>>();

// Mirror the request interceptor's space source so the cache key matches the
// Space the fleet call is actually scoped to.
function loopCacheSpace(): string {
  return WKApp.shared?.currentSpaceId ?? "";
}

// Drop the cache when the Space changed under us so one Space's targets never
// leak into another after a switch (belt-and-suspenders alongside the explicit
// clearLoopCache the page fires on the space-changed event).
function syncLoopCacheSpace(): void {
  const sid = loopCacheSpace();
  if (sid !== loopCacheSpaceId) {
    cachedWorkspaces = null;
    cachedRuntimes.clear();
    loopCacheSpaceId = sid;
  }
}

/** Clear all cached Loop workspaces/runtimes. Call on Space switch so the next
 *  open refetches for the new Space. */
export function clearLoopCache(): void {
  loopCacheSpaceId = null;
  cachedWorkspaces = null;
  cachedRuntimes.clear();
}

/** Cached listLoopWorkspaces — shared by the "添加到回路" picker and the market
 *  prefetch. A rejected fetch drops the cache so a later open can retry. */
export function getLoopWorkspaces(): Promise<LoopWorkspace[]> {
  syncLoopCacheSpace();
  if (!cachedWorkspaces) {
    const pending: Promise<LoopWorkspace[]> = listLoopWorkspaces().catch(
      (err) => {
        // Only drop the entry if it's still ours: a clearLoopCache() + refetch
        // (e.g. a Space switch) may have replaced it while this was in flight,
        // and nulling the newer promise would defeat the cache.
        if (cachedWorkspaces === pending) cachedWorkspaces = null;
        throw err;
      }
    );
    cachedWorkspaces = pending;
  }
  return cachedWorkspaces;
}

/** Cached listLoopRuntimes for one workspace (keyed within the current Space). */
export function getLoopRuntimes(workspaceId: string): Promise<LoopRuntime[]> {
  syncLoopCacheSpace();
  const hit = cachedRuntimes.get(workspaceId);
  if (hit) return hit;
  const pending: Promise<LoopRuntime[]> = listLoopRuntimes(workspaceId).catch(
    (err) => {
      // Only evict if this promise is still the cached one (see getLoopWorkspaces).
      if (cachedRuntimes.get(workspaceId) === pending)
        cachedRuntimes.delete(workspaceId);
      throw err;
    }
  );
  cachedRuntimes.set(workspaceId, pending);
  return pending;
}

/** Warm the workspace list + the first workspace's runtimes so the "添加到回路"
 *  dialog opens with its selects already populated. Fire-and-forget: errors are
 *  swallowed here (a real open re-runs the fetch and surfaces them). */
export function prefetchLoopTargets(): void {
  getLoopWorkspaces()
    .then((list) => {
      // The picker auto-selects the first workspace, so warming its runtimes
      // removes the second sequential round-trip on open.
      if (list.length > 0) void getLoopRuntimes(list[0].id).catch(() => {});
    })
    .catch(() => {});
}

/** POST /experts/{id}/install — create the agent (+ its skills) in the chosen
 *  workspace/runtime. The marketplace backend orchestrates the fleet calls
 *  server-side (create agent → create skills → bind) and rolls back on partial
 *  failure, returning the new agent's id. */
export async function installExpertToLoop(
  expertId: string,
  opts: { workspaceId: string; runtimeId: string }
): Promise<{ agentId: string }> {
  try {
    const resp = await expertAxios.post(
      `${BASE}/experts/${encodeURIComponent(expertId)}/install`,
      { workspace_id: opts.workspaceId, runtime_id: opts.runtimeId }
    );
    const data = (resp?.data?.data ?? null) as { agent_id?: string } | null;
    const agentId = data?.agent_id ?? "";
    // The agent id is the whole point of this call. A 2xx without it means the
    // install did not actually happen (version skew, an envelope change, an
    // intermediary rewriting the body) — treat it as a failure rather than
    // telling the user "已添加到回路" when nothing was created.
    if (!agentId) throw new Error(t("mcp.expert.installFailed"));
    return { agentId };
  } catch (err) {
    if (axios.isCancel(err)) throw err;
    throw new Error(installErrorMessage(err, "mcp.expert.installConflict"));
  }
}

/** POST /squads/{id}/install — provision the squad into the chosen
 *  workspace/runtime. The marketplace backend installs each member as a Loop
 *  agent (create agent → skills → bind), then forms the squad (create it led by
 *  the leader member, attach the rest), rolling back on partial failure. Returns
 *  the new fleet squad's id. */
export async function installSquadToLoop(
  squadId: string,
  opts: { workspaceId: string; runtimeId: string }
): Promise<{ squadId: string }> {
  try {
    const resp = await expertAxios.post(
      `${BASE}/squads/${encodeURIComponent(squadId)}/install`,
      { workspace_id: opts.workspaceId, runtime_id: opts.runtimeId }
    );
    const data = (resp?.data?.data ?? null) as { squad_id?: string } | null;
    const newSquadId = data?.squad_id ?? "";
    // The squad id is the whole point of this call — a 2xx without it means the
    // squad was not formed. Fail rather than falsely report success.
    if (!newSquadId) throw new Error(t("mcp.expert.installFailed"));
    return { squadId: newSquadId };
  } catch (err) {
    if (axios.isCancel(err)) throw err;
    throw new Error(installErrorMessage(err, "mcp.expert.installConflictSquad"));
  }
}

/** Install-specific error copy. The install path is fleet-backed, so its most
 *  likely failures — a duplicate name (CONFLICT), missing workspace permission
 *  (FORBIDDEN; squad create needs owner/admin), and an unconfigured/unavailable
 *  Loop service (UPSTREAM_UNAVAILABLE) — get dedicated expert-context copy
 *  rather than the shared connector strings (which read wrong here). Everything
 *  else falls back to the shared map. */
function installErrorMessage(err: unknown, conflictKey: string): string {
  const code = (
    err as { response?: { data?: { error?: { code?: string } } } }
  )?.response?.data?.error?.code;
  const INSTALL_COPY: Record<string, string> = {
    CONFLICT: conflictKey,
    FORBIDDEN: "mcp.expert.installForbidden",
    NOT_FOUND: "mcp.expert.installNotFound",
    UPSTREAM_UNAVAILABLE: "mcp.expert.loopUnavailable",
  };
  const key = code ? INSTALL_COPY[code] : undefined;
  if (key) return t(key);
  return extractErrorMessage(err);
}
