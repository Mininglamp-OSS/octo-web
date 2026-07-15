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
  OpenDocForwardOptions,
  RemoteConfigLite,
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
  /** Recorded calls for assertions (includes per-request `config` so tests can assert headers). */
  calls: Array<{ method: string; url: string; body?: unknown; config?: ApiRequestConfig }> = []

  private async dispatch(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    url: string,
    body: unknown,
    config?: ApiRequestConfig,
  ): Promise<ApiResponse> {
    this.calls.push({ method, url, body, config })
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

/**
 * Test double for the host WKApp.mittBus (a `mitt` emitter). Only the `space-changed` channel
 * the docs module subscribes to is modeled. Tests drive a Space switch by mutating
 * `wk.shared.currentSpaceId` and calling `emitSpaceChanged()` — mirroring the host, which sets
 * `currentSpaceId` then emits `space-changed` (packages/dmworkbase/src/Pages/Chat/vm.ts).
 */
export class MockMittBus {
  private spaceChangedListeners: Array<(payload?: unknown) => void> = []
  private navMenuActivatedListeners: Array<(payload: { menuId: string }) => void> = []
  on(type: 'space-changed', handler: (payload?: unknown) => void): void
  on(type: 'wk:nav-menu-activated', handler: (payload: { menuId: string }) => void): void
  on(type: string, handler: (payload?: any) => void): void {
    if (type === 'space-changed') this.spaceChangedListeners.push(handler)
    else if (type === 'wk:nav-menu-activated') this.navMenuActivatedListeners.push(handler)
  }
  off(type: 'space-changed', handler: (payload?: unknown) => void): void
  off(type: 'wk:nav-menu-activated', handler: (payload: { menuId: string }) => void): void
  off(type: string, handler: (payload?: any) => void): void {
    if (type === 'space-changed') {
      this.spaceChangedListeners = this.spaceChangedListeners.filter((l) => l !== handler)
    } else if (type === 'wk:nav-menu-activated') {
      this.navMenuActivatedListeners = this.navMenuActivatedListeners.filter((l) => l !== handler)
    }
  }
  /** Number of space-changed listeners currently registered (leak / idempotency checks). */
  spaceChangedListenerCount(): number {
    return this.spaceChangedListeners.length
  }
  /** Number of nav-menu-activated listeners currently registered (leak checks). */
  navMenuActivatedListenerCount(): number {
    return this.navMenuActivatedListeners.length
  }
  /** Simulate the host broadcasting a Space switch. */
  emitSpaceChanged(payload?: unknown): void {
    for (const l of [...this.spaceChangedListeners]) l(payload)
  }
  /** Simulate the host broadcasting a NavRail entry activation (menu click). */
  emitNavMenuActivated(menuId: string): void {
    for (const l of [...this.navMenuActivatedListeners]) l({ menuId })
  }
}

export class MockMenusManager {
  menus = new Map<string, (param?: any) => unknown>()
  /** Number of times the docs module asked the NavRail to re-render (config gate flips). */
  refreshCount = 0
  register(sid: string, f: (param?: any) => unknown): void {
    this.menus.set(sid, f)
  }
  refresh(): void {
    this.refreshCount++
  }
}

/**
 * Test double for the host WKApp.remoteConfig gate. `docsOn` defaults to true so the existing
 * "menu registers" assertions keep exercising the enabled case; tests that cover the gate set
 * it explicitly and call `emitLoad()` / `emitChange()` to simulate appconfig arriving/changing.
 */
export class MockRemoteConfig implements RemoteConfigLite {
  docsOn: boolean
  /** Mirrors the host contract: true once the first appconfig load has resolved. */
  requestSuccess = false
  private loadListeners: Array<() => void> = []
  private changeListeners: Array<() => void> = []
  constructor(docsOn = true) {
    this.docsOn = docsOn
  }
  addListener(cb: () => void): () => void {
    // Mirror the host: subscribing after the first load already resolved returns a noop, so a
    // late subscriber never fires (it must check requestSuccess and self-handle instead).
    if (this.requestSuccess) {
      return () => {
        /* noop */
      }
    }
    this.loadListeners.push(cb)
    return () => {
      this.loadListeners = this.loadListeners.filter((l) => l !== cb)
    }
  }
  addConfigChangeListener(cb: () => void): () => void {
    this.changeListeners.push(cb)
    return () => {
      this.changeListeners = this.changeListeners.filter((l) => l !== cb)
    }
  }
  /** Number of change listeners currently registered (test hook for idempotent-rebind checks). */
  changeListenerCount(): number {
    return this.changeListeners.length
  }
  /** Simulate the FIRST successful appconfig load firing its one-shot listeners. */
  emitLoad(): void {
    this.requestSuccess = true
    for (const l of [...this.loadListeners]) l()
  }
  /** Simulate a subsequent appconfig change firing its change listeners. */
  emitChange(): void {
    for (const l of [...this.changeListeners]) l()
  }
}

export function createMockWKApp(
  loginInfo: LoginInfo = { uid: 'u_self', token: 'octo-session-token' },
  remoteConfig: MockRemoteConfig = new MockRemoteConfig(),
): WKAppShape & {
  apiClient: MockApiClient
  route: MockRouteManager
  mockMenus: MockMenusManager
  registeredModules: IModule[]
  /** Test hook: the docs gate double (set docsOn, emitLoad/emitChange). */
  mockRemoteConfig: MockRemoteConfig
  /** Test hook: fake space members the seam's getSpaceMembers paginates over. */
  spaceMembers: SpaceMemberLite[]
  /** Test hook: the host event-bus double (emitSpaceChanged to simulate a Space switch). */
  mockMittBus: MockMittBus
  /** Test hook: records every openDocForward() call so forward tests can assert the payload. */
  openDocForwardCalls: OpenDocForwardOptions[]
} {
  const apiClient = new MockApiClient()
  const route = new MockRouteManager()
  const menus = new MockMenusManager()
  const mittBus = new MockMittBus()
  const registeredModules: IModule[] = []
  // Fake space membership tests can populate (wk.spaceMembers.push(...)) so docs can resolve
  // uid → display name through the seam without a live host.
  const spaceMembers: SpaceMemberLite[] = []
  // feature #511: recorded openDocForward payloads for docs-side forward unit tests.
  const openDocForwardCalls: OpenDocForwardOptions[] = []
  return {
    apiClient,
    route,
    menus: menus as unknown as WKAppShape['menus'],
    mockMenus: menus,
    remoteConfig,
    mockRemoteConfig: remoteConfig,
    loginInfo,
    registeredModules,
    spaceMembers,
    mittBus,
    mockMittBus: mittBus,
    openDocForwardCalls,
    openDocForward(opts: OpenDocForwardOptions) {
      openDocForwardCalls.push(opts)
    },
    // Mirror the real host's paged getMembers: return the requested page slice. Docs loops
    // pages until a short/empty page, so a slice-based mock terminates fetchAllSpaceMembers.
    getSpaceMembers(_spaceId: string, page: number, limit: number) {
      const start = Math.max(0, (page - 1) * limit)
      return Promise.resolve(spaceMembers.slice(start, start + limit))
    },
    shared: {
      // Selected Space id. '' by default (host default); tests set it before/after a
      // mockMittBus.emitSpaceChanged() to simulate switching Space.
      currentSpaceId: '',
      registerModule(module: IModule) {
        registeredModules.push(module)
        // Mirror real octo-web: registering a module initializes it (route registration etc.).
        module.init()
      },
    },
  }
}
