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
  mapPluginAgentListItem,
  mapPluginSquadListItem,
  fromSkillPlugin,
} from "./expertWire";
import type {
  MemberContextWire,
} from "./expertWire";
import { parseTeamAgentsMarkdown } from "./expertWire";
import type { ExpertMember, ExpertSkill } from "../mock/expertMock";
import {
  SCENE_CODE,
  jsonAttachment,
  rawAttachment,
  type OffsetPaginationWire,
  type PluginCategoryWire,
  type PluginDetailWire,
  type PluginListItemWire,
  type PluginRelationWire,
} from "./pluginWire";
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
// (octo-marketplace/docs/api/expert-v1.md), mounted at /market/api/v1. Web
// builds stay same-origin so dev Vite proxy / production gateway can route it.
// Packaged desktop builds have no same-origin gateway because the page runs
// from file://, so the request interceptor resolves the relative mount against
// WKApp.apiClient.config.apiURL's origin.
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

/** Catalog sort modes accepted by the marketplace list endpoints. `installs`
 *  and `views` rank by the resource_metrics counters; `comprehensive` is the
 *  backend's weighted blend of both plus a recency boost. */
export type ExpertCatalogSort = "comprehensive" | "latest" | "installs" | "views";

/** List query params shared by all four list endpoints (expert-v1.md §4.2). */
export interface ListExpertParams {
  keyword?: string;
  /** Category NAME; "全部" / "all" disables the filter. */
  category?: string;
  tags?: string[];
  sort?: ExpertCatalogSort;
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

function resolveBaseURL(): string {
  const apiURL = WKApp.apiClient?.config?.apiURL;
  if (!apiURL) return "";
  try {
    return new URL(apiURL).origin;
  } catch {
    return "";
  }
}

expertAxios.interceptors.request.use((config) => {
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
      // session probe and still log out on a genuinely expired token). Exact
      // pathname match — a suffix check would also exempt any future URL that
      // happens to end in /metrics/track.
      url !== `${BASE}/metrics/track`
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

// ─── Real implementations (octo-marketplace unified plugin API) ─────────────

/** Wire envelope for the list endpoints. */
interface PluginListResponseWire {
  data: PluginListItemWire[];
  pagination?: OffsetPaginationWire;
}

/** Unified plugin type behind each catalog tab. */
type ExpertPluginType = "expert" | "expert_team";

function pluginTypeOf(kind: ExpertKindParam): ExpertPluginType {
  return kind === "squad" ? "expert_team" : "expert";
}

/** Unified sort names for the legacy catalog sort enum. */
function mapSort(sort?: ExpertCatalogSort): string | undefined {
  if (!sort) return undefined;
  if (sort === "latest") return "newest";
  return sort; // comprehensive / installs / views match 1:1
}

// Category maps per plugin type: the unified API filters by category UUID
// while the UI keeps working with category NAMES. Cached per Space; counts
// for the chips are re-fetched fresh by listExpertCategories.
interface ExpertCategoryMaps {
  nameToId: Map<string, string>;
  idToName: Map<string, string>;
}

const categoryMapsCache = new Map<
  string,
  { spaceId: string; promise: Promise<ExpertCategoryMaps> }
>();

async function fetchExpertCategoriesWire(
  pluginType: ExpertPluginType
): Promise<PluginCategoryWire[]> {
  const data = await get<PluginCategoryWire[] | null>("/plugin_categories", {
    scene_code: SCENE_CODE,
    plugin_type: pluginType,
  });
  return Array.isArray(data) ? data : [];
}

function getExpertCategoryMaps(
  pluginType: ExpertPluginType
): Promise<ExpertCategoryMaps> {
  const spaceId = WKApp.shared?.currentSpaceId ?? "";
  const hit = categoryMapsCache.get(pluginType);
  if (!hit || hit.spaceId !== spaceId) {
    const promise = fetchExpertCategoriesWire(pluginType).then((wire) => {
      const nameToId = new Map<string, string>();
      const idToName = new Map<string, string>();
      for (const category of wire) {
        nameToId.set(category.name, category.category_id);
        idToName.set(category.category_id, category.name);
      }
      return { nameToId, idToName };
    });
    promise.catch(() => {
      if (categoryMapsCache.get(pluginType)?.promise === promise) {
        categoryMapsCache.delete(pluginType);
      }
    });
    categoryMapsCache.set(pluginType, { spaceId, promise });
  }
  return categoryMapsCache.get(pluginType)!.promise;
}

async function listPathReal(
  kind: ExpertKindParam,
  mine: boolean,
  params: ListExpertParams
): Promise<ExpertListResult> {
  const pluginType = pluginTypeOf(kind);
  const query: Record<string, unknown> = {
    scene_code: SCENE_CODE,
    plugin_type: pluginType,
  };
  if (mine) query.mode = "mine";
  const keyword = params.keyword?.trim();
  if (keyword) query.q = keyword;
  if (params.tags?.length) query.tag = params.tags;
  const sort = mapSort(params.sort);
  if (sort) query.sort = sort;
  query.page = params.page && params.page > 0 ? params.page : 1;
  query.page_size = params.pageSize && params.pageSize > 0 ? params.pageSize : 100;

  const maps = await getExpertCategoryMaps(pluginType);
  const category = params.category?.trim();
  if (category && category !== ALL_CATEGORY && category !== CATEGORY_KEY_ALL) {
    const categoryId = maps.nameToId.get(category);
    if (categoryId) query.category_id = categoryId;
  }
  const resp = await executeExpertListRequest(() =>
    expertAxios.get<PluginListResponseWire>(`${BASE}/plugins`, { params: query })
  );
  const items = (resp.data.data ?? []).map((raw) => {
    const categoryName = (raw.category_id && maps.idToName.get(raw.category_id)) || "";
    return kind === "squad"
      ? mapPluginSquadListItem(raw, categoryName)
      : mapPluginAgentListItem(raw, categoryName);
  });
  return { items, total: resp.data.pagination?.total ?? items.length };
}

const listExpertsReal = (params: ListExpertParams) => listPathReal("agent", false, params);
const listMyExpertsReal = (params: ListExpertParams) => listPathReal("agent", true, params);
const listSquadsReal = (params: ListExpertParams) => listPathReal("squad", false, params);
const listMySquadsReal = (params: ListExpertParams) => listPathReal("squad", true, params);

// ─── Detail assembly (attachments + relations fan-out) ──────────────────────
// Skill text/packages load lazily by (parent id, member key, index); remember
// which skill Plugin each position resolved to so those reads go straight to
// /plugins/skill_md|download without re-walking relations.
const expertSkillIndex = new Map<string, string[]>();
const squadSkillIndex = new Map<string, Map<string, string[]>>();

function liveRelations(
  relations: PluginRelationWire[] | undefined,
  relationType: string
): PluginRelationWire[] {
  return (relations ?? [])
    .filter((rel) => rel.relation_type === relationType)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

function pluginDetail(id: string): Promise<PluginDetailWire> {
  return get<PluginDetailWire>("/plugins/detail", {
    plugin_id: id,
    include_relations: true,
  });
}

/** Load every expert_skill relation target and project it for the browser,
 *  returning the skills plus their plugin ids (positionally aligned). */
async function loadSkills(
  relations: PluginRelationWire[] | undefined
): Promise<{ skills: ExpertSkill[]; pluginIds: string[] }> {
  const rels = liveRelations(relations, "expert_skill");
  const details = await Promise.all(
    rels.map((rel) =>
      get<PluginDetailWire>("/plugins/detail", {
        plugin_id: rel.target_plugin_id,
        include_relations: false,
      })
    )
  );
  return {
    skills: details.map((d) => fromSkillPlugin(d.plugin)),
    pluginIds: rels.map((rel) => rel.target_plugin_id),
  };
}

async function getExpertReal(id: string): Promise<ExpertAgent> {
  const [detail, maps] = await Promise.all([
    pluginDetail(id),
    getExpertCategoryMaps("expert"),
  ]);
  const plugin = detail.plugin;
  const categoryName =
    (plugin.category_id && maps.idToName.get(plugin.category_id)) || "";
  const { skills, pluginIds } = await loadSkills(detail.relations);
  expertSkillIndex.set(id, pluginIds);
  return {
    ...mapPluginAgentListItem(plugin, categoryName),
    instruction: rawAttachment(plugin.plugin_json, "AGENTS.md") ?? "",
    mcpConfig: rawAttachment(plugin.plugin_json, "mcp.json") ?? "",
    skills,
  };
}

async function getSquadReal(id: string): Promise<ExpertSquad> {
  const [detail, maps] = await Promise.all([
    pluginDetail(id),
    getExpertCategoryMaps("expert_team"),
  ]);
  const plugin = detail.plugin;
  const categoryName =
    (plugin.category_id && maps.idToName.get(plugin.category_id)) || "";
  // Contract layout: the team package is a single AGENTS.md carrying the
  // collaboration/dispatch config as deterministic prose; leadership also
  // lives on member relations (is_leader).
  const agents = parseTeamAgentsMarkdown(
    rawAttachment(plugin.plugin_json, "AGENTS.md") ?? ""
  );
  const memberRels = liveRelations(detail.relations, "expert_team_expert");
  const skillIndex = new Map<string, string[]>();
  const members = await Promise.all(
    memberRels.map((rel) => loadSquadMember(rel, skillIndex))
  );
  squadSkillIndex.set(id, skillIndex);
  return {
    ...mapPluginSquadListItem(plugin, categoryName),
    members,
    memberCount: members.length,
    instruction: rawAttachment(plugin.plugin_json, "AGENTS.md") ?? "",
    leader: agents.leader || members.find((m) => m.leader)?.name || "",
    strategies: agents.strategies,
    dependencies: agents.dependencies,
    permission: agents.permission,
    checkResult: "supported",
  };
}

async function loadSquadMember(
  rel: PluginRelationWire,
  skillIndex: Map<string, string[]>
): Promise<ExpertMember> {
  const detail = await pluginDetail(rel.target_plugin_id);
  const plugin = detail.plugin;
  // relation_json is authoritative for squad wiring; the member's own
  // expert/context.json snapshot is the fallback.
  const wiring = (rel.data ?? {}) as MemberContextWire;
  const context =
    jsonAttachment<MemberContextWire>(plugin.plugin_json, "expert/context.json") ?? {};
  const memberKey =
    wiring.member_key || context.member_key || rel.target_plugin_id;
  const { skills, pluginIds } = await loadSkills(detail.relations);
  skillIndex.set(memberKey, pluginIds);
  return {
    key: memberKey,
    pluginId: rel.target_plugin_id,
    templateId: context.template_id,
    name: plugin.plugin_name ?? "",
    role: wiring.role ?? context.role ?? "",
    leader: Boolean(wiring.is_leader ?? context.is_leader),
    instruction: rawAttachment(plugin.plugin_json, "AGENTS.md") ?? "",
    mcpConfig: rawAttachment(plugin.plugin_json, "mcp.json") ?? "",
    skills,
  };
}

async function deletePluginReal(id: string): Promise<void> {
  try {
    await expertAxios.post(`${BASE}/plugins/delete`, { plugin_id: id });
  } catch (err) {
    if (axios.isCancel(err)) throw err;
    throw new Error(extractErrorMessage(err));
  }
}

const deleteExpertReal = deletePluginReal;
const deleteSquadReal = deletePluginReal;

/** POST /metrics/track — bump the plugin view counter. Fire-and-forget:
 *  every failure is swallowed here so no call site ever has to remember to
 *  catch a rejection that carries no actionable signal. */
async function trackExpertViewReal(_kind: ExpertKindParam, id: string): Promise<void> {
  try {
    await expertAxios.post(`${BASE}/metrics/track`, {
      resource_type: "plugin",
      resource_id: id,
      event_type: "view",
    });
  } catch {
    // A lost view must never block or break the detail view.
  }
}

async function listExpertTagsReal(kind: ExpertKindParam): Promise<string[]> {
  const data = await get<{ name: string; count: number }[] | null>(
    "/plugin_tags",
    { plugin_type: pluginTypeOf(kind) }
  );
  return Array.isArray(data) ? data.map((tag) => tag.name) : [];
}

async function listExpertCategoriesReal(
  kind: ExpertKindParam
): Promise<ExpertCategoryCount[]> {
  const data = await fetchExpertCategoriesWire(pluginTypeOf(kind));
  return data.map((c) => ({ name: c.name, count: c.plugin_count ?? 0 }));
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

/** Mirror the backend's catalog ordering over the mock fixtures. `latest` (and
 *  no sort) keeps the fixture order, which already plays newest-first. */
function sortMockItems(items: ExpertItem[], sort?: ExpertCatalogSort): ExpertItem[] {
  if (!sort || sort === "latest") return items;
  const score = (item: ExpertItem): number => {
    const installs = item.installCount ?? 0;
    const views = item.viewCount ?? 0;
    if (sort === "installs") return installs;
    if (sort === "views") return views;
    return installs * 5 + views;
  };
  return [...items].sort((a, b) => score(b) - score(a));
}

function listMockFrom(
  source: ExpertItem[],
  params: ListExpertParams
): Promise<ExpertListResult> {
  const filtered = sortMockItems(
    source.filter((item) => matchesFilters(item, params)),
    params.sort
  );
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

// ─── Skill content (viewable SKILL.md text) ─────────────────────────────────
// The lazy readers address skills by (parent id, member key, index); resolve
// the position to its skill Plugin id via the index the detail assembly
// recorded, re-fetching the detail when the cache is cold (e.g. page reload
// straight into a deep link).

async function skillPluginIdForExpert(
  expertId: string,
  index: number
): Promise<string> {
  let ids = expertSkillIndex.get(expertId);
  if (!ids || !ids[index]) {
    await getExpertReal(expertId);
    ids = expertSkillIndex.get(expertId);
  }
  const pluginId = ids?.[index];
  if (!pluginId) throw new Error(t("mcp.errors.notFound"));
  return pluginId;
}

async function skillPluginIdForSquad(
  squadId: string,
  memberKey: string,
  index: number
): Promise<string> {
  let byMember = squadSkillIndex.get(squadId);
  if (!byMember || !byMember.get(memberKey)?.[index]) {
    await getSquadReal(squadId);
    byMember = squadSkillIndex.get(squadId);
  }
  const pluginId = byMember?.get(memberKey)?.[index];
  if (!pluginId) throw new Error(t("mcp.errors.notFound"));
  return pluginId;
}

function fetchSkillMarkdown(pluginId: string): Promise<string> {
  return get<{ content?: string }>("/plugins/skill_md", {
    plugin_id: pluginId,
  }).then((d) => d.content ?? "");
}

const getExpertSkillContentReal = (expertId: string, index: number) =>
  skillPluginIdForExpert(expertId, index).then(fetchSkillMarkdown);
const getSquadSkillContentReal = (
  squadId: string,
  memberKey: string,
  index: number
) => skillPluginIdForSquad(squadId, memberKey, index).then(fetchSkillMarkdown);

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

// ─── Skill package retrieval (whole .zip/.skill) ─────────────────────────────
// The detail view fetches + unzips the package client-side for the in-place
// file browser. The unified marketplace streams the package from an
// AUTHENTICATED endpoint (no presigned URL), so the *DownloadUrl helpers now
// return a same-origin relative path and fetchSkillPackage attaches the
// marketplace auth headers for it.

/** Reject external URLs whose scheme isn't http(s); http only for localhost.
 *  Same-origin relative paths (the authenticated marketplace download) are
 *  validated separately by the caller. */
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

/** Marketplace auth headers for a bare fetch (mirrors the axios interceptor). */
function marketAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = WKApp.loginInfo?.token;
  if (token) headers["token"] = token;
  const spaceId = WKApp.shared?.currentSpaceId;
  if (spaceId) headers["X-Space-Id"] = spaceId;
  return headers;
}

/** Ceiling for a fetched skill package (matches the backend upload cap). Guards
 *  the browser preview from a crafted/huge package before it's buffered. */
export const MAX_SKILL_PACKAGE_FETCH_BYTES = 20 * 1024 * 1024;

/** Fetch the raw bytes of a skill package for the client-side file browser.
 *  Marketplace-relative paths (starting with the /market mount) get the auth
 *  headers attached and resolve against the API origin; absolute URLs are
 *  scheme-guarded and fetched bare. Honours the caller's AbortSignal and
 *  enforces MAX_SKILL_PACKAGE_FETCH_BYTES by STREAMING the body and cancelling
 *  as soon as the accumulated size exceeds the cap. */
export async function fetchSkillPackage(
  url: string,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  let target = url;
  let headers: Record<string, string> | undefined;
  if (url.startsWith(`${BASE}/`)) {
    target = `${resolveBaseURL()}${url}`;
    headers = marketAuthHeaders();
  } else {
    assertSafeExternalURL(url); // throws on empty/unsafe URL
  }
  const resp = await fetch(target, { signal, headers });
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
  skillPluginIdForExpert(id, index).then(
    (pluginId) =>
      `${BASE}/plugins/download?plugin_id=${encodeURIComponent(pluginId)}`
  );
const getSquadSkillDownloadUrlReal = (id: string, memberKey: string, index: number) =>
  skillPluginIdForSquad(id, memberKey, index).then(
    (pluginId) =>
      `${BASE}/plugins/download?plugin_id=${encodeURIComponent(pluginId)}`
  );

/** Resolve the authenticated download path for the expert's skill package. Used
 *  both to fetch + unzip the package client-side (file browser) and to trigger a
 *  download; consume it through fetchSkillPackage so auth headers attach. */
export function getExpertSkillDownloadUrl(id: string, index: number): Promise<string> {
  return getExpertSkillDownloadUrlReal(id, index);
}

/** Resolve the authenticated download path for a squad member's skill package. */
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

/** POST /plugins/install — create the agent (+ its skills) in the
 *  chosen workspace/runtime. The marketplace backend orchestrates the fleet
 *  calls server-side (create agent → create skills → bind) and rolls back on
 *  partial failure, returning the new agent's id. */
export async function installExpertToLoop(
  expertId: string,
  opts: { workspaceId: string; runtimeId: string }
): Promise<{ agentId: string }> {
  try {
    const resp = await expertAxios.post(`${BASE}/plugins/install`, {
      plugin_id: expertId,
      workspace_id: opts.workspaceId,
      runtime_id: opts.runtimeId,
    });
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

/** POST /plugins/install (expert_team) — provision the squad into the
 *  chosen workspace/runtime. The marketplace backend installs each member as a
 *  Loop agent (create agent → skills → bind), then forms the squad (create it
 *  led by the leader member, attach the rest), rolling back on partial failure.
 *  Returns the new fleet squad's id. */
export async function installSquadToLoop(
  squadId: string,
  opts: { workspaceId: string; runtimeId: string }
): Promise<{ squadId: string }> {
  try {
    const resp = await expertAxios.post(`${BASE}/plugins/install`, {
      plugin_id: squadId,
      workspace_id: opts.workspaceId,
      runtime_id: opts.runtimeId,
    });
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
