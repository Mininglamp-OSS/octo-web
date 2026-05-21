import type { OidcHttpClient } from './api'

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

function combineSignals(
  external: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (!external) return timeout
  // AbortSignal.any merges signals — aborts when any input aborts.
  // Available in modern browsers; vitest jsdom polyfills via undici.
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([external, timeout])
  }
  // Fallback for environments lacking AbortSignal.any.
  const controller = new AbortController()
  const onAbort = (s: AbortSignal) => () => controller.abort(s.reason)
  if (external.aborted) controller.abort(external.reason)
  else external.addEventListener('abort', onAbort(external), { once: true })
  if (timeout.aborted) controller.abort(timeout.reason)
  else timeout.addEventListener('abort', onAbort(timeout), { once: true })
  return controller.signal
}

/**
 * OIDC bind 流程要按 HTTP status 分支处理 (400/401/409/410/429/500/503),
 * 老 fetchHttpClient 把 status 字符串化丢失语义。保留 status + 解析 body.msg
 * 让上层 UI 可以做错误码→文案映射。
 */
export class OidcBindHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly msg?: string,
  ) {
    super(msg ? `HTTP ${status}: ${msg}` : `HTTP ${status}`)
    this.name = 'OidcBindHttpError'
  }
}

// 后端约定 4xx/5xx 响应体: {"msg": "<英文短描述>"}.
// thirdlogin 老端点不遵循此契约, 解析失败时返回 undefined 不抛.
async function parseErrorMsg(resp: Response): Promise<string | undefined> {
  const text = await resp.text().catch(() => '')
  if (!text) return undefined
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object') {
      const m = (parsed as Record<string, unknown>).msg
      if (typeof m === 'string' && m !== '') return m
    }
  } catch {
    /* 非 JSON 响应体 */
  }
  return text || undefined
}

/**
 * OIDC endpoints live at absolute paths like `/v1/...` and must bypass the
 * apiClient baseURL (which is `/api/...`). Use the global fetch.
 *
 * Each request is wrapped in a 10s timeout, ORed with an optional caller
 * signal so cancellation aborts the in-flight request immediately.
 */
export const fetchHttpClient: OidcHttpClient = {
  async get<T>(url: string, init?: { signal?: AbortSignal }): Promise<T> {
    const signal = combineSignals(init?.signal, DEFAULT_REQUEST_TIMEOUT_MS)
    const resp = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    })
    if (!resp.ok) {
      throw new OidcBindHttpError(resp.status, await parseErrorMsg(resp))
    }
    return (await resp.json()) as T
  },
  async post<T>(
    url: string,
    body: unknown,
    init?: { signal?: AbortSignal },
  ): Promise<T> {
    const signal = combineSignals(init?.signal, DEFAULT_REQUEST_TIMEOUT_MS)
    const resp = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body ?? {}),
      signal,
    })
    if (!resp.ok) {
      throw new OidcBindHttpError(resp.status, await parseErrorMsg(resp))
    }
    return (await resp.json()) as T
  },
}
