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
    if (err?.response?.status === 401) {
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

// ─── Skill package download (whole .zip/.skill, doc §3.1) ────────────────────
// The detail view resolves a short-lived presigned GET URL to download the
// package (and to fetch + unzip it client-side for the file browser).

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

/** Fetch the raw bytes of a skill package from its presigned URL, for the
 *  client-side file browser. Scheme-guards the URL (rejecting "" and unsafe
 *  schemes), and honours the caller's AbortSignal for timeout/unmount. */
export async function fetchSkillPackage(
  url: string,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  assertSafeExternalURL(url); // throws on empty/unsafe URL
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`package fetch failed: ${resp.status}`);
  return resp.arrayBuffer();
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

/** Open a presigned download URL in a new tab via a synthetic anchor (safe:
 *  scheme-checked, noopener). */
export function openDownloadUrl(url: string): void {
  if (!url) throw new Error("empty download url");
  assertSafeExternalURL(url);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
