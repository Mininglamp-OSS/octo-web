import axios from "axios";
import { WKApp, buildAcceptLanguage } from "@octo/base";
import type {
  Matter,
  MatterDetail,
  MatterChannel,
  TimelineEntry,
  PaginatedList,
  MatterListParams,
  CreateMatterReq,
  UpdateMatterReq,
  MatterStatus,
  LinkChannelReq,
  ExtractMatterReq,
  ExtractResult,
  TimelineReq,
  ListCommentsParams,
  MatterActivity,
  ListActivitiesParams,
  MatterOutput,
  ListOutputsParams,
} from "../bridge/types";

/**
 * Isolated axios instance for matters service API.
 * Must NOT inherit axios.defaults.baseURL (set to '/api/v1/' by WKApp.apiClient)
 * otherwise all paths get double-prefixed.
 */
const matterAxios = axios.create({ baseURL: "" });

// Inject auth headers via interceptor (consistent with base APIClient pattern).
// Token is read at request time so it stays fresh after refresh.
matterAxios.interceptors.request.use((config) => {
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

// Handle 401 — mirror APIClient behavior (trigger logout on expired token)
matterAxios.interceptors.response.use(undefined, (err) => {
  if (err?.response?.status === 401) {
    WKApp.shared.logout();
  }
  return Promise.reject(err);
});

/**
 * Structured API error that preserves server error code and message.
 * Callers can check `err.code` for specific error handling (e.g. LLM_UPSTREAM_ERROR).
 */
export class ApiError extends Error {
  code?: string;
  status?: number;
  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Extract server error message from axios error response.
 * Returns an ApiError that preserves the structured error code.
 */
function extractApiError(err: unknown): ApiError {
  const axiosErr = err as {
    response?: { status?: number; data?: { error?: { message?: string; code?: string } } };
  };
  const serverError = axiosErr?.response?.data?.error;
  const msg = serverError?.message || (err instanceof Error ? err.message : "Request failed");
  const code = serverError?.code;
  const status = axiosErr?.response?.status;
  // Cap length to prevent pathologically long server error messages in toasts
  const capped = msg.length > 200 ? msg.slice(0, 200) + "…" : msg;
  return new ApiError(capped, code, status);
}

/**
 * Base path for matters service API.
 * Vite dev proxy (apps/web/vite.config.ts) rewrites /matter/* -> /* on the target.
 * Production nginx must have an equivalent rewrite rule.
 */
const BASE = "/matter/api/v1";

/**
 * Build query string params, filtering out undefined values.
 */
function buildParams(obj?: Record<string, unknown>): Record<string, string> {
  if (!obj) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) {
      result[key] = String(value);
    }
  }
  return result;
}

/**
 * Unwrap axios response — return response.data directly.
 * Passes AbortSignal through to axios so callers can cancel in-flight requests.
 * On cancel, rethrows as { name: 'AbortError' } (not wrapped via extractErrorMessage)
 * so consumers can distinguish cancellation from real errors.
 */
async function get<T>(
  path: string,
  params?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    const config: { params: Record<string, string>; signal?: AbortSignal } = {
      params: buildParams(params),
    };
    // 只在有 signal 时加到 config, 避免影响既有调用点的参数形状 (测试快照 + 可读性)
    if (signal) config.signal = signal;
    const resp = await matterAxios.get(`${BASE}${path}`, config);
    return resp.data;
  } catch (err: unknown) {
    if (axios.isCancel(err)) {
      const abortErr = new Error("aborted");
      abortErr.name = "AbortError";
      throw abortErr;
    }
    throw extractApiError(err);
  }
}

async function post<T>(path: string, data?: unknown): Promise<T> {
  try {
    const resp = await matterAxios.post(`${BASE}${path}`, data);
    return resp.data;
  } catch (err: unknown) {
    throw extractApiError(err);
  }
}

async function put<T>(path: string, data?: unknown): Promise<T> {
  try {
    const resp = await matterAxios.put(`${BASE}${path}`, data);
    return resp.data;
  } catch (err: unknown) {
    throw extractApiError(err);
  }
}

async function del<T>(path: string): Promise<T> {
  try {
    const resp = await matterAxios.delete(`${BASE}${path}`);
    return resp.data;
  } catch (err: unknown) {
    throw extractApiError(err);
  }
}

// ─── Matters ────────────────────────────────────────────

export async function listMatters(
  params?: MatterListParams,
  signal?: AbortSignal,
): Promise<PaginatedList<Matter>> {
  return get<PaginatedList<Matter>>(
    "/matters",
    params as unknown as Record<string, unknown>,
    signal,
  );
}

export async function getMatter(
  matterId: string,
  sourceChannelId?: string,
): Promise<MatterDetail> {
  return get<MatterDetail>(
    `/matters/${matterId}`,
    sourceChannelId ? { source_channel_id: sourceChannelId } : undefined,
  );
}

export async function createMatter(
  req: CreateMatterReq,
): Promise<MatterDetail> {
  return post<MatterDetail>("/matters", req);
}

export async function updateMatter(
  matterId: string,
  req: UpdateMatterReq,
): Promise<MatterDetail> {
  return put<MatterDetail>(`/matters/${matterId}`, req);
}

export async function transitionMatter(
  matterId: string,
  status: MatterStatus,
): Promise<MatterDetail> {
  return put<MatterDetail>(`/matters/${matterId}/status`, { status });
}

export async function deleteMatter(matterId: string): Promise<void> {
  return del<void>(`/matters/${matterId}`);
}

// ─── Assignees ──────────────────────────────────────────

export async function addAssignee(
  matterId: string,
  userId: string,
): Promise<void> {
  return post<void>(`/matters/${matterId}/assignees`, { user_id: userId });
}

export async function removeAssignee(
  matterId: string,
  userId: string,
): Promise<void> {
  return del<void>(`/matters/${matterId}/assignees/${userId}`);
}

// ─── Channels ───────────────────────────────────────────

export async function linkChannel(
  matterId: string,
  req: LinkChannelReq,
): Promise<MatterChannel> {
  return post<MatterChannel>(`/matters/${matterId}/channels`, req);
}

export async function unlinkChannel(
  matterId: string,
  channelId: string,
): Promise<void> {
  return del<void>(`/matters/${matterId}/channels/${channelId}`);
}

// ─── Extract (AI 智能创建) ───────────────────────────────

export async function extractMatter(
  req: ExtractMatterReq,
): Promise<ExtractResult> {
  return post<ExtractResult>("/matters/extract", req);
}

// ─── Timeline ───────────────────────────────────────────

export async function listTimeline(
  matterId: string,
  params?: ListCommentsParams,
): Promise<PaginatedList<TimelineEntry>> {
  return get<PaginatedList<TimelineEntry>>(
    `/matters/${matterId}/timeline`,
    params as unknown as Record<string, unknown>,
  );
}

export async function addTimelineEntry(
  matterId: string,
  req: TimelineReq,
): Promise<TimelineEntry> {
  return post<TimelineEntry>(`/matters/${matterId}/timeline`, req);
}

export async function deleteTimelineEntry(
  matterId: string,
  entryId: string,
): Promise<void> {
  return del<void>(`/matters/${matterId}/timeline/${entryId}`);
}

// ─── 兼容旧 API（deprecated） ────────────────────────────

/** @deprecated 使用 listTimeline 替代 */
export const listComments = listTimeline;
/** @deprecated 使用 addTimelineEntry 替代 */
export async function addComment(
  matterId: string,
  content: string,
  attachments?: {
    file_url: string;
    file_name?: string;
    file_size?: number;
    mime_type?: string;
  }[],
): Promise<TimelineEntry> {
  const body: TimelineReq = {
    content: content?.trim() || undefined,
    attachments,
  };
  return post<TimelineEntry>(`/matters/${matterId}/timeline`, body);
}
/** @deprecated 使用 deleteTimelineEntry 替代 */
export const deleteComment = deleteTimelineEntry;

// ─── Activities (变更记录) ───────────────────────────────

export async function listActivities(
  matterId: string,
  params?: ListActivitiesParams,
): Promise<PaginatedList<MatterActivity>> {
  return get<PaginatedList<MatterActivity>>(
    `/matters/${matterId}/activities`,
    params as unknown as Record<string, unknown>,
  );
}

// ─── Outputs (产出文件) ──────────────────────────────────

export async function listOutputs(
  matterId: string,
  params?: ListOutputsParams,
): Promise<PaginatedList<MatterOutput>> {
  return get<PaginatedList<MatterOutput>>(
    `/matters/${matterId}/outputs`,
    params as unknown as Record<string, unknown>,
  );
}
