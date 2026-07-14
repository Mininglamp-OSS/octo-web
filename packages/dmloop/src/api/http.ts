// @octo/loop — HTTP 客户端（后端契约联调）
// 所有请求走 /fleet/api/v1（Vite dev proxy → http://127.0.0.1:8091），路径与 后端契约一致。
// workspace 相关接口统一携带 header `x-workspace-slug`（值取自顶部 workspace 下拉当前 slug）。
import axios from "axios";
import { WKApp } from "@octo/base";

export const LOOP_API_BASE =
  (import.meta as { env?: Record<string, string> }).env?.VITE_LOOP_API_BASE ||
  "/fleet/api/v1";

const client = axios.create({ baseURL: LOOP_API_BASE, withCredentials: true });

/* ---------- workspace 上下文 ---------- */
// 顶部下拉选中的 workspace：slug 用于 header，id 用于路径参数（如 members）。
// 持久化到 sessionStorage：整页刷新后内存变量会归零、LoopPage 恢复时恒回落 list[0]，
// 故刷新前 seed 回上次选中的 workspace。仅当前标签页（符合 issue 预期）。
const WS_CTX_KEY = "loop.workspace.ctx";
function readWorkspaceCtx(): { slug: string; id: string } {
  try {
    const p = JSON.parse(sessionStorage.getItem(WS_CTX_KEY) ?? "null");
    if (p && typeof p.slug === "string" && typeof p.id === "string") return p;
  } catch { /* ignore */ }
  return { slug: "", id: "" };
}
const _initCtx = readWorkspaceCtx();
let _workspaceSlug = _initCtx.slug;
let _workspaceId = _initCtx.id;

export function currentWorkspaceSlug(): string {
  return _workspaceSlug;
}
export function currentWorkspaceId(): string {
  return _workspaceId;
}
export function setWorkspaceContext(slug: string, id: string): void {
  _workspaceSlug = slug || "";
  _workspaceId = id || "";
  try {
    if (_workspaceId) sessionStorage.setItem(WS_CTX_KEY, JSON.stringify({ slug: _workspaceSlug, id: _workspaceId }));
    else sessionStorage.removeItem(WS_CTX_KEY);
  } catch { /* ignore */ }
}

// 统一注入 x-workspace-slug + 鉴权 header。
client.interceptors.request.use((config) => {
  config.headers = config.headers ?? {};
  if (_workspaceSlug) config.headers["x-workspace-slug"] = _workspaceSlug;
  // 后端对 loop 全域接口校验以下两个鉴权 header，复用 octo-web 其他模块
  // （dmworkbase APIClient）的取值来源：token 取自 WKApp.loginInfo.token，
  // space_id 取自 WKApp.shared.currentSpaceId。仅在非空时注入。
  const token = WKApp.loginInfo.token;
  if (token) config.headers["token"] = token;
  const spaceId = WKApp.shared.currentSpaceId;
  if (spaceId) config.headers["X-Space-Id"] = spaceId;
  return config;
});

/* ---------- 结构化错误（供页面展示异常态） ---------- */
export class LoopApiError extends Error {
  status?: number;
  code?: string; // 后端结构化错误码(如 quick-create 的 agent_unavailable / daemon_version_unsupported)
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "LoopApiError";
    this.status = status;
    this.code = code;
  }
}

function toApiError(err: unknown): LoopApiError {
  const e = err as {
    response?: { status?: number; data?: { error?: string; message?: string; code?: string; reason?: string } };
    message?: string;
  };
  const data = e?.response?.data;
  const msg =
    data?.error ||
    data?.message ||
    data?.reason || // 结构化 422(如 quick-create)只带 {code, reason},reason 是可读文案
    e?.message ||
    "Request failed";
  return new LoopApiError(String(msg), e?.response?.status, data?.code);
}

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
  try {
    const resp = await client.get<T>(path, { params: clean(params) });
    return resp.data;
  } catch (err) {
    throw toApiError(err);
  }
}

export async function httpPost<T>(path: string, body?: unknown): Promise<T> {
  try {
    const resp = await client.post<T>(path, body);
    return resp.data;
  } catch (err) {
    throw toApiError(err);
  }
}

export async function httpPut<T>(path: string, body?: unknown): Promise<T> {
  try {
    const resp = await client.put<T>(path, body);
    return resp.data;
  } catch (err) {
    throw toApiError(err);
  }
}

export async function httpPatch<T>(path: string, body?: unknown): Promise<T> {
  try {
    const resp = await client.patch<T>(path, body);
    return resp.data;
  } catch (err) {
    throw toApiError(err);
  }
}

export async function httpDelete<T>(path: string, body?: unknown): Promise<T> {
  try {
    const resp = await client.delete<T>(path, body ? { data: body } : undefined);
    return resp.data;
  } catch (err) {
    throw toApiError(err);
  }
}
