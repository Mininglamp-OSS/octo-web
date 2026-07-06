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
  /**
   * Per-request headers, merged over the global request interceptor's headers by axios
   * (request-config headers win). The standalone `/d/:docId` preflight uses this to carry an
   * explicit `X-Space-Id`: it mounts via the Layout early-return, before the app shell restores
   * `currentSpaceId`, so the global `spaceIdCallback` interceptor reads an empty space and injects
   * no `X-Space-Id` — the backend's by-space middleware then rejects the bare `getDoc` (400
   * space_required / 404 space mismatch). Passing the space here makes the preflight the source of
   * truth for its own space header. In-shell callers omit this and keep relying on the interceptor.
   */
  headers?: Record<string, string>
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

/**
 * NavRail menu entry — packages/dmworkbase/src/Service/Menus.ts.
 * The real class is constructed as `new Menus(id, routePath, title, icon, selectedIcon, onPress?)`;
 * the docs module imports that class through the octoweb seam (re-exported from @octo/base).
 * Here we only need the manager's register surface, so the menu instance is typed loosely
 * (`unknown`) to avoid a second, conflicting `Menus` declaration alongside the seam re-export.
 */
export interface MenusManager {
  register(sid: string, f: (param?: any) => unknown, sort?: number): void
  /**
   * Re-render the NavRail. The docs module calls this when the `docs_on` gate flips (appconfig
   * arrives / changes) so a menu factory that now returns a Menus (or undefined) is re-evaluated.
   * Optional in the seam: the real host MenusManager implements it; the test mock may stub it.
   */
  refresh?(): void
}

/**
 * Minimal remote-config surface the docs module reads to gate its NavRail entry.
 *
 * Backed by the host `WKApp.remoteConfig` (a WKRemoteConfig instance) in production, whose
 * `docsOn` mirrors the backend `/v1/common/appconfig` `docs_on` field. The listener methods
 * each return an unsubscribe fn (see WKRemoteConfig). Optional on WKAppShape because it is
 * surfaced via the host static cast in prod and provided by the test mock.
 */
export interface RemoteConfigLite {
  /** Docs module display switch (backend appconfig `docs_on`); false/absent → hidden. */
  docsOn: boolean
  /**
   * True once the FIRST appconfig load has resolved. Per the host contract, a subscriber that
   * registers via `addListener` after this is already true will NOT be called (addListener
   * returns a noop), so callers must check this and handle the already-loaded state themselves.
   * Optional in the seam: the real host WKRemoteConfig always provides it; older mocks may omit.
   */
  requestSuccess?: boolean
  /** Fires once on the FIRST successful appconfig load. Returns an unsubscribe fn. */
  addListener(cb: () => void): () => void
  /** Fires on subsequent appconfig CHANGES (after the first load). Returns an unsubscribe fn. */
  addConfigChangeListener(cb: () => void): () => void
}

/** Current login session — packages/dmworkbase/src/Service/...; token is opaque (non-JWT). */
export interface LoginInfo {
  uid: string
  token: string
}

export interface ModuleManager {
  registerModule(module: IModule): void
  /** Currently selected octo Space id (App.shared.currentSpaceId); '' when none. */
  currentSpaceId?: string
}

/**
 * Minimal space-member shape the docs module needs (uid + display name, plus the optional
 * avatar + human/AI flag the member picker shows).
 *
 * The host's SpaceService.getMembers returns a richer SpaceMember (avatar/role/robot/…);
 * docs maps it down to this lite shape. `avatar` (display URL) and `isBot` (mapped from the
 * host's `robot` flag: 0=human, 1=AI) are optional so older callers / tests that only supply
 * uid + name keep working unchanged.
 */
export interface SpaceMemberLite {
  uid: string
  name: string
  /** Display avatar URL, when the host provides one. */
  avatar?: string
  /** True for an AI/robot member (host `robot === 1`); absent when unknown. */
  isBot?: boolean
}

/** The WKApp singleton surface the docs module touches. */
export interface WKAppShape {
  shared: ModuleManager
  route: RouteManager
  menus: MenusManager
  apiClient: APIClient
  loginInfo: LoginInfo
  /**
   * Host remote config (WKApp.remoteConfig). The docs module reads `docsOn` to gate its NavRail
   * entry and subscribes to its listeners to refresh when `docs_on` arrives/changes. Optional in
   * the shape: surfaced via the host static cast in prod; the test mock supplies a stub.
   */
  remoteConfig?: RemoteConfigLite
  /**
   * The host's RIGHT (main) route pane manager (App.routeRight, a ContextRouteManager).
   * Matter/Summary push their detail view here so it fills the main content area while the
   * list stays in the left route slot. Optional in the shape because the test mock provides
   * a lightweight stub; in production this is the real static WKApp.routeRight.
   */
  routeRight?: RouteRight
  /**
   * Fetch one page of the CURRENT space's members (uid + display name only). Optional,
   * declared the same way as `routeRight`: in production octoweb/index.ts wires this to the
   * host's `SpaceService.shared.getMembers(spaceId, page, limit)` (mapping to uid/name); the
   * test mock supplies fake members so docs can resolve uid → name without bootstrapping the
   * host. Absent → docs falls back to showing the raw uid.
   */
  getSpaceMembers?(spaceId: string, page: number, limit: number): Promise<SpaceMemberLite[]>
  /**
   * The host global event bus (WKApp.mittBus). Optional in the shape, declared like
   * `routeRight`: surfaced via the host static cast in production; the test mock supplies a
   * lightweight emitter. Docs subscribes to its `space-changed` event so the list reloads
   * when the user switches Space (`currentSpaceId` is a plain mutable field, so a switch does
   * NOT re-render React on its own — see onSpaceChanged in octoweb/index.ts).
   */
  mittBus?: MittBusLite
}

/** Minimal surface of the host's right-pane route manager (ContextRouteManager). */
export interface RouteRight {
  replaceToRoot(view: unknown): void
  popToRoot(): void
}

/**
 * Minimal view of the host global event bus (WKApp.mittBus, a `mitt` emitter — see
 * packages/dmworkbase/src/App.tsx). The docs module only needs to (un)subscribe to the
 * `space-changed` broadcast the host fires when the user switches Space
 * (`WKApp.mittBus.emit('space-changed', space)` in Chat/vm.ts and apps/web Main), the same
 * signal the summary / todo / contacts modules listen to. Payload is left `unknown` because
 * docs reacts to the switch itself (re-reading `currentSpaceId`), not to the payload.
 */
export interface MittBusLite {
  on(type: 'space-changed', handler: (payload?: unknown) => void): void
  off(type: 'space-changed', handler: (payload?: unknown) => void): void
}
