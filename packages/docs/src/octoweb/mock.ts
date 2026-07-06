// In-memory mock of octo-web's WKApp for standalone dev and tests.
//
// It records registered modules/routes and lets tests stub apiClient responses.
// This is NOT a fake octo-web — only the seams the docs module actually uses.

import type {
  APIClient,
  ApiRequestConfig,
  ApiResponse,
  IModule,
  LoginInfo,
  RouteManager,
  SpaceMemberLite,
  WKAppShape,
} from './types.ts'
import type { ReactElement } from 'react'

export type RouteHandler = (params: Record<string, string>) => ReactElement

type Responder = (
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  url: string,
  body: unknown,
  config: ApiRequestConfig | undefined,
) => Promise<ApiResponse> | ApiResponse

export class MockApiClient implements APIClient {
  /** Test hook: set a responder to control returned data / thrown errors. */
  responder: Responder | null = null
  /** Recorded calls for assertions. */
  calls: Array<{ method: string; url: string; body?: unknown }> = []

  private async dispatch(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    url: string,
    body: unknown,
    config?: ApiRequestConfig,
  ): Promise<ApiResponse> {
    this.calls.push({ method, url, body })
    if (!this.responder) {
      return { data: {}, status: 200 }
    }
    return this.responder(method, url, body, config)
  }

  get<T>(url: string, config?: ApiRequestConfig) {
    return this.dispatch('get', url, undefined, config) as Promise<ApiResponse<T>>
  }
  post<T>(url: string, body?: unknown, config?: ApiRequestConfig) {
    return this.dispatch('post', url, body, config) as Promise<ApiResponse<T>>
  }
  put<T>(url: string, body?: unknown, config?: ApiRequestConfig) {
    return this.dispatch('put', url, body, config) as Promise<ApiResponse<T>>
  }
  patch<T>(url: string, body?: unknown, config?: ApiRequestConfig) {
    return this.dispatch('patch', url, body, config) as Promise<ApiResponse<T>>
  }
  delete<T>(url: string, config?: ApiRequestConfig) {
    return this.dispatch('delete', url, undefined, config) as Promise<ApiResponse<T>>
  }
}

export class MockRouteManager implements RouteManager {
  routes = new Map<string, () => ReactElement>()
  register(path: string, factory: () => ReactElement): void {
    this.routes.set(path, factory)
  }
}

export class MockMenusManager {
  menus = new Map<string, (param?: any) => unknown>()
  register(sid: string, f: (param?: any) => unknown): void {
    this.menus.set(sid, f)
  }
}

export function createMockWKApp(loginInfo: LoginInfo = { uid: 'u_self', token: 'octo-session-token' }): WKAppShape & {
  apiClient: MockApiClient
  route: MockRouteManager
  mockMenus: MockMenusManager
  registeredModules: IModule[]
  /** Test hook: fake space members the seam's getSpaceMembers paginates over. */
  spaceMembers: SpaceMemberLite[]
} {
  const apiClient = new MockApiClient()
  const route = new MockRouteManager()
  const menus = new MockMenusManager()
  const registeredModules: IModule[] = []
  // Fake space membership tests can populate (wk.spaceMembers.push(...)) so docs can resolve
  // uid → display name through the seam without a live host.
  const spaceMembers: SpaceMemberLite[] = []
  return {
    apiClient,
    route,
    menus: menus as unknown as WKAppShape['menus'],
    mockMenus: menus,
    loginInfo,
    registeredModules,
    spaceMembers,
    // Mirror the real host's paged getMembers: return the requested page slice. Docs loops
    // pages until a short/empty page, so a slice-based mock terminates fetchAllSpaceMembers.
    getSpaceMembers(_spaceId: string, page: number, limit: number) {
      const start = Math.max(0, (page - 1) * limit)
      return Promise.resolve(spaceMembers.slice(start, start + limit))
    },
    shared: {
      registerModule(module: IModule) {
        registeredModules.push(module)
        // Mirror real octo-web: registering a module initializes it (route registration etc.).
        module.init()
      },
    },
  }
}
