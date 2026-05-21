import type { BindEntryParams } from './types'

const DEFAULT_RETURN_TO = '/'

/**
 * parseBindEntryParams 从 location.search 解出 bind 入口三参数.
 * provider 字段是前端契约扩展, 缺失时由调用方回退到 FALLBACK_PROVIDER_ID 并埋点.
 *
 * token 的安全责任在调用方 (BindPage):
 *  - 拿到后立即调 clearBindUrl() 清地址栏
 *  - 不要写入任何 store / log / telemetry
 *  - 只在 useRef / closure 持有
 */
export function parseBindEntryParams(search: string): BindEntryParams | null {
  const normalized = search.startsWith('?') ? search.slice(1) : search
  const params = new URLSearchParams(normalized)
  const token = params.get('token') ?? ''
  const authcode = params.get('authcode') ?? ''
  const rawReturnTo = params.get('return_to') ?? ''
  const provider = params.get('provider') ?? undefined

  // token 与 authcode 是流程必备; 缺其一直接拒, 由 BindPage 引导重新登录.
  if (token === '' || authcode === '') return null

  const returnTo = sanitizeReturnTo(rawReturnTo)
  return provider !== undefined
    ? { token, authcode, returnTo, provider }
    : { token, authcode, returnTo }
}

/**
 * sanitizeReturnTo 限定 return_to 必须是站内相对路径.
 *
 * 后端会先做一次 host 白名单校验, 但前端仍做一道防御:
 *  - 只放行 `/` 开头, 不以 `//` 开头 (防 protocol-relative URL 跳第三方)
 *  - 不允许 javascript:/data: 之类 (URL ctor 也会拒, 但这里更早拒)
 * 不合规一律落到 DEFAULT_RETURN_TO.
 *
 * 规则与 OidcConfig.ts:isSafeAuthorizePath 同源, 故意复制而非依赖以避免反向依赖.
 */
export function sanitizeReturnTo(value: string): string {
  if (typeof value !== 'string' || value.length < 1) return DEFAULT_RETURN_TO
  if (!value.startsWith('/') || value.startsWith('//')) return DEFAULT_RETURN_TO
  return value
}

/**
 * clearBindUrl 从地址栏抹掉 bind 入口的 query 段.
 *
 * 目的:
 *  - 浏览器历史不留 token
 *  - 用户截图不暴露 token
 *  - Referer 不带 token 给下一跳
 *
 * 如果路由是 hash 模式 (location.pathname 不变, 路由在 location.hash 上),
 * 这里只清 search 段, 不动 hash. WKApp.route 默认是 path 模式; 真用 hash
 * 部署时 hash 里本来就没 token, 不影响.
 *
 * 测试时可注入 historyApi 替换全局 window.history.
 */
export function clearBindUrl(
  win: Pick<Window, 'history' | 'location'> = window,
): void {
  // replaceState 在 jsdom / 浏览器都有; 没有的话静默失败 — 这一步是 mitigation
  // 不是 hard requirement, 不能因为它失败把 bind 流程整个挂掉.
  try {
    win.history.replaceState({}, '', win.location.pathname)
  } catch {
    /* noop: 老浏览器或 SSR 容器无 history.replaceState */
  }
}
