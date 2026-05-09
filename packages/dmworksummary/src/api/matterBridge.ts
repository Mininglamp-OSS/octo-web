import axios from 'axios';
import { WKApp } from '@octo/base';

// ─── 本地类型定义（最小子集）────────────────────────────

export type MatterStatus = 'open' | 'done' | 'archived';

export interface MatterBrief {
  id: string;
  title: string;
  status: MatterStatus;
  creator_id: string;
  created_at: string;
  updated_at: string;
}

export interface MatterListParams {
  status?: MatterStatus;
  q?: string;
  limit?: number;
  cursor?: string;
}

export interface Pagination {
  has_more: boolean;
  next_cursor?: string;
}

export interface PaginatedList<T> {
  data: T[];
  pagination: Pagination;
}

// ─── Axios 实例（与 todoApi.ts 完全一致的模式）─────────

const matterAxios = axios.create({ baseURL: '' });

matterAxios.interceptors.request.use((config) => {
  const token = WKApp.loginInfo.token;
  if (token) {
    config.headers = config.headers ?? {};
    config.headers['token'] = token;
  }
  const spaceId = WKApp.shared.currentSpaceId;
  if (spaceId) {
    config.headers = config.headers ?? {};
    config.headers['X-Space-Id'] = spaceId;
  }
  return config;
});

matterAxios.interceptors.response.use(undefined, (err) => {
  if (err?.response?.status === 401) {
    WKApp.shared.logout();
  }
  return Promise.reject(err);
});

// ─── 路径 & 工具函数 ────────────────────────────────────

const BASE = '/matter/api/v1';

function extractErrorMessage(err: unknown): string {
  const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
  const msg = axiosErr?.response?.data?.error?.message;
  const raw = msg || (err instanceof Error ? err.message : 'Request failed');
  return raw.length > 200 ? raw.slice(0, 200) + '…' : raw;
}

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

// ─── API 接口 ───────────────────────────────────────────

export async function listMatters(params?: MatterListParams): Promise<PaginatedList<MatterBrief>> {
  try {
    const resp = await matterAxios.get(`${BASE}/matters`, {
      params: buildParams(params as unknown as Record<string, unknown>),
    });
    return resp.data;
  } catch (err) {
    throw new Error(extractErrorMessage(err));
  }
}

export async function addComment(matterId: string, content: string): Promise<void> {
  const trimmed = content?.trim();
  if (!trimmed) {
    throw new Error('Comment content cannot be empty');
  }
  try {
    await matterAxios.post(`${BASE}/matters/${matterId}/comments`, { content: trimmed });
  } catch (err) {
    throw new Error(extractErrorMessage(err));
  }
}
