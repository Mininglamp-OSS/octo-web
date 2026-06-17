// Thin typed seam for octo-web (`@octo/base` / dmworkbase / WKApp).
//
// octo-web is an external pnpm/Turborepo monorepo that is NOT present in this
// standalone repo. Rather than vendoring it, we declare the minimal interfaces the
// docs module depends on. In real octo-web these resolve to the published packages:
//
//   - IModule, WKApp, RouteManager  -> `dmworkbase` (packages/dmworkbase/src/...)
//   - WKApp.apiClient               -> APIClient.ts (global axios instance,
//                                       baseURL '/api/v1/', injects `token` header)
//
// See README "octo-web integration" for the wiring (registerModule + workspace dep).

import type { ReactElement, ElementType } from 'react'

/** Module interface — packages/dmworkbase/src/Service/Module.ts. */
export interface IModule {
  id(): string
  init(): void
}

/** Subset of axios response shape the docs module reads. */
export interface ApiResponse<T = unknown> {
  data: T
  status: number
}

/** Axios-style error the docs module inspects (status / data.error). */
export interface ApiError<T = unknown> {
  response?: {
    status: number
    data?: T
  }
}

export interface ApiRequestConfig {
  signal?: AbortSignal
  /**
   * Axios responseType passthrough. The version-history `…/state` endpoint returns a
   * binary Yjs state blob, so the client passes `'arraybuffer'` to get an ArrayBuffer
   * back instead of parsed JSON (feature #4 §7). Defaults to axios' `'json'`.
   */
  responseType?: 'json' | 'arraybuffer'
}

/**
 * Subset of octo-web's APIClient. Paths are passed BARE-RELATIVE (e.g. `/docs/...`)
 * and inherit `axios.defaults.baseURL = '/api/v1/'`, resolving to `/api/v1/docs/...`
 * (frontend-design §11.2(3)). A global request interceptor injects the `token`
 * header (NOT `Authorization: Bearer`) — the docs module writes no auth code.
 */
export interface APIClient {
  get<T = unknown>(url: string, config?: ApiRequestConfig): Promise<ApiResponse<T>>
  post<T = unknown>(url: string, body?: unknown, config?: ApiRequestConfig): Promise<ApiResponse<T>>
  put<T = unknown>(url: string, body?: unknown, config?: ApiRequestConfig): Promise<ApiResponse<T>>
  patch<T = unknown>(url: string, body?: unknown, config?: ApiRequestConfig): Promise<ApiResponse<T>>
  delete<T = unknown>(url: string, config?: ApiRequestConfig): Promise<ApiResponse<T>>
}

/**
 * Self-built RouteManager — packages/dmworkbase/src/Service/Route.tsx (NOT react-router).
 * The real signature is `register(path, handler: (param: any) => JSX.Element | React.ElementType)`.
 * The seam widens the handler to the param form so the real `@octo/base` RouteManager stays
 * structurally compatible, while existing `() => ReactElement` factories remain assignable.
 */
export interface RouteManager {
  register(path: string, handler: (param?: any) => ReactElement | ElementType): void
}

/** Current login session — packages/dmworkbase/src/Service/...; token is opaque (non-JWT). */
export interface LoginInfo {
  uid: string
  token: string
}

export interface ModuleManager {
  registerModule(module: IModule): void
}

/** The WKApp singleton surface the docs module touches. */
export interface WKAppShape {
  shared: ModuleManager
  route: RouteManager
  apiClient: APIClient
  loginInfo: LoginInfo
}
