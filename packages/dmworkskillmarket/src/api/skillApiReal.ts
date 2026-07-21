/**
 * Real HTTP client for the skill marketplace API.
 *
 * This module communicates with the octo-marketplace backend. It maps
 * snake_case responses to camelCase frontend types.
 */
import { API_BASE_URL } from "./constants";
import { WKApp, t, DEFAULT_REQUEST_TIMEOUT_MS } from "@octo/base";
import type {
  Category,
  NewSkillForm,
  PagedResult,
  ParseStatusResult,
  RawCategory,
  RawPagedResult,
  RawSkill,
  RawSkillTag,
  RawSkillVersion,
  Skill,
  SkillListQuery,
  SkillTag,
  SkillVersion,
  TriggerParseResult,
  UpdateSkillForm,
  UploadInitResult,
} from "../types/skill";

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
  options?: { auth?: boolean }
): Promise<SuccessEnvelope<T>> {
  const url = `${API_BASE_URL}${path}`;
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

  // Handle 401 — redirect to login
  if (res.status === 401) {
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
  options?: { auth?: boolean }
): Promise<T> {
  return (await requestEnvelope<T>(path, init, options)).data;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

/**
 * Reject presigned upload / download URLs whose scheme is not http(s), or
 * whose http-scheme host is not loopback. Blocks `javascript:` / `data:` /
 * `file:` / arbitrary non-web schemes before an anchor.href / xhr.open
 * accepts them.
 *
 * Scope: scheme-level only. `https://10.x` / `https://169.254.169.254`
 * still passes — internal-host filtering would need a marketplace-side
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
  if (u.protocol === "https:") return;
  if (
    u.protocol === "http:" &&
    (u.hostname === "localhost" || u.hostname === "127.0.0.1")
  )
    return;
  throw normalizeError({
    code: "invalid_response",
    message: t("skillMarket.errors.urlSchemeNotAllowed"),
  });
}

// ─── Mappers ───────────────────────────────────────────────────────────────

function mapCategory(raw: RawCategory, index: number): Category {
  return {
    id: raw.skill_category_id ?? raw.id ?? "",
    name: raw.name,
    iconKey: raw.icon_key,
    sortOrder: index + 1,
    skillCount: raw.skill_count,
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

function mapSkill(raw: RawSkill): Skill {
  return {
    id: raw.skill_id ?? raw.id ?? "",
    name: raw.name,
    displayName: raw.display_name ?? "",
    description: raw.description ?? "",
    categoryId: raw.category_id,
    tags: normalizeTags(raw.tags),
    ownerId: raw.owner_id,
    ownerName: raw.owner_name ?? "",
    creatorId: raw.creator_id ?? raw.owner_id,
    creatorName: raw.creator_name ?? raw.owner_name ?? "",
    spaceId: raw.space_id,
    visibility: raw.visibility ?? "space",
    version: raw.version ?? "1.0.0",
    readmeContent: raw.readme_content ?? "",
    iconUrl: raw.icon_url ?? "",
    fileName: raw.file_name ?? "",
    fileUrl: raw.file_url ?? "",
    fileSize: raw.file_size ?? 0,
    fileSha256: raw.file_sha256,
    viewCount: raw.view_count ?? 0,
    downloadCount: raw.download_count ?? 0,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function mapSkillTag(raw: RawSkillTag): SkillTag {
  return {
    name: raw.name,
    createdBy: raw.created_by,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function mapPagedResult(raw: RawPagedResult<RawSkill>): PagedResult<Skill> {
  return {
    items: (raw.items ?? []).map(mapSkill),
    nextCursor: raw.next_cursor,
    total: raw.total ?? raw.items?.length ?? 0,
  };
}

// ─── Public API (same signatures as mock skillApi.ts) ──────────────────────

export interface RequestOptions {
  signal?: AbortSignal;
}

export function getCategories(opts?: RequestOptions): Promise<Category[]> {
  return request<RawCategory[]>(
    "/skill_categories",
    opts?.signal ? { signal: opts.signal } : undefined
  ).then((items) => items.map(mapCategory));
}

export function getSkills(
  query: SkillListQuery = {},
  opts?: RequestOptions
): Promise<PagedResult<Skill>> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.categoryId && query.categoryId !== "all")
    params.set("category_id", query.categoryId);
  if (query.tags?.length) params.set("tags", query.tags.join(","));
  if (query.sort) params.set("sort", query.sort);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("page_size", String(query.limit));
  const qs = params.toString();
  return requestEnvelope<RawSkill[]>(
    `/skills${qs ? `?${qs}` : ""}`,
    opts?.signal ? { signal: opts.signal } : undefined
  ).then(({ data, pagination }) =>
    mapPagedResult({
      items: data,
      next_cursor: pagination?.next_cursor ?? null,
      total: pagination?.total,
    })
  );
}

export function getMySkills(
  query: SkillListQuery = {},
  opts?: RequestOptions
): Promise<PagedResult<Skill>> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  // Forward category_id like getSkills does. Today the "我的" tab hides
  // the category chip so this never lands non-empty, but silently dropping
  // it would break the moment the UI adds a filter chip to that tab.
  if (query.categoryId && query.categoryId !== "all")
    params.set("category_id", query.categoryId);
  if (query.tags?.length) params.set("tags", query.tags.join(","));
  if (query.sort) params.set("sort", query.sort);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("page_size", String(query.limit));
  const qs = params.toString();
  return requestEnvelope<RawSkill[]>(
    `/skills/mine${qs ? `?${qs}` : ""}`,
    opts?.signal ? { signal: opts.signal } : undefined
  ).then(({ data, pagination }) =>
    mapPagedResult({
      items: data,
      next_cursor: pagination?.next_cursor ?? null,
      total: pagination?.total,
    })
  );
}

export function getSkillTags(
  q = "",
  opts?: RequestOptions
): Promise<SkillTag[]> {
  const params = new URLSearchParams();
  const query = q.trim();
  if (query) params.set("q", query);
  params.set("page_size", "20");
  const qs = params.toString();
  return request<{ items: RawSkillTag[] }>(
    `/skills/tags${qs ? `?${qs}` : ""}`,
    opts?.signal ? { signal: opts.signal } : undefined
  ).then((data) => (data.items ?? []).map(mapSkillTag));
}

export function getSkill(id: string): Promise<Skill> {
  return request<RawSkill>(`/skills/${encodeURIComponent(id)}`).then(mapSkill);
}

export async function trackSkillView(id: string): Promise<void> {
  await request<Record<string, never>>("/metrics/track", {
    method: "POST",
    body: JSON.stringify({
      resource_type: "skill",
      resource_id: id,
      event_type: "view",
    }),
  });
}

/**
 * Fetch the SKILL.md content for the current version of a skill.
 * Returns the markdown string on success, or throws (404 means no SKILL.md available).
 */
export async function getSkillMd(
  id: string,
  opts?: RequestOptions
): Promise<string> {
  return request<{ content: string }>(
    `/skills/${encodeURIComponent(id)}/skill_md`,
    opts?.signal ? { signal: opts.signal } : undefined
  ).then((data) => data.content ?? "");
}

export function createSkill(form: NewSkillForm): Promise<Skill> {
  return request<RawSkill>("/skills", {
    method: "POST",
    body: JSON.stringify({
      parse_task_id: form.parseTaskId,
      name: form.name,
      display_name: form.displayName,
      description: form.description,
      category_id: form.categoryId,
      tags: form.tags,
      visibility: form.visibility,
      version: form.version,
      changelog: form.changelog,
      icon_url: form.iconUrl ?? "",
    }),
  }).then(mapSkill);
}

export function updateSkill(id: string, form: UpdateSkillForm): Promise<Skill> {
  const body: Record<string, unknown> = {};
  if (form.parseTaskId !== undefined) body.parse_task_id = form.parseTaskId;
  if (form.name !== undefined) body.name = form.name;
  if (form.displayName !== undefined) body.display_name = form.displayName;
  if (form.description !== undefined) body.description = form.description;
  if (form.categoryId !== undefined) body.category_id = form.categoryId;
  if (form.tags !== undefined) body.tags = form.tags;
  if (form.visibility !== undefined) body.visibility = form.visibility;
  if (form.version !== undefined) body.version = form.version;
  if (form.changelog !== undefined) body.changelog = form.changelog;
  if (form.iconUrl !== undefined) body.icon_url = form.iconUrl;

  return request<RawSkill>(`/skills/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  }).then(mapSkill);
}

export function deleteSkill(id: string): Promise<void> {
  return request<void>(`/skills/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }).then(() => undefined);
}

export function getDownloadUrl(id: string): string {
  return `${API_BASE_URL}/skills/${encodeURIComponent(id)}/download`;
}

export async function downloadSkill(id: string): Promise<void> {
  const result = await request<{ download_url: string }>(
    `/skills/${encodeURIComponent(id)}/download?format=json`
  );
  if (!result.download_url) {
    throw normalizeError({ code: "invalid_response", message: t("skillMarket.errors.invalidDownloadUrl") });
  }
  assertSafeExternalURL(result.download_url);
  const anchor = document.createElement("a");
  anchor.href = result.download_url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.click();
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

/** Reupload init for an existing skill. */
export function initReupload(
  skillId: string,
  fileName: string,
  fileSize: number
): Promise<UploadInitResult> {
  return request<{
    skill_upload_id: string;
    presigned_url: string;
    method: string;
    headers: Record<string, string>;
    expires_in: number;
  }>(`/skills/${encodeURIComponent(skillId)}/reuploads`, {
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

function mapVersion(raw: RawSkillVersion): SkillVersion {
  return {
    id: raw.skill_version_id ?? raw.id ?? "",
    skillId: raw.skill_id,
    version: raw.version,
    changelog: raw.changelog ?? "",
    storage: raw.storage ?? {},
    changedBy: raw.changed_by ?? "",
    createdAt: raw.created_at,
  };
}

/** Fetch version history for a skill. */
export function listVersions(skillId: string): Promise<SkillVersion[]> {
  return request<{ items: RawSkillVersion[] }>(
    `/skills/${encodeURIComponent(skillId)}/versions`
  ).then((data) => (data.items ?? []).map(mapVersion));
}
