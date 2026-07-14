/**
 * Real HTTP client for the skill marketplace API.
 *
 * This module communicates with the octo-marketplace backend. It maps
 * snake_case responses to camelCase frontend types.
 */
import { API_BASE_URL } from "./constants";
import type {
  Category,
  NewSkillForm,
  PagedResult,
  ParseStatusResult,
  RawCategory,
  RawPagedResult,
  RawSkill,
  Skill,
  SkillListQuery,
  TriggerParseResult,
  UpdateSkillForm,
  UploadInitResult,
  ApiResponse,
} from "../types/skill";

// ─── Helpers ───────────────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(
    public code: string | number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });

  // 204 No Content (e.g. DELETE success)
  if (res.status === 204) return undefined as unknown as T;

  const body: ApiResponse<T> = await res.json();

  if (body.code !== 0) {
    throw new ApiError(body.code, body.message ?? "Unknown error");
  }

  return body.data;
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

function mapSkill(raw: RawSkill): Skill {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    categoryId: raw.category_id,
    tags: raw.tags ?? [],
    ownerId: raw.owner_id,
    ownerName: raw.owner_name,
    spaceId: raw.space_id,
    visibility: raw.visibility,
    version: raw.version,
    readmeContent: raw.readme_content,
    fileName: raw.file_name,
    fileUrl: raw.file_url,
    fileSize: raw.file_size,
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

export function getCategories(): Promise<Category[]> {
  return request<RawCategory[]>("/skill/categories").then((items) =>
    items.map(mapCategory),
  );
}

export function getSkills(query: SkillListQuery = {}): Promise<PagedResult<Skill>> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.categoryId && query.categoryId !== "all")
    params.set("category_id", query.categoryId);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));
  const qs = params.toString();
  return request<RawPagedResult<RawSkill>>(`/skill${qs ? `?${qs}` : ""}`).then(
    mapPagedResult,
  );
}

export function getMySkills(query: SkillListQuery = {}): Promise<PagedResult<Skill>> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));
  const qs = params.toString();
  return request<RawPagedResult<RawSkill>>(
    `/skill/mine${qs ? `?${qs}` : ""}`,
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
      description: form.description,
      category_id: form.categoryId,
      tags: form.tags,
      visibility: form.visibility,
      version: form.version,
    }),
  }).then(mapSkill);
}

export function updateSkill(id: string, form: UpdateSkillForm): Promise<Skill> {
  const body: Record<string, unknown> = {};
  if (form.parseTaskId !== undefined) body.parse_task_id = form.parseTaskId;
  if (form.name !== undefined) body.name = form.name;
  if (form.description !== undefined) body.description = form.description;
  if (form.categoryId !== undefined) body.category_id = form.categoryId;
  if (form.tags !== undefined) body.tags = form.tags;
  if (form.visibility !== undefined) body.visibility = form.visibility;
  if (form.version !== undefined) body.version = form.version;

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

/** Step 3: Trigger server-side parsing of the uploaded zip. */
export function triggerParse(uploadId: string): Promise<TriggerParseResult> {
  return request<{ task_id: string }>(`/skill/upload/${encodeURIComponent(uploadId)}/parse`, {
    method: "POST",
  }).then((raw) => ({
    taskId: raw.task_id,
  }));
}

/** Step 4: Poll parse status until success or failure. */
export function pollParse(taskId: string): Promise<ParseStatusResult> {
  return request<{
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
  }>(`/skill/parse/${encodeURIComponent(taskId)}`).then((raw) => {
    const result: ParseStatusResult = {
      status: raw.status as ParseStatusResult["status"],
    };
    if (raw.status === "success" && raw.result) {
      result.result = {
        name: raw.result.name,
        description: raw.result.description ?? "",
        tags: raw.result.tags ?? [],
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
  });
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
