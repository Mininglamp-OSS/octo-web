import { pluginErrorMessage } from "@dmwork/skillmarket/src/api/pluginErrors";
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
  mapDependencyIssues,
  mapPluginAgentListItem,
  mapPluginSquadListItem,
  fromSkillPlugin,
} from "./expertWire";
// Deep import, deliberately — see the identical note in mcpService.ts. The
// subpath is a leaf module with no imports of its own, so it does not drag the
// @dmwork/skillmarket React graph into the suites that mock only `axios` +
// `@octo/base`.
import { withReviewInvalidation } from "@dmwork/skillmarket/src/api/reviewSignal";
import type {
  MemberContextWire,
} from "./expertWire";
import { parseTeamAgentsMarkdown } from "./expertWire";
import type { ExpertMember, ExpertSkill, ExpertConnector } from "../mock/expertMock";
import {
  SCENE_CODE,
  jsonAttachment,
  rawAttachment,
  type OffsetPaginationWire,
  type PluginCategoryWire,
  type PluginDetailWire,
  type PluginPackageWire,
  type PluginManifestWire,
  type PluginListItemWire,
  type PluginRelationWire,
} from "./pluginWire";
import { CATEGORY_KEY_ALL } from "../utils/constants";
import {
  ExpertListError,
  classifyExpertListError,
  executeExpertListRequest,
  expertListErrorI18nKey,
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

/**
 * The audience a tenant may DECLARE for a 专家 / 专家团.
 *
 * `system` (全平台) is deliberately absent: it marks a platform-published
 * record, the tenant write path rejects it, and offering it would let an author
 * downgrade an official listing into their own Space.
 */
export type ExpertVisibility = "private" | "space";

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
    response?: { data?: { error?: { message?: string; code?: string; details?: unknown } } };
  };
  const wire = axiosErr?.response?.data?.error;
  const code = wire?.code;
  const localized = pluginErrorMessage(code, wire?.details) || (code ? localizedForCode(code) : "");
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
  pluginType: ExpertPluginType,
  forceRefresh = false
): Promise<ExpertCategoryMaps> {
  const spaceId = WKApp.shared?.currentSpaceId ?? "";
  if (forceRefresh) categoryMapsCache.delete(pluginType);
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

  let maps = await getExpertCategoryMaps(pluginType);
  const category = params.category?.trim();
  if (category && category !== ALL_CATEGORY && category !== CATEGORY_KEY_ALL) {
    let categoryId = maps.nameToId.get(category);
    if (!categoryId) {
      // Stale per-space cache (e.g. an admin renamed the category): refetch the
      // taxonomy once before giving up.
      maps = await getExpertCategoryMaps(pluginType, true);
      categoryId = maps.nameToId.get(category);
    }
    if (categoryId) {
      query.category_id = categoryId;
    } else {
      // Fail closed: an unresolvable category filter must NOT silently widen to
      // the whole catalog (the list would then render every expert as if
      // unfiltered). Surface an explicit empty result, mirroring the connector
      // path in mcpService.fetchMcpListPath.
      return { items: [], total: 0 };
    }
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
// original version files without re-walking relations.
interface SkillTarget { pluginId: string; versionId?: string }
const expertSkillIndex = new Map<string, SkillTarget[]>();
const squadSkillIndex = new Map<string, Map<string, SkillTarget[]>>();
const detailGenerations = new Map<string, number>();
function beginDetail(kind: "expert" | "squad", id: string) {
  const key = detailIndexKey(id);
  const generationKey = `${kind}:${key}`;
  const generation = (detailGenerations.get(generationKey) ?? 0) + 1;
  detailGenerations.set(generationKey, generation);
  return { key, assertCurrent() {
    if (detailIndexKey(id) !== key || detailGenerations.get(generationKey) !== generation) {
      // Axios cancellation semantics: callers discard superseded detail reads.
      throw Object.assign(new Error("Superseded detail request"), { __CANCEL__: true });
    }
  } };
}
// Scope lazy indices to the authenticated reader, not just the resource id.
function detailIndexKey(id: string): string {
  return `${WKApp.loginInfo.token}:${WKApp.shared.currentSpaceId}:${id}`;
}
interface HistoricalPluginWire {
  version: { plugin_id: string; version_id: string; declared_version?: string; release?: { version_label?: string }; relations: PluginRelationWire[] };
  manifest_json: PluginManifestWire;
  plugin_json: PluginPackageWire;
}
function versionPath(target: SkillTarget): string {
  return `/plugins/${encodeURIComponent(target.pluginId)}/versions/${encodeURIComponent(target.versionId!)}`;
}
async function relationDetail(rel: PluginRelationWire) {
  if (!rel.target_version_id) return pluginDetail(rel.target_plugin_id);
  const snapshot = await get<HistoricalPluginWire>(versionPath({
    pluginId: rel.target_plugin_id, versionId: rel.target_version_id,
  }));
  return {
    plugin: {
      plugin_id: snapshot.version.plugin_id,
      // `version` is an internal revision counter, not the display label.
      current_version: snapshot.version.release?.version_label ?? snapshot.version.declared_version,
      plugin_name: snapshot.manifest_json.plugin_name ?? snapshot.manifest_json.name ?? "",
      plugin_json: snapshot.plugin_json,
    },
    relations: snapshot.version.relations,
  };
}

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

/** A CONFIRMED 404 means the relation target is soft-deleted / dangling — the
 *  one case where dropping it (rather than failing the whole detail) is correct.
 *  `get()` has already wrapped the axios error into an ExpertListError, so we key
 *  off its classified kind. Any other failure (500 / 403 / network / unknown)
 *  must surface, not silently shrink the displayed skill/member list. */
function isDanglingTarget(reason: unknown): boolean {
  return reason instanceof ExpertListError && reason.kind === "notfound";
}

/** Load every expert_skill relation target and project it for the browser,
 *  returning the skills plus their plugin ids (positionally aligned). */
async function loadSkills(
  relations: PluginRelationWire[] | undefined
): Promise<{ skills: ExpertSkill[]; pluginIds: SkillTarget[] }> {
  const rels = liveRelations(relations, "expert_skill");
  // allSettled, not all: a soft-deleted / unresolvable expert_skill target must
  // not reject legacy expert/squad detail. Only an UNPINNED confirmed 404 is
  // dropped — a 500/403/network error is rethrown so the detail surfaces the
  // failure instead of silently rendering a shortened skill list. skills[] and
  // pluginIds[] stay aligned because both are pushed together only for resolved
  // targets. Cancellation (space switch) still propagates.
  const settled = await Promise.allSettled(
    rels.map(relationDetail)
  );
  const skills: ExpertSkill[] = [];
  const pluginIds: SkillTarget[] = [];
  settled.forEach((res, i) => {
    if (res.status === "fulfilled") {
      skills.push(fromSkillPlugin(res.value.plugin, rels[i].target_version_id));
      pluginIds.push({ pluginId: rels[i].target_plugin_id, versionId: rels[i].target_version_id });
    } else if (rels[i].target_version_id || axios.isCancel(res.reason) || !isDanglingTarget(res.reason)) {
      // A pinned read or non-404 failure must surface, never become a partial graph.
      throw res.reason;
    }
    // else: unpinned confirmed 404 → legacy dangling target, safe to drop.
  });
  return { skills, pluginIds };
}

/** Connector relations are versionless; keep their names/configs in the detail. */
async function loadConnectors(relations: PluginRelationWire[] | undefined): Promise<ExpertConnector[]> {
  const rels = liveRelations(relations, "expert_connector");
  const results = await Promise.allSettled(rels.map(relationDetail));
  const connectors: ExpertConnector[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      connectors.push({ pluginId: rels[index].target_plugin_id,
        name: result.value.plugin.plugin_name ?? "",
        mcpConfig: rawAttachment(result.value.plugin.plugin_json, "mcp.json") ?? "" });
    } else if (rels[index].target_version_id || axios.isCancel(result.reason) || !isDanglingTarget(result.reason)) {
      throw result.reason;
    }
  });
  return connectors;
}

async function getExpertReal(id: string): Promise<ExpertAgent> {
  const request = beginDetail("expert", id);
  const [detail, maps] = await Promise.all([
    pluginDetail(id),
    getExpertCategoryMaps("expert"),
  ]);
  const plugin = detail.plugin;
  const categoryName =
    (plugin.category_id && maps.idToName.get(plugin.category_id)) || "";
  const [{ skills, pluginIds }, connectors] = await Promise.all([loadSkills(detail.relations), loadConnectors(detail.relations)]);
  request.assertCurrent();
  expertSkillIndex.set(request.key, pluginIds);
  const base = mapPluginAgentListItem(plugin, categoryName);
  return {
    ...base,
    // The detail endpoint carries diagnostics beside the plugin envelope;
    // keep the envelope fallback when the top-level field is absent.
    dependencyIssues:
      mapDependencyIssues(detail.dependency_issues) ?? base.dependencyIssues,
    instruction: rawAttachment(plugin.plugin_json, "AGENTS.md") ?? "",
    mcpConfig: rawAttachment(plugin.plugin_json, "mcp.json") ?? "",
    skills,
    connectors,
  };
}

async function getSquadReal(id: string): Promise<ExpertSquad> {
  const request = beginDetail("squad", id);
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
  const skillIndex = new Map<string, SkillTarget[]>();
  // allSettled: one unresolvable member relation must not break the whole squad
  // detail — but only a CONFIRMED 404 is dropped; a 500/403/network error is
  // rethrown so a transient failure doesn't silently shrink the member list (and
  // memberCount). Cancellation still propagates.
  const settledMembers = await Promise.allSettled(
    memberRels.map((rel) => loadSquadMember(rel, skillIndex))
  );
  const members: ExpertMember[] = [];
  for (const [index, res] of settledMembers.entries()) {
    if (res.status === "fulfilled") members.push(res.value);
    else if (memberRels[index].target_version_id || axios.isCancel(res.reason) || !isDanglingTarget(res.reason)) {
      throw res.reason;
    }
    // else: unpinned confirmed 404 → legacy dangling member, safe to drop.
  }
  request.assertCurrent();
  squadSkillIndex.set(request.key, skillIndex);
  const base = mapPluginSquadListItem(plugin, categoryName);
  return {
    ...base,
    dependencyIssues:
      mapDependencyIssues(detail.dependency_issues) ?? base.dependencyIssues,
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
  skillIndex: Map<string, SkillTarget[]>
): Promise<ExpertMember> {
  const detail = await relationDetail(rel);
  const plugin = detail.plugin;
  // relation_json is authoritative for squad wiring; the member's own
  // expert/context.json snapshot is the fallback.
  const wiring = (rel.data ?? {}) as MemberContextWire;
  const context =
    jsonAttachment<MemberContextWire>(plugin.plugin_json, "expert/context.json") ?? {};
  const memberKey =
    wiring.member_key || context.member_key || rel.target_plugin_id;
  const [{ skills, pluginIds }, connectors] = await Promise.all([loadSkills(detail.relations), loadConnectors(detail.relations)]);
  skillIndex.set(memberKey, pluginIds);
  return {
    key: memberKey,
    pluginId: rel.target_plugin_id,
    versionId: rel.target_version_id,
    version: rel.target_version_id ? plugin.current_version : undefined,
    templateId: context.template_id,
    name: plugin.plugin_name ?? "",
    role: wiring.role ?? context.role ?? "",
    leader: Boolean(wiring.is_leader ?? context.is_leader),
    instruction: rawAttachment(plugin.plugin_json, "AGENTS.md") ?? "",
    mcpConfig: rawAttachment(plugin.plugin_json, "mcp.json") ?? "",
    skills,
    connectors,
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

/** Full-replace metadata edit. Read the owner's editable head and preserve
 * opaque content, stored icon keys, relation IDs, member wiring and exact pins.
 * Only the display name inside the manifest changes when explicitly requested.
 * Version labels are optional for existing visibility-only callers.
 */
export async function getExpertEditMetadata(id: string): Promise<ExpertItem> {
  let detail: PluginDetailWire;
  try {
    detail = await get<PluginDetailWire>(`/plugins/${encodeURIComponent(id)}/draft`);
  } catch (err) {
    if (axios.isCancel(err)) throw err;
    throw new Error(t(expertListErrorI18nKey(err)));
  }
  const item = detail.plugin.plugin_type === "expert_team"
    ? mapPluginSquadListItem(detail.plugin, "")
    : mapPluginAgentListItem(detail.plugin, "");
  return { ...item, draftRevision: detail.draft_revision, draftChangelog: detail.draft_changelog ?? "" };
}

async function updateExpertVisibilityReal(
  id: string,
  visibility: ExpertVisibility,
  metadata?: { name: string; version: string; changelog?: string; draftRevision?: string }
): Promise<string | undefined> {
  // include_relations: the echo has to name the current child set, and this is
  // the same read the detail view already performs.
  let detail: PluginDetailWire;
  try {
    // Metadata writes must merge onto the editable head, never an older release.
    detail = await get<PluginDetailWire>(`/plugins/${encodeURIComponent(id)}/draft`);
  } catch (err) {
    if (axios.isCancel(err)) throw err;
    // `get()` rewraps every failure as an ExpertListError whose `message` is the
    // bare classification kind ("unknown", "forbidden", …). Translate it here so
    // the caller can render `err.message` without knowing that.
    throw new Error(t(expertListErrorI18nKey(err)));
  }
  if (!detail.draft_revision || (metadata?.draftRevision && metadata.draftRevision !== detail.draft_revision)) throw new Error(t("skillMarket.errors.stateConflict"));
  const plugin = detail.plugin;
  try {
    const saved = await expertAxios.post(`${BASE}/plugins/upsert`, {
      expected_draft_revision: detail.draft_revision,
      ...(metadata?.changelog !== undefined ? { changelog: metadata.changelog } : {}),
      plugin: {
        plugin_id: id,
        plugin_name: metadata?.name ?? plugin.plugin_name,
        ...(metadata?.version ? { version: metadata.version } : {}),
        plugin_type: plugin.plugin_type,
        // Spread-guarded: an explicit `category_id: undefined` serializes away,
        // but so does an absent one, and the backend reads absent as "clear the
        // category". Sending the key only when there is a value keeps the two
        // cases visibly distinct in the request log.
        ...(plugin.category_id ? { category_id: plugin.category_id } : {}),
        tags: plugin.tags ?? [],
        publisher: plugin.publisher ?? "",
        // The write-canonical stored value, never the presigned display
        // `icon_url` — echoing the latter would persist an expiring URL.
        icon: plugin.icon ?? "",
        visibility,
        manifest_json: metadata ? { ...plugin.manifest_json, plugin_name: metadata.name } : plugin.manifest_json,
        plugin_json: plugin.plugin_json,
      },
      relations: (detail.relations ?? []).map((rel) => ({
        relation_id: rel.relation_id,
        target_plugin_id: rel.target_plugin_id,
        relation_type: rel.relation_type,
        sort_order: rel.sort_order,
        ...(rel.data !== undefined ? { data: rel.data } : {}),
        // Full-replace echo: dropping the pin would silently unpin every edge
        // when an owner only changes the audience.
        ...(rel.target_version_id !== undefined
          ? { target_version_id: rel.target_version_id }
          : {}),
      })),
    });
    return saved?.data?.data?.draft_revision;
  } catch (err) {
    if (axios.isCancel(err)) throw err;
    throw new Error(extractErrorMessage(err));
  }
}

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

async function listExpertTagsReal(kind: ExpertKindParam, mine: boolean, keyword?: string): Promise<string[]> {
  const data = await get<{ name: string; count: number }[] | null>(
    "/plugin_tags",
    {
      plugin_type: pluginTypeOf(kind), scene_code: SCENE_CODE,
      ...(mine ? { mode: "mine" } : {}),
      ...(keyword?.trim() ? { q: keyword.trim() } : {}),
    }
  );
  return Array.isArray(data) ? data.map((tag) => tag.name) : [];
}

async function listExpertCategoriesReal(
  kind: ExpertKindParam
): Promise<ExpertCategoryCount[]> {
  const data = await fetchExpertCategoriesWire(pluginTypeOf(kind));
  return data
    .filter((c) => (c.plugin_count ?? 0) > 0)
    .map((c) => ({ name: c.name, count: c.plugin_count ?? 0 }));
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
    item.name.toLowerCase().includes(keyword);
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

function listExpertTagsMock(kind: ExpertKindParam, mine: boolean, keyword?: string): Promise<string[]> {
  const all: ExpertItem[] = kind === "squad" ? mockSquads : mockAgents;
  const source = mine ? all.filter(isMine) : all;
  const counts = new Map<string, number>();
  for (const item of source) {
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const names = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name)
    .filter((name) => !keyword?.trim() || name.toLowerCase().includes(keyword.trim().toLowerCase()));
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
  return delay(categories.filter((category) => category.count > 0));
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

// Both wrapped for the same reason `deleteMcp` and skillmarket's `deleteSkill`
// are: deleting a plugin settles its pending review request server-side in the
// same transaction, so the Space's pending count drops and every review read —
// the 组织发布管理 badge included — is stale until it re-reads. Attached to the
// endpoint, not to ExpertMarketListPage.handleConfirmDelete, so the next delete
// surface cannot forget. See reviewSignal.ts.
export const deleteExpert = withReviewInvalidation(function deleteExpert(
  id: string
): Promise<void> {
  return USE_MOCK ? deleteExpertMock(id) : deleteExpertReal(id);
});

export const deleteSquad = withReviewInvalidation(function deleteSquad(
  id: string
): Promise<void> {
  return USE_MOCK ? deleteSquadMock(id) : deleteSquadReal(id);
});

/**
 * Set the declared audience of one owned 专家 / 专家团 (see
 * updateExpertVisibilityReal for why this is a full-record echo).
 *
 * No mock branch, for the same reason loadExpertChildRelations has none: the
 * fixtures carry no manifest / package / relation graph, so a mock write could
 * only pretend, and the whole draft→发布 surface it belongs to (publish, review,
 * cancel) is real-only anyway. Fail loudly rather than silently succeed.
 */
export function updateExpertVisibility(
  id: string,
  visibility: ExpertVisibility,
  metadata?: { name: string; version: string; changelog?: string; draftRevision?: string }
): Promise<string | undefined> {
  if (USE_MOCK) {
    return Promise.reject(
      new Error("updateExpertVisibility is not available under USE_MOCK")
    );
  }
  return updateExpertVisibilityReal(id, visibility, metadata);
}

/** One child relation of a container plugin, shaped for a review submission.
 *  Structurally the `PluginReviewRelation` of api/pluginReview.ts — declared
 *  locally so this module keeps its import graph to axios + @octo/base (its unit
 *  suites mock exactly those two). */
export interface ExpertChildRelation {
  targetPluginId: string;
  relationType: string;
  sortOrder: number;
  /** Id of the existing edge, echoed so the backend freezes it untouched
   *  instead of soft-deleting and re-inserting it. */
  relationId?: string;
  /** Opaque per-edge payload — for 专家团 this carries the member's
   *  `member_key` / `is_leader` wiring that makes the team installable. */
  data?: Record<string, unknown>;
  /** Pinned target version; the frozen snapshot must keep it or approval
   *  freezes an unpinned graph. */
  targetVersionId?: string;
}

/**
 * The plugin's CURRENT direct child relation graph (expert → expert_skill,
 * expert_team → expert_team_expert), read straight off `/plugins/detail`.
 *
 * 专家 / 专家团 are container types: a review snapshot that carries only the
 * manifest + package is incomplete, because approving it would re-derive the
 * child set from whatever the live graph happens to be at decision time. The
 * submit payload therefore has to name the children explicitly, and this is the
 * authoritative source for that list.
 *
 * Read from the RAW relations rather than from the `skills` / `members`
 * projections on ExpertAgent / ExpertSquad on purpose: those drop soft-deleted
 * targets, flatten the type into the field name, and (for squads) require an
 * N+1 fan-out to hydrate — none of which the snapshot needs. Every relation type
 * present on the row is echoed, so this stays correct if the backend grows
 * another child edge.
 *
 * KNOWN GAP CLOSED: each edge is now echoed WITH its `relation_id` and `data`
 * (a 专家团 member's `member_key` / `is_leader` wiring). Matching on relation_id
 * freezes an untouched edge instead of soft-deleting and re-inserting it, and
 * `data` keeps the wiring that makes the team installable. Mirrors
 * updateExpertVisibilityReal's echo.
 */
export async function loadExpertChildRelations(
  id: string
): Promise<ExpertChildRelation[]> {
  // No mock branch: the fixtures in mock/expertMock.ts carry no relation graph,
  // and USE_MOCK is pinned false. A mock caller would get an empty list, which
  // "replace the graph with []" would then act on — so fail loudly instead.
  if (USE_MOCK) {
    throw new Error("loadExpertChildRelations is not available under USE_MOCK");
  }
  const detail = await pluginDetail(id);
  return mapChildRelations(detail.relations);
}

/** The child-relation projection, split out so the upgrade snapshot can derive
 *  it from the SAME detail response its content comes from. */
function mapChildRelations(
  relations: PluginDetailWire["relations"]
): ExpertChildRelation[] {
  return [...(relations ?? [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((rel, index) => ({
      targetPluginId: rel.target_plugin_id,
      relationType: rel.relation_type,
      // Re-normalized to a dense 0..n-1 sequence in the order the backend
      // itself renders children (liveRelations sorts by sort_order), so a
      // sparse or duplicated stored ordering can't reorder the approved copy.
      sortOrder: index,
      // Echoed verbatim so the frozen snapshot keeps each edge's identity and
      // its 专家团 member wiring (member_key / is_leader) — without them the
      // backend re-inserts the edge and loses what makes the team installable.
      relationId: rel.relation_id,
      ...(rel.data !== undefined ? { data: rel.data } : {}),
      ...(rel.target_version_id !== undefined
        ? { targetVersionId: rel.target_version_id }
        : {}),
    }));
}

/** The live FROZEN content of a 专家 / 专家团, read off `/plugins/detail`, to
 *  echo WITH an upgrade review submission.
 *
 * 专家 / 专家团 records are authored by a Bot through octo-cli, not in the
 * browser, so there is no client-side form to re-collect the content from on an
 * upgrade. But the backend refuses a contentless submission for an
 * already-listed plugin (freezeSubmission → `manifest_json/required`, HTTP 400):
 * snapshotting the still-live row would make the review theatre. The client
 * therefore reads the current row's own manifest + package and submits them
 * verbatim — the frozen bytes the reviewer approves are exactly what is live
 * today, and the listed version keeps serving until the decision.
 *
 * Only called on an UPGRADE (an already-listed container). A first listing sends
 * no content: the row is still a private draft the server can freeze as-is. */
export async function loadExpertReviewContent(
  id: string
): Promise<{ manifestJson: unknown; pluginJson: unknown }> {
  if (USE_MOCK) {
    throw new Error("loadExpertReviewContent is not available under USE_MOCK");
  }
  const detail = await pluginDetail(id);
  return {
    manifestJson: detail.plugin.manifest_json,
    pluginJson: detail.plugin.plugin_json,
  };
}

/** Freeze the owner's saved draft documents and exact pins from ONE response.
 * Public detail serves the older release and may omit unavailable dependencies;
 * it must never be used to build an upgrade payload. Draft failures propagate.
 */
export async function loadExpertReviewSnapshot(id: string): Promise<{
  content: { manifestJson: unknown; pluginJson: unknown };
  relations: ExpertChildRelation[];
  version?: string;
}> {
  if (USE_MOCK) {
    throw new Error("loadExpertReviewSnapshot is not available under USE_MOCK");
  }
  const detail = await get<PluginDetailWire>(`/plugins/${encodeURIComponent(id)}/draft`);
  return {
    version: detail.plugin.current_version ?? undefined,
    content: {
      manifestJson: detail.plugin.manifest_json,
      pluginJson: detail.plugin.plugin_json,
    },
    relations: mapChildRelations(detail.relations),
  };
}

/** Record one detail view for an expert ("agent") or squad. Fire-and-forget:
 *  never rejects — failures are swallowed inside (a lost view is meaningless
 *  to the user and must not surface). */
export function trackExpertView(kind: ExpertKindParam, id: string): Promise<void> {
  return USE_MOCK ? trackExpertViewMock(kind, id) : trackExpertViewReal(kind, id);
}

/** GET /plugin_tags — scoped tag suggestions, filtered before the server limit. */
export function listExpertTags(kind: ExpertKindParam, options: { mine?: boolean; keyword?: string } = {}): Promise<string[]> {
  return USE_MOCK
    ? listExpertTagsMock(kind, options.mine ?? false, options.keyword)
    : listExpertTagsReal(kind, options.mine ?? false, options.keyword);
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
): Promise<SkillTarget> {
  let ids = expertSkillIndex.get(detailIndexKey(expertId));
  if (!ids || !ids[index]) {
    await getExpertReal(expertId);
    ids = expertSkillIndex.get(detailIndexKey(expertId));
  }
  const pluginId = ids?.[index];
  if (!pluginId) throw new Error(t("mcp.errors.notFound"));
  return pluginId;
}

async function skillPluginIdForSquad(
  squadId: string,
  memberKey: string,
  index: number
): Promise<SkillTarget> {
  let byMember = squadSkillIndex.get(detailIndexKey(squadId));
  if (!byMember || !byMember.get(memberKey)?.[index]) {
    await getSquadReal(squadId);
    byMember = squadSkillIndex.get(detailIndexKey(squadId));
  }
  const pluginId = byMember?.get(memberKey)?.[index];
  if (!pluginId) throw new Error(t("mcp.errors.notFound"));
  return pluginId;
}

async function fetchSkillMarkdown(target: SkillTarget): Promise<string> {
  if (target.versionId) {
    const resp = await expertAxios.get(`${BASE}${versionPath(target)}/file`, {
      params: { path: "SKILL.md" }, responseType: "text",
    });
    return resp.data;
  }
  return get<{ content?: string }>("/plugins/skill_md", {
    plugin_id: target.pluginId,
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
  index: number,
  displayedSkill?: ExpertSkill
): Promise<string> {
  return USE_MOCK
    ? delay(`(sample) skill #${index} content placeholder`)
    : displayedSkill
      ? fetchSkillMarkdown(displayedSkillTarget(displayedSkill))
      : getExpertSkillContentReal(expertId, index);
}

/** GET /squads/{id}/skill_md?member=&i= — a squad member's skill content. */
export function getSquadSkillContent(
  squadId: string,
  memberKey: string,
  index: number,
  displayedSkill?: ExpertSkill
): Promise<string> {
  return USE_MOCK
    ? delay(`(sample) member skill #${index} content placeholder`)
    : displayedSkill
      ? fetchSkillMarkdown(displayedSkillTarget(displayedSkill))
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
  if (url.startsWith(`${BASE}/plugins/`) && /\/versions\/[^/?]+$/.test(url)) {
    const snapshot: { data: HistoricalPluginWire } = await resp.json();
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    let size = 0;
    const attachments = snapshot.data.plugin_json.attachments ?? [];
    if (attachments.length > 1000) throw new Error("package has too many entries");
    for (const attachment of attachments) {
      const name = attachment.path;
      if (!name || name.startsWith("/") || name.split("/").some(p => p === ".." || p === ".") || name.includes("\\")) {
        throw new Error("invalid historical file path");
      }
      const bytes = await fetchSkillPackage(`${url}/file?path=${encodeURIComponent(name)}`, signal);
      size += bytes.byteLength;
      if (size > MAX_SKILL_PACKAGE_FETCH_BYTES) throw new Error("package too large");
      zip.file(name, bytes);
    }
    return zip.generateAsync({ type: "arraybuffer" });
  }
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

// Bind modal reads to the actual rendered snapshot, even if another view has
// since refreshed this parent and populated a different positional index.
function displayedSkillTarget(skill: ExpertSkill): SkillTarget {
  if (!skill.pluginId) throw new Error(t("mcp.errors.notFound"));
  return { pluginId: skill.pluginId, versionId: skill.versionId };
}
async function skillDownloadPath(target: SkillTarget): Promise<string> {
  if (!target.versionId) return `${BASE}/plugins/download?plugin_id=${encodeURIComponent(target.pluginId)}`;
  // Legacy archives have a stable virtual file path. Tree packages are assembled
  // from verified version files below, never from current /plugins/download.
  const snapshot = await get<HistoricalPluginWire>(versionPath(target));
  const legacy = snapshot.plugin_json.attachments?.some(a => a.path === "skill/ref.json" || a.path === "skill/package.zip");
  return `${BASE}${versionPath(target)}${legacy ? "/file?path=skill%2Fpackage.zip" : ""}`;
}
const getExpertSkillDownloadUrlReal = (id: string, index: number) =>
  skillPluginIdForExpert(id, index).then(skillDownloadPath);
const getSquadSkillDownloadUrlReal = (id: string, memberKey: string, index: number) =>
  skillPluginIdForSquad(id, memberKey, index).then(skillDownloadPath);

/** Resolve the authenticated download path for the expert's skill package. Used
 *  both to fetch + unzip the package client-side (file browser) and to trigger a
 *  download; consume it through fetchSkillPackage so auth headers attach. */
export function getExpertSkillDownloadUrl(id: string, index: number, displayedSkill?: ExpertSkill): Promise<string> {
  return displayedSkill ? skillDownloadPath(displayedSkillTarget(displayedSkill)) : getExpertSkillDownloadUrlReal(id, index);
}

/** Resolve the authenticated download path for a squad member's skill package. */
export function getSquadSkillDownloadUrl(
  id: string,
  memberKey: string,
  index: number,
  displayedSkill?: ExpertSkill
): Promise<string> {
  return displayedSkill ? skillDownloadPath(displayedSkillTarget(displayedSkill)) : getSquadSkillDownloadUrlReal(id, memberKey, index);
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

export interface LoopInstallationOptions {
  workspaceId: string;
  runtimeId: string;
  /** Reuse this key for retries of the same user operation. */
  idempotencyKey: string;
}

/** getRandomValues also works on HTTP deployments without randomUUID support. */
export function createLoopInstallationKey(): string {
  return Array.from(
    globalThis.crypto.getRandomValues(new Uint32Array(4)),
    (part) => part.toString(16).padStart(8, "0")
  ).join("-");
}

const CAPABILITY_INSTALL_TIMEOUT_MS = 150_000;

function installLoopPlugin(pluginId: string, opts: LoopInstallationOptions) {
  return expertAxios.post(
    `${BASE}/plugins/${encodeURIComponent(pluginId)}/installations`,
    { runtime_id: opts.runtimeId },
    {
      headers: {
        "X-Workspace-ID": opts.workspaceId,
        "Idempotency-Key": opts.idempotencyKey,
      },
      timeout: CAPABILITY_INSTALL_TIMEOUT_MS,
    }
  );
}

/** Install an expert through Fleet's atomic capability installer. */
export async function installExpertToLoop(
  expertId: string,
  opts: LoopInstallationOptions
): Promise<{ agentId: string }> {
  try {
    const resp = await installLoopPlugin(expertId, opts);
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

/** Install a team and its members in one Fleet capability transaction. */
export async function installSquadToLoop(
  squadId: string,
  opts: LoopInstallationOptions
): Promise<{ squadId: string }> {
  try {
    const resp = await installLoopPlugin(squadId, opts);
    const data = (resp?.data?.data ?? null) as { squad_id?: string } | null;
    const newSquadId = data?.squad_id ?? "";
    // The squad id is the whole point of this call — a 2xx without it means the
    // squad was not formed. Fail rather than falsely report success.
    if (!newSquadId) throw new Error(t("mcp.expert.installFailed"));
    return { squadId: newSquadId };
  } catch (err) {
    if (axios.isCancel(err)) throw err;
    throw new Error(
      installErrorMessage(err, "mcp.expert.installConflictSquad")
    );
  }
}

/** Installation conflicts include missing releases and expired retry receipts;
 * uncertain upstream outcomes carry same-key retry instructions in the hint. */
function installErrorMessage(err: unknown, conflictKey: string): string {
  const wire = (
    err as {
      response?: {
        data?: { error?: { code?: string; message?: string; hint?: string } };
      };
    }
  )?.response?.data?.error;
  const code = wire?.code;
  if (code === "CONFLICT" || code === "UPSTREAM_UNAVAILABLE") {
    const guidance = [wire?.message, wire?.hint].filter(
      (part): part is string => typeof part === "string" && part.length > 0
    );
    if (guidance.length > 0) return guidance.join(" ");
  }
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
