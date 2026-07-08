// @octo/loop — HTTP 客户端
// 所有 Loop 数据访问都经过真实网络请求（DevTools Network 可见），路径与 multica REST 契约对齐。
// 本版本这些请求被 MSW 拦截并返回 Mock 数据；后续摘掉 MSW 即可直连 multica-server，页面与网络层零改动。
import axios from "axios";

/**
 * Loop API base。默认 `/fleet/api/v1`。
 * Loop 是独立 server 服务，前置 reverse proxy 按前缀分割（类比 summary 的 /summary/api/v1）。
 * 路径尾段与 multica REST 契约一致，仅前缀为 /fleet/api/v1。
 * 通过 VITE_LOOP_API_BASE 可指向真实 Loop server。
 */
export const LOOP_API_BASE =
  (import.meta as { env?: Record<string, string> }).env?.VITE_LOOP_API_BASE ||
  "/fleet/api/v1";

const client = axios.create({ baseURL: LOOP_API_BASE });

// 统一在请求上携带 workspace_id（header + 默认 query），为后续真实链路留口子。
client.interceptors.request.use((config) => {
  const ws = currentWorkspaceId();
  config.headers = config.headers ?? {};
  if (ws) config.headers["X-Workspace-Id"] = ws;
  return config;
});

/* ---------- workspace 上下文（space_id → workspace_id 口子） ---------- */

let _workspaceId = "ws-loop-demo";

export function currentWorkspaceId(): string {
  return _workspaceId;
}

export function setWorkspaceId(id: string): void {
  if (id && id.trim()) _workspaceId = id;
}

/* ---------- HTTP helpers ---------- */

function clean(params?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!params) return out;
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") out[k] = String(v);
  }
  return out;
}

export async function httpGet<T>(
  path: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const resp = await client.get<T>(path, { params: clean(params) });
  return resp.data;
}

export async function httpPost<T>(path: string, body?: unknown): Promise<T> {
  const resp = await client.post<T>(path, body);
  return resp.data;
}

export async function httpPut<T>(path: string, body?: unknown): Promise<T> {
  const resp = await client.put<T>(path, body);
  return resp.data;
}

export async function httpPatch<T>(path: string, body?: unknown): Promise<T> {
  const resp = await client.patch<T>(path, body);
  return resp.data;
}

export async function httpDelete<T>(path: string, body?: unknown): Promise<T> {
  const resp = await client.delete<T>(path, body ? { data: body } : undefined);
  return resp.data;
}
