/**
 * Real HTTP client for the skill marketplace API.
 *
 * This module communicates with the octo-marketplace backend. It maps
 * snake_case responses to camelCase frontend types.
 */
import { API_BASE_URL } from "./constants";
import { WKApp } from "@octo/base";
import type {
  Category,
  NewSkillForm,
  PagedResult,
  ParseStatusResult,
  RawCategory,
  RawPagedResult,
  RawSkill,
  RawSkillVersion,
  Skill,
  SkillListQuery,
  SkillVersion,
  TriggerParseResult,
  UpdateSkillForm,
  UploadInitResult,
  ApiResponse,
} from "../types/skill";

// ─── Helpers ───────────────────────────────────────────────────────────────

export class SkillMarketApiError extends Error {
  constructor(
    public code: string | number,
    message: string,
    public status?: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = "SkillMarketApiError";
  }
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = WKApp.loginInfo?.token;
  if (token) headers.token = token;
  const spaceId = WKApp.shared?.currentSpaceId;
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
    input.details,
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...getAuthHeaders(), ...(init?.headers as Record<string, string> | undefined) },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err; // Let AbortError propagate without wrapping
    }
    const message = err instanceof Error ? err.message : "Network error";
    throw normalizeError({ code: "network_error", message, details: err });
  }

  if (res.status === 204) return undefined as unknown as T;

  // Handle 401 — redirect to login
  if (res.status === 401) {
    const loginPath = (WKApp.loginInfo as Record<string, unknown>)?.loginUrl as string | undefined ?? "/login";
    if (typeof window !== "undefined") window.location.href = loginPath;
    throw normalizeError({ code: "unauthorized", message: "登录已过期，请重新登录", status: 401 });
  }

  // Handle 413 — file too large
  if (res.status === 413) {
    throw normalizeError({ code: "file_too_large", message: "文件过大，请压缩后重试", status: 413 });
  }

  const body = (await parseJson(res)) as Partial<ApiResponse<T>> | null;
  const ok = typeof res.ok === "boolean" ? res.ok : res.status >= 200 && res.status < 300;
  if (!ok) {
    throw normalizeError({
      code: body?.code ?? `http_${res.status}`,
      message: body?.message ?? res.statusText ?? "Request failed",
      status: res.status,
      details: body,
    });
  }

  if (!body || body.code !== 0) {
    throw normalizeError({
      code: body?.code ?? "invalid_response",
      message: body?.message ?? "Invalid response",
      status: res.status,
      details: body,
    });
  }

  return body.data;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

// ─── Mappers ───────────────────────────────────────────────────────────────

function mapCategory(raw: RawCategory, index: number): Category {
  return {
    id: raw.id,
    name: raw.name,
    iconKey: raw.icon_key,
    sortOrder: index + 1,
    skillCount: raw.skill_count,
  };
}

/** Safely coerce tags to string[]. Backend may return a JSON-encoded string. */
function normalizeTags(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags.filter((t): t is string => typeof t === "string");
  if (typeof tags === "string") {
    try {
      const parsed = JSON.parse(tags);
      if (Array.isArray(parsed)) return parsed.filter((t): t is string => typeof t === "string");
    } catch { /* not valid JSON, treat as a single tag */ }
    return tags.trim() ? [tags.trim()] : [];
  }
  return [];
}

function mapSkill(raw: RawSkill): Skill {
  return {
    id: raw.id,
    name: raw.name,
    displayName: raw.display_name ?? "",
    description: raw.description ?? "",
    categoryId: raw.category_id,
    tags: normalizeTags(raw.tags),
    ownerId: raw.owner_id,
    ownerName: raw.owner_name ?? "",
    spaceId: raw.space_id,
    visibility: raw.visibility ?? "space",
    version: raw.version ?? "1.0.0",
    readmeContent: raw.readme_content ?? "",
    iconUrl: raw.icon_url ?? "",
    fileName: raw.file_name ?? "",
    fileUrl: raw.file_url ?? "",
    fileSize: raw.file_size ?? 0,
    fileSha256: raw.file_sha256,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function mapPagedResult(raw: RawPagedResult<RawSkill>): PagedResult<Skill> {
  return {
    items: (raw.items ?? []).map(mapSkill),
    nextCursor: raw.next_cursor,
  };
}

// ─── Public API (same signatures as mock skillApi.ts) ──────────────────────

export interface RequestOptions {
  signal?: AbortSignal;
}

export function getCategories(opts?: RequestOptions): Promise<Category[]> {
  return request<RawCategory[]>("/skill/categories", opts?.signal ? { signal: opts.signal } : undefined).then((items) =>
    items.map(mapCategory),
  );
}

export function getSkills(query: SkillListQuery = {}, opts?: RequestOptions): Promise<PagedResult<Skill>> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.categoryId && query.categoryId !== "all")
    params.set("category_id", query.categoryId);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));
  const qs = params.toString();
  return request<RawPagedResult<RawSkill>>(`/skill${qs ? `?${qs}` : ""}`, opts?.signal ? { signal: opts.signal } : undefined).then(
    mapPagedResult,
  );
}

export function getMySkills(query: SkillListQuery = {}, opts?: RequestOptions): Promise<PagedResult<Skill>> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));
  const qs = params.toString();
  return request<RawPagedResult<RawSkill>>(
    `/skill/mine${qs ? `?${qs}` : ""}`, opts?.signal ? { signal: opts.signal } : undefined,
  ).then(mapPagedResult);
}

export function getSkill(id: string): Promise<Skill> {
  return request<RawSkill>(`/skill/${encodeURIComponent(id)}`).then(mapSkill);
}

export function createSkill(form: NewSkillForm): Promise<Skill> {
  return request<RawSkill>("/skill", {
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

  return request<RawSkill>(`/skill/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  }).then(mapSkill);
}

export function deleteSkill(id: string): Promise<void> {
  return request<void>(`/skill/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function getDownloadUrl(id: string): string {
  return `${API_BASE_URL}/skill/${encodeURIComponent(id)}/download`;
}

export async function downloadSkill(id: string): Promise<void> {
  const result = await request<{ url: string }>(`/skill/${encodeURIComponent(id)}/download?format=json`);
  if (!result.url) {
    throw normalizeError({ code: "invalid_response", message: "下载地址无效" });
  }
  const anchor = document.createElement("a");
  anchor.href = result.url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.click();
}

// ─── Upload / Parse flow ───────────────────────────────────────────────────

/** Step 1: Get a pre-signed upload URL from the backend. */
export function initUpload(fileName: string, fileSize: number): Promise<UploadInitResult> {
  return request<{ upload_id: string; presigned_url: string; method: string; headers: Record<string, string>; expires_in: number }>("/skill/upload/init", {
    method: "POST",
    body: JSON.stringify({ file_name: fileName, file_size: fileSize }),
  }).then((raw) => ({
    uploadId: raw.upload_id,
    presignedUrl: raw.presigned_url,
    method: raw.method,
    headers: raw.headers ?? {},
    expiresIn: raw.expires_in,
  }));
}

/** Step 2: Upload the file to the pre-signed URL (PUT). */
export async function uploadFile(presignedUrl: string, file: File, headers?: Record<string, string>, onProgress?: (percent: number) => void): Promise<void> {
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
    xhr.addEventListener("error", () => reject(new Error("Upload network error")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));
    xhr.send(file);
  });
}

/** Upload an icon blob to OSS via the presigned icon upload flow. Returns the object_key to store as icon_url. */
export async function uploadIcon(blob: Blob): Promise<string> {
  const fileName = `icon-${Date.now()}.png`;

  // Step 1: Get presigned URL via icon-specific endpoint
  const initResp = await request<{ object_key: string; presigned_url: string; headers: Record<string, string> }>(
    "/skill/upload/icon",
    {
      method: "POST",
      body: JSON.stringify({ file_name: fileName, file_size: blob.size }),
    },
  );

  // Step 2: Upload the file to presigned URL
  const file = new File([blob], fileName, { type: "image/png" });
  await uploadFile(initResp.presigned_url, file, initResp.headers);

  // Return the object_key — backend stores this and resolves to download URL when returning skills
  return initResp.object_key;
}

/** Step 3: Trigger server-side parsing of the uploaded zip. */
export function triggerParse(uploadId: string): Promise<TriggerParseResult> {
  return request<{ task_id: string }>(`/skill/upload/${encodeURIComponent(uploadId)}/parse`, {
    method: "POST",
  }).then((raw) => ({
    taskId: raw.task_id,
  }));
}

type RawParseStatusResult = {
  status: string;
  task_id: string;
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
      message: raw.error.message ?? "解析失败",
    };
  }
  return result;
}

async function fetchParseStatus(taskId: string): Promise<ParseStatusResult> {
  return request<RawParseStatusResult>(`/skill/parse/${encodeURIComponent(taskId)}`).then(mapParseStatus);
}

/** Step 4: Poll parse status every 2 seconds until success, failure, or timeout. */
export async function pollParse(taskId: string): Promise<ParseStatusResult> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await fetchParseStatus(taskId);
    if (status.status === "success") return status;
    if (status.status === "failed") {
      throw normalizeError({
        code: status.error?.code ?? "parse_failed",
        message: status.error?.message ?? "解析失败",
        details: status.error,
      });
    }
    if (attempt < 59) await wait(2000);
  }
  throw normalizeError({ code: "parse_timeout", message: "解析超时，请重试" });
}

/** Reupload init for an existing skill. */
export function initReupload(skillId: string, fileName: string, fileSize: number): Promise<UploadInitResult> {
  return request<{ upload_id: string; presigned_url: string; method: string; headers: Record<string, string>; expires_in: number }>(
    `/skill/${encodeURIComponent(skillId)}/reupload/init`,
    {
      method: "POST",
      body: JSON.stringify({ file_name: fileName, file_size: fileSize }),
    },
  ).then((raw) => ({
    uploadId: raw.upload_id,
    presignedUrl: raw.presigned_url,
    method: raw.method,
    headers: raw.headers ?? {},
    expiresIn: raw.expires_in,
  }));
}

function mapVersion(raw: RawSkillVersion): SkillVersion {
  return {
    id: raw.id,
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
  return request<{ items: RawSkillVersion[] }>(`/skill/${encodeURIComponent(skillId)}/versions`).then(
    (data) => (data.items ?? []).map(mapVersion),
  );
}
