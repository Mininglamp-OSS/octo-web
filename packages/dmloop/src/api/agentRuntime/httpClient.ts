// @octo/loop — Agent Runtime httpClient
//
// 独立于既有 axios http.ts：Agent Runtime 后端走 Bearer 鉴权 + `{ok,data,error}`
// 统一信封，与 loop 全域接口（token / X-Space-Id header）契约不同，故单独建客户端。
// 基于原生 fetch（sseClient 也用 fetch 流式，保持同栈），无第三方依赖，便于单测 mock。
//
// 职责：
//   1) 注入 Bearer 鉴权头（token 来源可注入，默认读 loop 既有登录态）
//   2) 401 拦截：统一抛 AgentRuntimeError(401)，并触发可注册的 onUnauthorized 回调
//   3) 解包 {ok,data,error}：ok=false 或 HTTP 非 2xx 抛结构化错误，成功返回 data

import type { Envelope } from "./contracts";

export const AGENT_RUNTIME_BASE =
  (import.meta as { env?: Record<string, string> }).env?.VITE_AGENT_RUNTIME_BASE ||
  "/fleet/api/v1";

/* ---------------------- 鉴权 token 提供者 ---------------------- */
// token 解耦：默认空，宿主（octo-web）在启动时注入真实取值来源（复用登录态），
// 单测里直接 setAuthTokenProvider(() => "t") 即可，无需拉起 @octo/base。
type TokenProvider = () => string | null | undefined;
let _tokenProvider: TokenProvider = () => null;
export function setAuthTokenProvider(fn: TokenProvider): void {
  _tokenProvider = fn;
}

// 401 处理钩子：宿主可注册（如跳登录 / 刷新态）。返回值忽略。
type UnauthorizedHandler = (path: string) => void;
let _onUnauthorized: UnauthorizedHandler | null = null;
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  _onUnauthorized = fn;
}

/* ---------------------- 结构化错误 ---------------------- */
export class AgentRuntimeError extends Error {
  status?: number;
  code?: string;
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "AgentRuntimeError";
    this.status = status;
    this.code = code;
  }
}

function normalizeError(err: Envelope<unknown>["error"]): { message: string; code?: string } {
  if (!err) return { message: "Request failed" };
  if (typeof err === "string") return { message: err };
  return { message: err.message || "Request failed", code: err.code };
}

/* ---------------------- 请求头 ---------------------- */
export function buildAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  const token = _tokenProvider();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

/* ---------------------- 核心请求 ---------------------- */
interface RequestOpts {
  method?: string;
  body?: unknown;
  // 查询参数（会剔除 undefined/null/空串）。
  params?: Record<string, unknown>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

function buildUrl(path: string, params?: Record<string, unknown>): string {
  const base = path.startsWith("http") ? path : `${AGENT_RUNTIME_BASE}${path}`;
  if (!params) return base;
  const qs: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      qs.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  if (!qs.length) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${qs.join("&")}`;
}

// 发起请求并解包信封。始终解析为业务数据 T；异常一律抛 AgentRuntimeError。
export async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const url = buildUrl(path, opts.params);
  const headers = buildAuthHeaders({
    Accept: "application/json",
    ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(opts.headers ?? {}),
  });

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      credentials: "include",
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    // 网络层错误（含 AbortError）：统一包装，AbortError 保留 name 供上层识别。
    if ((e as { name?: string })?.name === "AbortError") throw e;
    throw new AgentRuntimeError((e as Error)?.message || "Network error");
  }

  // 401 拦截：先触发钩子，再抛结构化错误。
  if (resp.status === 401) {
    _onUnauthorized?.(path);
    throw new AgentRuntimeError("Unauthorized", 401, "unauthorized");
  }

  // 解析响应体（可能为空，如 204）。
  let payload: unknown = undefined;
  const raw = await resp.text();
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      // 非 JSON 响应：非 2xx 视为错误文本，2xx 原样返回。
      if (!resp.ok) throw new AgentRuntimeError(raw || `HTTP ${resp.status}`, resp.status);
      return raw as unknown as T;
    }
  }

  // 信封解包：优先按 {ok,data,error} 处理；后端未包信封时（直接返回对象）兜底。
  const env = payload as Envelope<T> | T;
  const looksEnveloped =
    env !== null && typeof env === "object" && "ok" in (env as object);

  if (looksEnveloped) {
    const e = env as Envelope<T>;
    if (!resp.ok || e.ok === false) {
      const { message, code } = normalizeError(e.error);
      throw new AgentRuntimeError(message, resp.status, code);
    }
    return (e.data as T) ?? (undefined as unknown as T);
  }

  // 未信封化：非 2xx 抛错，2xx 原样返回。
  if (!resp.ok) {
    throw new AgentRuntimeError(`HTTP ${resp.status}`, resp.status);
  }
  return env as T;
}

/* ---------------------- 便捷方法 ---------------------- */
export const httpClient = {
  get: <T>(path: string, params?: Record<string, unknown>, signal?: AbortSignal) =>
    request<T>(path, { method: "GET", params, signal }),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
    request<T>(path, { method: "POST", body, signal }),
  put: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
    request<T>(path, { method: "PUT", body, signal }),
  del: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
    request<T>(path, { method: "DELETE", body, signal }),
};
