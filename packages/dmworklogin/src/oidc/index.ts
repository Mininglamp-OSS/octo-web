export type {
  SSOProvider,
  PendingOidcLogin,
  OidcAuthStatus,
} from './types'
export { OIDC_AUTH_STATUS, OIDC_AUTHCODE_TTL_MS } from './types'

export { getSSOProviders, getProviderById } from './providers'
export { buildAuthorizeURL, parseOidcUrlState, OIDC_FLAG_WEB, OIDC_FLAG_PC } from './url'
export { createFetchHttpClient } from './http'
export type { OidcUrlState } from './url'
export {
  savePendingOidcLogin,
  getPendingOidcLogin,
  clearPendingOidcLogin,
  isPendingExpired,
} from './pending'

export {
  savePendingOidcBind,
  getPendingOidcBind,
  clearPendingOidcBind,
  isPendingBindExpired,
  hasValidPendingBind,
  consumePendingBindIfMatches,
} from './pendingBind'
export type { PendingOidcBind } from './pendingBind'

export { fetchAuthcode, fetchAuthStatus } from './api'
export type {
  AuthcodeResponse,
  AuthStatusResponse,
  OidcHttpClient,
  OidcRequestInit,
} from './api'

export {
  pollAuthStatus,
  OidcPollTimeoutError,
  OidcPollCancelledError,
  OidcPollNetworkError,
} from './poller'
export type { PollAuthStatusOptions } from './poller'

export { fetchHttpClient, OidcBindHttpError } from './http'
