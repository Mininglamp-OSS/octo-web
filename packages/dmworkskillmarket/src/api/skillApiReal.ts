/**
 * Real HTTP client for the skill marketplace API.
 *
 * Catalog reads and writes target the octo-marketplace UNIFIED plugin surface
 * (`/plugins`, `/plugins/detail`, `/plugin_categories`, `/plugins/*`,
 * plugin_type=skill); the upload → parse pipeline and tag suggestions keep
 * their legacy endpoints on the same service. Snake_case wire shapes are
 * mapped onto the unchanged camelCase frontend types.
 */
import { resolveSkillMarketApiBaseURL } from "./constants";
import { WKApp, t, DEFAULT_REQUEST_TIMEOUT_MS } from "@octo/base";
import type {
  Category,
  NewSkillForm,
  PagedResult,
  ParseStatusResult,
  RawSkillTag,
  ReviewDecisionSource,
  ReviewKind,
  ReviewListMode,
  ReviewRequest,
  ReviewStatus,
  ReviewTargetScope,
  Skill,
  SkillListQuery,
  SkillSort,
  SkillTag,
  SkillVersion,
  TriggerParseResult,
  UpdateSkillForm,
  UploadInitResult,
} from "../types/skill";
import {
  SCENE_CODE,
  jsonAttachment,
  rawAttachment,
  type PluginCategoryWire,
  type PluginDetailPluginWire,
  type PluginDetailWire,
  type PluginListItemWire,
  type PluginReviewRequestWire,
} from "./pluginWire";

interface SuccessEnvelope<T> {
  data: T;
  pagination?: {
    has_more?: boolean;
    next_cursor?: string;
    total?: number;
    page?: number;
    page_size?: number;
  };
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: unknown; hint?: string };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export class SkillMarketApiError extends Error {
  constructor(
    public code: string | number,
    message: string,
    public status?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = "SkillMarketApiError";
  }
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = WKApp.loginInfo?.token;
  if (token) headers.token = token;
  const spaceId =
    WKApp.shared?.currentSpaceId ||
    (typeof localStorage !== "undefined"
      ? localStorage.getItem("currentSpaceId") || ""
      : "");
  if (spaceId) headers["X-Space-Id"] = spaceId;
  return headers;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function normalizeError(input: {
  code?: string | number;
  message?: string;
  status?: number;
  details?: unknown;
}): SkillMarketApiError {
  return new SkillMarketApiError(
    input.code ?? (input.status ? `http_${input.status}` : "unknown_error"),
    input.message || "Request failed",
    input.status,
    input.details
  );
}

async function requestEnvelope<T>(
  path: string,
  init?: RequestInit,
  options?: { auth?: boolean; skipAuthRedirect?: boolean }
): Promise<SuccessEnvelope<T>> {
  const url = `${resolveSkillMarketApiBaseURL()}${path}`;
  const defaultHeaders =
    options?.auth === false
      ? { "Content-Type": "application/json" }
      : getAuthHeaders();
  let res: Response;
  // Bound every request to the shared 20s ceiling. The isolated fetch here
  // never inherits axios.defaults.timeout that APIClient.initAxios sets, so
  // apply the timeout explicitly to avoid the UI-hang class of bug that
  // DEFAULT_REQUEST_TIMEOUT_MS was introduced to close. Compose with any
  // caller-provided signal (e.g. list-request cancellation) so both cancel
  // paths remain honoured.
  const timeoutSignal = AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS);
  const composedSignal =
    init?.signal && typeof (AbortSignal as unknown as { any?: unknown }).any === "function"
      ? (AbortSignal as unknown as { any: (signals: AbortSignal[]) => AbortSignal }).any([
          init.signal,
          timeoutSignal,
        ])
      : init?.signal ?? timeoutSignal;
  try {
    res = await fetch(url, {
      ...init,
      signal: composedSignal,
      headers: {
        ...defaultHeaders,
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err; // Let AbortError propagate without wrapping
    }
    const message = err instanceof Error ? err.message : "Network error";
    throw normalizeError({ code: "network_error", message, details: err });
  }

  // Handle 401 — redirect to login. Fire-and-forget beacons opt out: a 401
  // on a background metric must never tear down the session (the page's list
  // calls are the authoritative session probe), mirroring the expert service.
  if (res.status === 401 && !options?.skipAuthRedirect) {
    const loginPath =
      ((WKApp.loginInfo as unknown as Record<string, unknown>)?.loginUrl as
        | string
        | undefined) ?? "/login";
    if (typeof window !== "undefined") window.location.href = loginPath;
    throw normalizeError({
      code: "unauthorized",
      message: t("skillMarket.errors.unauthorized"),
      status: 401,
    });
  }

  // Handle 413 — file too large
  if (res.status === 413) {
    throw normalizeError({
      code: "file_too_large",
      message: t("skillMarket.errors.fileTooLarge"),
      status: 413,
    });
  }

  const body = (await parseJson(res)) as
    | (Partial<SuccessEnvelope<T>> & ErrorEnvelope)
    | null;
  const ok =
    typeof res.ok === "boolean"
      ? res.ok
      : res.status >= 200 && res.status < 300;
  if (!ok) {
    throw normalizeError({
      code: body?.error?.code ?? `http_${res.status}`,
      message: body?.error?.message ?? res.statusText ?? "Request failed",
      status: res.status,
      details: body?.error?.details ?? body,
    });
  }

  // `204 No Content` is a valid success shape for DELETE (and any endpoint
  // that has nothing to return). `parseJson` returns `null` for an empty
  // body; envelope shape check would otherwise mis-classify a real 204 as
  // `invalid_response`, so the UI shows a failure toast even though the
  // server did the work. Return an empty envelope so callers with `.then()`
  // just see success — flagged as P1 by Jerry-Xin on PR#851.
  if (res.status === 204) {
    return { data: undefined as unknown as T } as SuccessEnvelope<T>;
  }

  if (!body || !("data" in body)) {
    throw normalizeError({
      code: body?.error?.code ?? "invalid_response",
      message: body?.error?.message ?? "Invalid response",
      status: res.status,
      details: body,
    });
  }

  return body as SuccessEnvelope<T>;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  options?: { auth?: boolean; skipAuthRedirect?: boolean }
): Promise<T> {
  return (await requestEnvelope<T>(path, init, options)).data;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

/**
 * Reject presigned upload / download URLs whose scheme is not http(s).
 * Blocks `javascript:` / `data:` / `file:` / arbitrary non-web schemes
 * before an anchor.href / xhr.open accepts them.
 *
 * Scope: scheme-level only. `http(s)://10.x` / `http(s)://169.254.169.254`
 * still pass — internal-host filtering would need a marketplace-side
 * allowlist not shipped here. Blast radius stays bounded because the PUT
 * runs with no app credentials (bare XHR / no interceptors).
 */
function assertSafeExternalURL(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw normalizeError({ code: "invalid_response", message: t("skillMarket.errors.invalidUrl") });
  }
  if (u.protocol === "https:" || u.protocol === "http:") return;
  throw normalizeError({
    code: "invalid_response",
    message: t("skillMarket.errors.urlSchemeNotAllowed"),
  });
}

// ─── Mappers (unified plugin wire → frontend Skill shapes) ──────────────────

/**
 * Reject unsafe package attachment paths before they are echoed back into the
 * trusted /plugins/upsert write on a metadata edit. A backend record could
 * carry a poisoned path; drop anything that is empty, absolute, uses backslash
 * separators, embeds a NUL byte, or contains a `..` traversal segment.
 */
function isSafeAttachmentPath(path: string | undefined): boolean {
  if (typeof path !== "string") return false;
  const trimmed = path.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/")) return false;
  if (trimmed.includes("\\")) return false;
  if (trimmed.includes("\0")) return false;
  return !trimmed.split("/").some((segment) => segment === "..");
}

/** skill/ref.json attachment: artifact pointers shared by backfill and import. */
interface SkillRefWire {
  file_name?: string;
  file_size?: number;
  file_sha256?: string;
  file_url?: string;
  object_key?: string;
  zip_object_key?: string;
}

function mapCategory(raw: PluginCategoryWire, index: number): Category {
  return {
    id: raw.category_id,
    name: raw.name,
    iconKey: raw.icon_key ?? "",
    sortOrder: index + 1,
    skillCount: raw.plugin_count,
  };
}

/** Safely coerce tags to string[]. Backend may return a JSON-encoded string. */
function normalizeTags(tags: unknown): string[] {
  if (Array.isArray(tags))
    return tags.filter((t): t is string => typeof t === "string");
  if (typeof tags === "string") {
    try {
      const parsed = JSON.parse(tags);
      if (Array.isArray(parsed))
        return parsed.filter((t): t is string => typeof t === "string");
    } catch {
      /* not valid JSON, treat as a single tag */
    }
    return tags.trim() ? [tags.trim()] : [];
  }
  return [];
}

function mapSkill(raw: PluginListItemWire): Skill {
  const manifest = raw.manifest_json ?? {};
  return {
    id: raw.plugin_id,
    // The manifest machine name is the legacy skill `name`; plugin_name is the
    // display name.
    name: manifest.name ?? raw.plugin_name ?? "",
    displayName: raw.plugin_name ?? "",
    description: manifest.description ?? "",
    categoryId: raw.category_id ?? "",
    tags: normalizeTags(raw.tags),
    ownerId: raw.owner_id,
    // Backfill preserved the legacy owner display name in publisher.
    ownerName: raw.publisher ?? "",
    // The unified wire carries no creator id. Leaving it undefined (not owner_id)
    // keeps the dual "creator · owner" attribution working: the card falls back
    // to comparing creatorName vs ownerName, which a bot-authored skill needs —
    // setting creatorId = owner_id would make the ids always equal and kill it.
    creatorId: undefined,
    creatorName: raw.creator_name ?? raw.publisher ?? "",
    spaceId: raw.space_id ?? "",
    // Preserve the unified wire's "system" visibility: a system-admin-published
    // skill is official across every market (isPlatformPublishedSkill), so
    // folding it into another bucket would strip its 官方发布 badge. A genuinely
    // unknown / absent value fails CLOSED to "private" — EditSkillModal echoes
    // this value back into a full-replace write, so the non-permissive default
    // must be the most restrictive one, not "space".
    visibility:
      raw.visibility === "public" ||
      raw.visibility === "private" ||
      raw.visibility === "space" ||
      raw.visibility === "system"
        ? raw.visibility
        : "private",
    version: raw.current_version ?? "1.0.0",
    readmeContent: "",
    iconUrl: raw.icon_url ?? raw.icon ?? "",
    fileName: "",
    fileUrl: "",
    fileSize: 0,
    fileSha256: undefined,
    viewCount: raw.view_count ?? 0,
    downloadCount: raw.download_count ?? 0,
    createdAt: raw.created_at ?? "",
    updatedAt: raw.updated_at ?? "",
  };
}

function mapSkillDetail(plugin: PluginDetailPluginWire): Skill {
  const base = mapSkill(plugin);
  const attachments = plugin.plugin_json?.attachments ?? [];
  const isLegacy = attachments.some(
    (a) => a.path === "skill/ref.json" || a.path === "skill/package.zip"
  );
  if (isLegacy) {
    const ref =
      jsonAttachment<SkillRefWire>(plugin.plugin_json, "skill/ref.json") ?? {};
    const managedZip = attachments.find(
      (a) => a.path === "skill/package.zip" && a.content_type === "storage"
    );
    return {
      ...base,
      readmeContent: rawAttachment(plugin.plugin_json, "SKILL.md") ?? "",
      fileName: ref.file_name ?? (managedZip ? "skill.zip" : ""),
      fileUrl: managedZip?.storage_uri ?? ref.zip_object_key ?? ref.file_url ?? "",
      fileSize: ref.file_size ?? managedZip?.content_size ?? 0,
      fileSha256: ref.file_sha256,
    };
  }
  // Tree shape: files live directly in attachments; the download is rebuilt
  // server-side, so metadata is derived from the tree rather than a pointer.
  const hasFiles = attachments.some((a) => a.path !== "SKILL.md");
  const totalSize = attachments.reduce((n, a) => n + (a.content_size ?? 0), 0);
  return {
    ...base,
    readmeContent: rawAttachment(plugin.plugin_json, "SKILL.md") ?? "",
    fileName: hasFiles ? `${base.name}.zip` : "",
    fileUrl: "",
    fileSize: totalSize,
    fileSha256: undefined,
  };
}

function mapSkillTag(raw: RawSkillTag): SkillTag {
  return {
    name: raw.name,
    createdBy: raw.created_by,
    createdAt: raw.created_at ?? "",
    updatedAt: raw.updated_at ?? "",
  };
}

/** Legacy SkillSort → unified list sort. */
function mapSkillSort(sort?: SkillSort): string | undefined {
  if (!sort) return undefined;
  if (sort === "latest") return "newest";
  return sort; // comprehensive / views / downloads match 1:1
}

/** The unified list paginates by page number; the cursor the UI threads
 *  through is simply the next page rendered as an opaque string. */
function cursorToPage(cursor?: string): number {
  const page = Number.parseInt(cursor ?? "", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

// ─── Public API (same signatures as mock skillApi.ts) ──────────────────────

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface CategoryListOptions extends RequestOptions {
  q?: string;
  tags?: string[];
}

export function getCategories(opts?: CategoryListOptions): Promise<Category[]> {
  // The unified taxonomy has no keyword/tag-scoped counts; the q/tags options
  // are accepted for signature compatibility and ignored (chips show catalog
  // totals — accepted in the unified switch).
  const params = new URLSearchParams();
  params.set("scene_code", SCENE_CODE);
  params.set("plugin_type", "skill");
  return request<PluginCategoryWire[] | null>(
    `/plugin_categories?${params.toString()}`,
    opts?.signal ? { signal: opts.signal } : undefined
  ).then((items) => (items ?? []).map(mapCategory));
}

function buildPluginListParams(query: SkillListQuery, mine: boolean): URLSearchParams {
  const params = new URLSearchParams();
  params.set("scene_code", SCENE_CODE);
  params.set("plugin_type", "skill");
  if (mine) params.set("mode", "mine");
  if (query.q) params.set("q", query.q);
  if (query.categoryId && query.categoryId !== "all")
    params.set("category_id", query.categoryId);
  // Repeated `tag` params (AND semantics); repeat instead of comma-joining so
  // a tag value containing a comma still round-trips intact.
  for (const tag of query.tags ?? []) params.append("tag", tag);
  const sort = mapSkillSort(query.sort);
  if (sort) params.set("sort", sort);
  params.set("page", String(cursorToPage(query.cursor)));
  if (query.limit) params.set("page_size", String(query.limit));
  return params;
}

function listPlugins(
  query: SkillListQuery,
  mine: boolean,
  opts?: RequestOptions
): Promise<PagedResult<Skill>> {
  const params = buildPluginListParams(query, mine);
  return requestEnvelope<PluginListItemWire[]>(
    `/plugins?${params.toString()}`,
    opts?.signal ? { signal: opts.signal } : undefined
  ).then(({ data, pagination }) => {
    const items = (data ?? []).map(mapSkill);
    const page = pagination?.page ?? cursorToPage(query.cursor);
    const pageSize = pagination?.page_size ?? query.limit ?? 20;
    const total = pagination?.total ?? items.length;
    return {
      items,
      // Synthesize the legacy opaque cursor from offset pagination: the next
      // cursor is simply the next page number while more rows remain.
      nextCursor: page * pageSize < total ? String(page + 1) : null,
      total,
    };
  });
}

export function getSkills(
  query: SkillListQuery = {},
  opts?: RequestOptions
): Promise<PagedResult<Skill>> {
  return listPlugins(query, false, opts);
}

export function getMySkills(
  query: SkillListQuery = {},
  opts?: RequestOptions
): Promise<PagedResult<Skill>> {
  return listPlugins(query, true, opts);
}

export function getSkillTags(
  q = "",
  opts?: RequestOptions
): Promise<SkillTag[]> {
  // Unified aggregation endpoint: tags come from skill Plugins visible to
  // the caller ({name,count} rows); only `name` is consumed downstream.
  const params = new URLSearchParams();
  params.set("scene_code", SCENE_CODE);
  params.set("plugin_type", "skill");
  const query = q.trim();
  if (query) params.set("q", query);
  params.set("limit", "20");
  return request<Array<{ name: string; count: number }>>(
    `/plugin_tags?${params.toString()}`,
    opts?.signal ? { signal: opts.signal } : undefined
  ).then((data) => (data ?? []).map((tag) => mapSkillTag({ name: tag.name })));
}

export function getSkill(id: string): Promise<Skill> {
  return request<PluginDetailWire>(
    `/plugins/detail?plugin_id=${encodeURIComponent(id)}&include_relations=false`
  ).then((detail) => mapSkillDetail(detail.plugin));
}

export async function trackSkillView(id: string): Promise<void> {
  await request<Record<string, never>>(
    "/metrics/track",
    {
      method: "POST",
      body: JSON.stringify({
        resource_type: "plugin",
        resource_id: id,
        event_type: "view",
      }),
    },
    { skipAuthRedirect: true }
  );
}

/**
 * Fetch the SKILL.md content for a skill. The unified endpoint serves both
 * inlined attachments and legacy backfilled object pointers.
 */
export async function getSkillMd(
  id: string,
  opts?: RequestOptions
): Promise<string> {
  return request<{ content: string }>(
    `/plugins/skill_md?plugin_id=${encodeURIComponent(id)}`,
    opts?.signal ? { signal: opts.signal } : undefined
  ).then((data) => data.content ?? "");
}

/** Shared import body: the legacy parse pipeline's task id plus the document
 *  fields; the marketplace turns it into a skill plugin (create or update). */
function importBody(
  form: NewSkillForm | UpdateSkillForm,
  pluginId?: string
): string {
  const body: Record<string, unknown> = {
    parse_task_id: form.parseTaskId,
    ...(pluginId ? { plugin_id: pluginId } : {}),
    plugin_name: form.displayName || form.name,
    name: form.name,
    description: form.description,
    category_id: form.categoryId || undefined,
    tags: form.tags,
    // A re-upload is a full replace: never send an absent visibility (JSON drops
    // `undefined`), which would let a backend default decide whether a private
    // skill stays private. Fail closed to the most restrictive value.
    visibility: form.visibility ?? "private",
    version: form.version,
    changelog: form.changelog,
  };
  // On a re-upload (existing plugin_id) the import is a full replace, so an
  // absent iconUrl means "icon unchanged" — omit `icon` entirely rather than
  // sending "", which would wipe the stored icon (EditSkillModal only sets
  // iconUrl when a new icon is picked). A fresh create keeps the "" default.
  if (pluginId && form.iconUrl === undefined) {
    return JSON.stringify(body);
  }
  return JSON.stringify({ ...body, icon: form.iconUrl ?? "" });
}

export function createSkill(form: NewSkillForm): Promise<Skill> {
  return request<PluginDetailWire>("/plugins/import", {
    method: "POST",
    body: importBody(form),
  }).then((detail) => mapSkillDetail(detail.plugin));
}

export async function updateSkill(id: string, form: UpdateSkillForm): Promise<Skill> {
  // A reupload carries a fresh parse task: the import endpoint rebuilds the
  // whole package server-side.
  if (form.parseTaskId !== undefined) {
    return request<PluginDetailWire>("/plugins/import", {
      method: "POST",
      body: importBody(form, id),
    }).then((detail) => mapSkillDetail(detail.plugin));
  }
  // Metadata-only edit: the upsert is a full replace, so merge the form onto
  // the current documents and re-embed the canonical manifest.
  const current = await request<PluginDetailWire>(
    `/plugins/detail?plugin_id=${encodeURIComponent(id)}&include_relations=false`
  );
  const plugin = current.plugin;
  const manifest = plugin.manifest_json ?? {};
  const displayName = form.displayName ?? plugin.plugin_name ?? "";
  const name = form.name ?? manifest.name ?? plugin.plugin_name ?? "";
  const description = form.description ?? manifest.description ?? "";
  const tags = normalizeTags(form.tags ?? plugin.tags);
  const visibility = form.visibility ?? plugin.visibility;
  const icon = form.iconUrl !== undefined ? form.iconUrl : plugin.icon ?? "";
  const categoryId =
    form.categoryId !== undefined ? form.categoryId : plugin.category_id;
  const newManifest = {
    $schema: "cowork-plugin-manifest-2.0.json",
    plugin_name: displayName,
    plugin_type: "skill",
    name,
    description,
    labels: tags,
    examples: manifest.examples ?? [],
  };
  // Contract layout: the manifest lives only in manifest_json; any embedded
  // manifest.json attachment on an older record is dropped, the rest of the
  // package passes through untouched — but only after each path is validated,
  // since these come from the backend response and are fed straight back into
  // the trusted upsert write (defense in depth against a poisoned record).
  const attachments = (plugin.plugin_json?.attachments ?? []).filter(
    (a) => a.path !== "manifest.json" && isSafeAttachmentPath(a.path)
  );
  const detail = await request<PluginDetailWire>("/plugins/upsert", {
    method: "POST",
    body: JSON.stringify({
      plugin: {
        plugin_id: id,
        plugin_name: displayName,
        plugin_type: "skill",
        ...(categoryId ? { category_id: categoryId } : {}),
        tags,
        icon,
        visibility,
        // current_version is caller-declared; the skill edit form carries a
        // version field. When absent the backend defaults it to "1.0.0".
        ...(form.version ? { version: form.version } : {}),
        manifest_json: newManifest,
        plugin_json: {
          $schema: "cowork-plugin-package-2.0.json",
          attachments,
        },
      },
      relations: [],
    }),
  });
  // A save IS a version snapshot server-side (the backend appends a
  // plugin_versions row and keeps the default-scene placement's category in
  // sync on every upsert), so there is no separate publish step.
  return mapSkillDetail(detail.plugin);
}

export function deleteSkill(id: string): Promise<void> {
  return request<{ deleted?: boolean }>("/plugins/delete", {
    method: "POST",
    body: JSON.stringify({ plugin_id: id }),
  }).then(() => undefined);
}

// ─── Upload / Parse flow ───────────────────────────────────────────────────

/** Step 1: Get a pre-signed upload URL from the backend. */
export function initUpload(
  fileName: string,
  fileSize: number
): Promise<UploadInitResult> {
  return request<{
    skill_upload_id: string;
    presigned_url: string;
    method: string;
    headers: Record<string, string>;
    expires_in: number;
  }>("/skill_uploads", {
    method: "POST",
    body: JSON.stringify({ file_name: fileName, file_size: fileSize }),
  }).then((raw) => ({
    uploadId: raw.skill_upload_id,
    presignedUrl: raw.presigned_url,
    method: raw.method,
    headers: raw.headers ?? {},
    expiresIn: raw.expires_in,
  }));
}

/** Step 2: Upload the file to the pre-signed URL (PUT). */
export async function uploadFile(
  presignedUrl: string,
  file: File,
  headers?: Record<string, string>,
  onProgress?: (percent: number) => void
): Promise<void> {
  assertSafeExternalURL(presignedUrl);
  // Use XMLHttpRequest for progress support
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", presignedUrl);
    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        xhr.setRequestHeader(key, value);
      }
    }
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed: HTTP ${xhr.status}`));
      }
    });
    xhr.addEventListener("error", () =>
      reject(new Error("Upload network error"))
    );
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));
    xhr.send(file);
  });
}

/** Upload an icon blob to OSS via the presigned icon upload flow. Returns the object_key to store as icon_url. */
export async function uploadIcon(blob: Blob): Promise<string> {
  const fileName = `icon-${Date.now()}.png`;

  // Step 1: Get presigned URL via icon-specific endpoint
  const initResp = await request<{
    object_key: string;
    presigned_url: string;
    headers: Record<string, string>;
  }>("/skill_icon_uploads", {
    method: "POST",
    body: JSON.stringify({ file_name: fileName, file_size: blob.size }),
  });
  // Mirror the presence guard `uploadMcpIconReal` already has — a malformed
  // response would otherwise dereference `undefined.presigned_url` inside
  // `uploadFile` as a bare TypeError instead of a normalized Toast error.
  if (!initResp?.presigned_url || !initResp?.object_key) {
    throw normalizeError({
      code: "invalid_response",
      message: t("skillMarket.errors.uploadResponseMissing"),
    });
  }
  // Step 2: Upload the file to presigned URL
  const file = new File([blob], fileName, { type: "image/png" });
  await uploadFile(initResp.presigned_url, file, initResp.headers);

  // Return the object_key — backend stores this and resolves to download URL when returning skills
  return initResp.object_key;
}

/** Step 3: Trigger server-side parsing of the uploaded zip. */
export function triggerParse(uploadId: string): Promise<TriggerParseResult> {
  return request<{ skill_parse_task_id: string }>(
    `/skill_uploads/${encodeURIComponent(uploadId)}/parse`,
    {
      method: "POST",
    }
  ).then((raw) => ({
    taskId: raw.skill_parse_task_id,
  }));
}

type RawParseStatusResult = {
  status: string;
  skill_parse_task_id: string;
  result?: {
    name: string;
    description?: string;
    version: string;
    tags: string[];
    readme_content?: string;
    file_name: string;
    file_size: number;
    file_sha256: string;
  };
  error?: {
    code: string;
    message: string;
  };
};

function mapParseStatus(raw: RawParseStatusResult): ParseStatusResult {
  const result: ParseStatusResult = {
    status: raw.status as ParseStatusResult["status"],
  };
  if (raw.status === "success" && raw.result) {
    result.result = {
      name: raw.result.name,
      description: raw.result.description ?? "",
      tags: normalizeTags(raw.result.tags),
      version: raw.result.version ?? "1.0.0",
      readmeContent: raw.result.readme_content ?? "",
      fileName: raw.result.file_name ?? "",
      fileSize: raw.result.file_size ?? 0,
      fileSha256: raw.result.file_sha256 ?? "",
    };
  }
  if (raw.status === "failed" && raw.error) {
    result.error = {
      code: raw.error.code ?? "unknown",
      message: raw.error.message ?? t("skillMarket.errors.parseFailed"),
    };
  }
  return result;
}

async function fetchParseStatus(taskId: string): Promise<ParseStatusResult> {
  return request<RawParseStatusResult>(
    `/skill_parse_tasks/${encodeURIComponent(taskId)}`
  ).then(mapParseStatus);
}

/** Step 4: Poll parse status every 2 seconds until success, failure, or timeout. */
export async function pollParse(taskId: string): Promise<ParseStatusResult> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await fetchParseStatus(taskId);
    if (status.status === "success") return status;
    if (status.status === "failed") {
      throw normalizeError({
        code: status.error?.code ?? "parse_failed",
        message: status.error?.message ?? t("skillMarket.errors.parseFailed"),
        details: status.error,
      });
    }
    if (attempt < 59) await wait(2000);
  }
  throw normalizeError({ code: "parse_timeout", message: t("skillMarket.errors.parseTimeout") });
}

/** Reupload init for an existing skill. The unified import consumes any
 *  unbound parse task, so a reupload starts from the same presigned-upload
 *  endpoint as a fresh create; the skill binding happens at import time via
 *  plugin_id. */
export function initReupload(
  _skillId: string,
  fileName: string,
  fileSize: number
): Promise<UploadInitResult> {
  return initUpload(fileName, fileSize);
}

/** Version wire shape of GET /plugins/versions. */
interface PluginVersionWire {
  version_id: string;
  plugin_id: string;
  version: string;
  changelog?: string;
  created_by?: string;
  created_at?: string;
}

function mapVersion(raw: PluginVersionWire): SkillVersion {
  return {
    id: raw.version_id,
    skillId: raw.plugin_id,
    version: raw.version,
    changelog: raw.changelog ?? "",
    storage: { type: "s3" },
    changedBy: raw.created_by ?? "",
    createdAt: raw.created_at ?? "",
  };
}

/** Fetch version history for a skill. */
export function listVersions(skillId: string): Promise<SkillVersion[]> {
  return request<PluginVersionWire[] | null>(
    `/plugins/versions?plugin_id=${encodeURIComponent(skillId)}`
  ).then((items) => (items ?? []).map(mapVersion));
}

// ─── Review requests ─────────────────────────────────────────────────────
//
// Six endpoints under `/plugins/review_requests`. Note the asymmetric response
// shapes: create/get return a review request, `approve` returns the updated
// *plugin detail* and reject/cancel return an empty object — so only the first
// two map to `ReviewRequest`. The decision calls resolve to `void`; callers
// refresh the list, which is the authoritative post-decision state anyway
// (a concurrent decision by another admin can win the CAS race server-side).

function mapReviewRequest(raw: PluginReviewRequestWire): ReviewRequest {
  return {
    id: raw.review_id,
    pluginId: raw.plugin_id,
    pluginName: raw.plugin_name ?? "",
    pluginType: raw.plugin_type ?? "",
    // Backend defect: `plugin_icon` is the raw storage key, not a presigned
    // display URL like `PluginListItemWire.icon_url`. Mapped through as-is so
    // the field is not silently lost, but a consumer MUST keep the letter-avatar
    // fallback — an <img src> on this value 404s today.
    pluginIconUrl: raw.plugin_icon,
    spaceId: raw.space_id,
    targetScope: raw.target_scope as ReviewTargetScope,
    status: raw.status as ReviewStatus,
    kind: raw.kind as ReviewKind,
    version: raw.version,
    currentVersion: raw.current_version,
    changelog: raw.changelog,
    readmeContent: raw.readme_content,
    manifestHash: raw.manifest_hash,
    pluginHash: raw.plugin_hash,
    applicantId: raw.applicant_id,
    applicantName: raw.applicant_name ?? "",
    reviewerId: raw.reviewer_id,
    reviewerName: raw.reviewer_name,
    reason: raw.reason,
    decisionSource: raw.decision_source as ReviewDecisionSource | undefined,
    submittedAt: raw.submitted_at,
    reviewedAt: raw.reviewed_at,
  };
}

/** One relation to freeze alongside the submitted content. */
export interface ReviewRelationInput {
  targetPluginId: string;
  relationType: string;
  sortOrder?: number;
}

/**
 * Input for `POST /plugins/review_requests`.
 *
 * The version label and changelog are always caller-supplied. The content
 * fields are what makes an *upgrade* submission honest: for a plugin already
 * listed to the org the plugin row IS the live content, so freezing "whatever
 * is on the row" would mean the reviewer approves something that already
 * shipped. An upgrade therefore carries the new content, which lands in the
 * frozen snapshot and does not touch the live plugin until approval.
 *
 * A first-listing submission (`kind=first`) is the opposite case: the plugin is
 * a private draft that nobody else can see, so the row is itself the draft and
 * the content fields are omitted.
 */
export interface CreateReviewRequestInput {
  pluginId: string;
  version: string;
  changelog: string;
  /**
   * Parse task of the freshly uploaded package. This is the authoritative
   * content source for a skill upgrade: only the server can turn the verified
   * zip into the canonical attachment tree (text inline, binaries spilled to
   * managed object keys), so the client must NOT try to author `pluginJson`
   * from a parse result — doing so would silently drop every non-SKILL.md file
   * from the snapshot the reviewer approves.
   */
  parseTaskId?: string;
  /** Declared manifest document of the submitted content. */
  manifestJson?: unknown;
  /** Declared package document; only callers holding a real attachment tree
   *  (not a parse task) can supply this. */
  pluginJson?: unknown;
  relations?: ReviewRelationInput[];
}

/** Submit a plugin for Space review. `kind` (first vs upgrade) is still derived
 *  server-side from the plugin's current visibility; the frozen snapshot comes
 *  from the submitted content when present and from the plugin row otherwise.
 *  409 CONFLICT when a request is already pending or the version label is
 *  already published; 404 NOT_FOUND when the caller does not own the plugin.
 *
 *  Absent content fields are omitted from the JSON body entirely rather than
 *  sent as `null` — a `null` manifest is a request to freeze an empty document,
 *  which is not the same thing as "no content supplied". */
export function createReviewRequest(
  input: CreateReviewRequestInput
): Promise<ReviewRequest> {
  const body: Record<string, unknown> = {
    plugin_id: input.pluginId,
    version: input.version,
    changelog: input.changelog,
  };
  if (input.parseTaskId !== undefined) body.parse_task_id = input.parseTaskId;
  if (input.manifestJson !== undefined) body.manifest_json = input.manifestJson;
  if (input.pluginJson !== undefined) body.plugin_json = input.pluginJson;
  if (input.relations !== undefined) {
    body.relations = input.relations.map((relation) => ({
      target_plugin_id: relation.targetPluginId,
      relation_type: relation.relationType,
      ...(relation.sortOrder !== undefined
        ? { sort_order: relation.sortOrder }
        : {}),
    }));
  }
  return request<PluginReviewRequestWire>("/plugins/review_requests", {
    method: "POST",
    body: JSON.stringify(body),
  }).then(mapReviewRequest);
}

export interface ReviewListParams {
  status?: ReviewStatus;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}

/** List review requests. `mode` is required by the server: `mine` is
 *  applicant-scoped, `space` is the reviewer queue and 403s for non-admins.
 *  These endpoints take no `scene_code`/`plugin_type`, so they deliberately do
 *  NOT go through `buildPluginListParams` — review covers every plugin type. */
export function listReviewRequests(
  mode: ReviewListMode,
  params?: ReviewListParams
): Promise<PagedResult<ReviewRequest>> {
  const search = new URLSearchParams();
  search.set("mode", mode);
  if (params?.status) search.set("status", params.status);
  search.set(
    "page",
    String(cursorToPage(params?.page === undefined ? undefined : String(params.page)))
  );
  if (params?.pageSize) search.set("page_size", String(params.pageSize));
  return requestEnvelope<PluginReviewRequestWire[] | null>(
    `/plugins/review_requests?${search.toString()}`,
    params?.signal ? { signal: params.signal } : undefined
  ).then(({ data, pagination }) => {
    const items = (data ?? []).map(mapReviewRequest);
    const page = pagination?.page ?? params?.page ?? 1;
    const pageSize = pagination?.page_size ?? params?.pageSize ?? 20;
    const total = pagination?.total ?? items.length;
    return {
      items,
      // Same offset→opaque-cursor synthesis as the plugin list.
      nextCursor: page * pageSize < total ? String(page + 1) : null,
      total,
    };
  });
}

/** Fetch one request, including `readme_content` (the frozen SKILL.md preview
 *  the list endpoint omits — today the server always returns "", so callers
 *  must treat the preview as optional). Cross-Space access is NOT_FOUND. */
export function getReviewRequest(id: string): Promise<ReviewRequest> {
  return request<PluginReviewRequestWire>(
    `/plugins/review_requests/${encodeURIComponent(id)}`
  ).then(mapReviewRequest);
}

/** Approve (reviewer only). Responds with the updated plugin detail, which the
 *  UI does not consume — it refreshes instead. 403 without the reviewer role,
 *  409 when another admin already decided. */
export function approveReview(id: string): Promise<void> {
  return request<unknown>(
    `/plugins/review_requests/${encodeURIComponent(id)}/approve`,
    { method: "POST" }
  ).then(() => undefined);
}

/** Reject (reviewer only). `reason` is required, non-empty and ≤1000 chars
 *  server-side; a violation comes back as 400 VALIDATION_ERROR. */
export function rejectReview(id: string, reason: string): Promise<void> {
  return request<unknown>(
    `/plugins/review_requests/${encodeURIComponent(id)}/reject`,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
    }
  ).then(() => undefined);
}

/** Withdraw a pending request. Applicant only; reviewers reject instead. */
export function cancelReview(id: string): Promise<void> {
  return request<unknown>(
    `/plugins/review_requests/${encodeURIComponent(id)}/cancel`,
    { method: "POST" }
  ).then(() => undefined);
}
