import type { BindEntryParams } from './types'

const DEFAULT_RETURN_TO = '/'

/**
 * parseBindEntryParams 从 location.search 解出 bind 入口参数.
 *
 * 必填: token (所有 /bind/* 请求都用它, 视为凭据 — PR#73 §2.1)
 * 选填:
 *  - authcode: 原 dmwork 短码. **前端不会发送给任何 /bind/* 端点** — 后端在
 *    callback 签发 bind_token 时已经在 BindSession state 里记下了 (token → authcode)
 *    映射, confirm/create 成功时由后端用这个映射回填 ThirdAuthcode[authcode],
 *    让 A 设备的 thirdlogin/authstatus 轮询能拿到 login_resp (PR#73 §2.3, FR-6.3).
 *    前端持有它仅用于跨设备调试 traceability — 不验证、不传递、不入 log.
 *  - return_to: 用户原本想去的页面 (绝对 / 站内相对均会经 sanitizeReturnTo 二次防御).
 *  - provider: 前端契约扩展. 缺失时由调用方回退 FALLBACK_PROVIDER_ID 并埋点.
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

  // 仅 token 是流程必备 — 没 token 就没法发任何 /bind/* 请求.
  // authcode 缺失也允许进入 bind 页 (前端不需要), 兼容后端将来精简 redirect URL.
  if (token === '') return null

  const returnTo = sanitizeReturnTo(rawReturnTo)
  return provider !== undefined
    ? { token, authcode, returnTo, provider }
    : { token, authcode, returnTo }
}

/**
 * sanitizeReturnTo 限定 return_to 必须是站内相对路径. 双重防御:
 *
 *  1) 字符级 reject: 任何含反斜杠的输入直接拒. 浏览器 URL 解析会把 `\` 当 `/`,
 *     所以 `/\evil.com` 进入 new URL() 后 origin 变成 evil.com — 跨域绕过.
 *     原始 `\` 和 URL-encoded `%5C` / `%5c` 都拒.
 *  2) 起始字符: 必须 `/` 开头但不能 `//` 开头 (防 protocol-relative).
 *  3) origin 同源兜底: 用 new URL(value, location.origin) 解出 origin,
 *     不等于当前页面 origin 一律拒. 防御 (1)(2) 漏掉的奇怪 unicode 同形字符
 *     / 浏览器规范化怪癖.
 *
 * 不合规一律落到 DEFAULT_RETURN_TO.
 *
 * 同源规则与 OidcConfig.ts:isSafeAuthorizePath 一致, 故意复制而非依赖以避免反向依赖.
 */
export function sanitizeReturnTo(
  value: string,
  // 测试时可注入, 默认 window.location.origin.
  pageOrigin: string = typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
): string {
  if (typeof value !== 'string' || value.length < 1) return DEFAULT_RETURN_TO
  // (1) 反斜杠 / URL-encoded 反斜杠 — 任意位置出现都拒.
  if (/\\|%5[cC]/.test(value)) return DEFAULT_RETURN_TO
  // (2) 必须站内相对路径起点.
  if (!value.startsWith('/') || value.startsWith('//')) return DEFAULT_RETURN_TO
  // (3) URL 解析后 origin 必须等于本页. 解析失败也拒.
  try {
    const parsed = new URL(value, pageOrigin)
    if (parsed.origin !== pageOrigin) return DEFAULT_RETURN_TO
  } catch {
    return DEFAULT_RETURN_TO
  }
  return value
}

// Query params that carry bind-flow data — only these get stripped by
// clearBindUrl. Everything else (notably `sid`, which RouteManager injects
// on pageshow and LoginInfo.getSID() reads back at save() time) is preserved.
//
// PR #72 round-3 review (Jerry-Xin): the previous implementation replaced
// location with bare pathname, wiping sid and routing applyLoginResp().save()
// to the empty-sid storage bucket — losing the just-created session on the
// next reload.
const BIND_QUERY_KEYS: ReadonlySet<string> = new Set([
  'token',
  'authcode',
  'return_to',
  'provider',
])

/**
 * clearBindUrl scrubs bind-specific params from the address bar while
 * preserving everything else (in particular `sid`, which the storage layer
 * depends on).
 *
 * Goals:
 *  - browser history doesn't retain the token
 *  - screenshots don't leak the token
 *  - subsequent Referer headers don't carry the token
 *  - sid + any other host-level params stay intact so the storage round-trip
 *    (save → reload → load) reads from the same bucket
 *
 * Hash-mode routing is unaffected: we only edit `location.search`, never
 * `location.hash`. WKApp.route is path-mode today, so the hash is empty.
 *
 * `win` is injectable for tests.
 */
export function clearBindUrl(
  win: Pick<Window, 'history' | 'location'> = window,
): void {
  try {
    const params = new URLSearchParams(win.location.search)
    let mutated = false
    for (const key of BIND_QUERY_KEYS) {
      if (params.has(key)) {
        params.delete(key)
        mutated = true
      }
    }
    if (!mutated) return
    const remaining = params.toString()
    const nextUrl = win.location.pathname + (remaining ? `?${remaining}` : '')
    win.history.replaceState({}, '', nextUrl)
  } catch {
    /* noop: SSR / legacy host without history.replaceState */
  }
}
