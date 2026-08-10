import type { SSOProvider } from './types'

const DEFAULT_RETURN_TO = '/login'
// `flag` is forwarded to the backend OIDC callback and recorded on the IM
// device-token row that the WS CONNECT packet later looks up.
// Values per WuKongIM: 0 = app, 1 = web, 2 = pc.
// Web:      flag=1 (WuKongIM JS SDK hardcodes deviceFlag=1)
// Electron: flag=2 (desktop PC client)
// Mirror the value normal password login sends in `user/login`.
export const OIDC_FLAG_WEB = '1'
export const OIDC_FLAG_PC = '2'

export function buildAuthorizeURL(
  provider: SSOProvider,
  authcode: string,
  returnTo: string = DEFAULT_RETURN_TO,
  flag: string = OIDC_FLAG_WEB,
  baseURL?: string,
): string {
  const params = new URLSearchParams()
  params.set('authcode', authcode)
  params.set('return_to', returnTo)
  params.set('flag', flag)
  const relativePath = `${provider.authorizePath}?${params.toString()}`
  if (!baseURL) return relativePath
  // Ensure baseURL ends with "/" so that new URL() resolves a path-relative
  // authorizePath correctly and does not strip the last path segment.
  // If authorizePath starts with "/" it is treated as server-root-relative,
  // which is intentional and consistent with browser fetch semantics.
  const base = baseURL.endsWith('/') ? baseURL : `${baseURL}/`
  return new URL(relativePath, base).toString()
}

export interface OidcUrlState {
  error: boolean
}

export function parseOidcUrlState(search: string): OidcUrlState {
  const normalized = search.startsWith('?') ? search.slice(1) : search
  const params = new URLSearchParams(normalized)
  return { error: params.get('oidc_error') === '1' }
}
