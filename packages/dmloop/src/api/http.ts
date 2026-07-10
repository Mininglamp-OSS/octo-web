// @octo/loop — HTTP 客户端（后端契约联调）
// 所有请求走 /fleet/api/v1（Vite dev proxy → http://127.0.0.1:8091），路径与 后端契约一致。
// workspace 相关接口统一携带 header `x-workspace-slug`（值取自顶部 workspace 下拉当前 slug）。
import axios from "axios";
import { WKApp } from "@octo/base";

export const LOOP_API_BASE =
  (import.meta as { env?: Record<string, string> }).env?.VITE_LOOP_API_BASE ||
  "/fleet/api/v1";

const client = axios.create({ baseURL: LOOP_API_BASE, withCredentials: true });

/* ---------- CSRF（fleet 采用 double-submit：cookie multica_csrf === header X-CSRF-Token） ---------- */
const CSRF_COOKIE = "multica_csrf";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.split("; ").find((c) => c.startsWith(name + "="));
  return m ? decodeURIComponent(m.split("=").slice(1).join("=")) : null;
}

function randomToken(): string {
  try {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

/**
 * 保证存在 multica_csrf cookie 并返回其值；double-submit 只校验 cookie===header，
 * 服务端登录时也会下发该 cookie，这里在缺失时前端补一个，二者一致即通过。
 */
function ensureCsrfToken(): string {
  let tok = readCookie(CSRF_COOKIE);
  if (!tok && typeof document !== "undefined") {
    tok = randomToken();
    document.cookie = `${CSRF_COOKIE}=${tok}; path=/; SameSite=Lax`;
  }
  return tok ?? "";
}

/* ---------- workspace 上下文 ---------- */
// 顶部下拉选中的 workspace：slug 用于 header，id 用于路径参数（如 members）。
let _workspaceSlug = "";
let _workspaceId = "";

export function currentWorkspaceSlug(): string {
  return _workspaceSlug;
}
export function currentWorkspaceId(): string {
  return _workspaceId;
}
export function setWorkspaceContext(slug: string, id: string): void {
  _workspaceSlug = slug || "";
  _workspaceId = id || "";
}

// 统一注入 x-workspace-slug + 鉴权 header + CSRF token。
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
  const method = (config.method ?? "get").toLowerCase();
  if (method !== "get" && method !== "head") {
    config.headers["X-CSRF-Token"] = ensureCsrfToken();
  }
  return config;
});

/* ---------- 结构化错误（供页面展示异常态） ---------- */
export class LoopApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "LoopApiError";
    this.status = status;
  }
}

function toApiError(err: unknown): LoopApiError {
  const e = err as {
    response?: { status?: number; data?: { error?: string; message?: string } };
    message?: string;
  };
  const msg =
    e?.response?.data?.error ||
    e?.response?.data?.message ||
    e?.message ||
    "Request failed";
  return new LoopApiError(String(msg), e?.response?.status);
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
