// WKApp accessor.
//
// In the octo-web monorepo this seam resolves the REAL WKApp singleton exported by
// `@octo/base` (packages/dmworkbase). The standalone docs repo used a settable mock
// holder; here we keep `setWKApp` ONLY as a test-injection point (vitest passes a
// createMockWKApp(), see octoweb/mock.ts) and fall back to the real `@octo/base` WKApp
// whenever no override has been set — i.e. in production and dev.

import { WKApp, i18n, t, useI18n, Menus, SpaceService } from '@octo/base'
import type { APIClient, ApiRequestConfig, ApiResponse, MittBusLite, SpaceMemberLite, WKAppShape } from './types.ts'

// Test-only override. When unset (production / dev), getWKApp() returns the real
// `@octo/base` WKApp singleton below.
let override: WKAppShape | null = null

/**
 * Inject a WKApp implementation. In octo-web this is normally NOT called — the real
 * `@octo/base` singleton is used. Vitest calls it with createMockWKApp() so tests run
 * without bootstrapping the full app.
 */
export function setWKApp(app: WKAppShape): void {
  override = app
}

/** The active WKApp: the test override if set, otherwise the real `@octo/base` singleton. */
export function getWKApp(): WKAppShape {
  if (override) return override
  // `WKApp` is a class exposing route / apiClient / loginInfo / shared as STATIC members;
  // that static surface matches WKAppShape structurally. We cast through `unknown` because
  // the real APIClient / RouteManager signatures are wider than this seam's minimal subset.
  return WKApp as unknown as WKAppShape
}

/**
 * The host's RIGHT (main) route pane manager. Production: the real static WKApp.routeRight
 * (a ContextRouteManager) — the same one Matter/Summary push their detail panel into so it
 * fills the main content area while the list stays in the left route slot. Tests: the
 * override's routeRight stub if provided, else null (DocsHome falls back to inline render).
 */
export function getRouteRight(): import('./types.ts').RouteRight | null {
  if (override) return override.routeRight ?? null
  const rr = (WKApp as unknown as { routeRight?: import('./types.ts').RouteRight }).routeRight
  return rr ?? null
}

/**
 * Subscribe to the host's global "space switched" broadcast.
 *
 * The host emits `WKApp.mittBus.emit('space-changed', space)` whenever the user picks a
 * different Space (packages/dmworkbase/src/Pages/Chat/vm.ts `set selectedSpace`, apps/web
 * Pages/Main). `WKApp.shared.currentSpaceId` is a plain mutable field — reassigning it does
 * NOT re-render React — so a component that derives state from it (DocsHome's document list)
 * keeps showing the old Space's docs until a manual reload. Like the summary / todo /
 * contacts modules, docs must listen to this event and re-read `currentSpaceId` to react.
 *
 * Returns an unsubscribe function. No-op (returns a noop unsubscribe) when no bus is
 * available — an older test mock without one, or a non-browser context.
 */
export function onSpaceChanged(cb: () => void): () => void {
  const bus: MittBusLite | undefined = override
    ? override.mittBus
    : (WKApp as unknown as { mittBus?: MittBusLite }).mittBus
  if (!bus) return () => {}
  // Ignore the payload: docs reacts to the switch by re-reading currentSpaceId itself.
  const handler = () => cb()
  bus.on('space-changed', handler)
  return () => bus.off('space-changed', handler)
}

/** Page size for space-member fetches — mirrors the host useMemberList pattern (default 50). */
const SPACE_MEMBERS_PAGE_SIZE = 50
/** Cap total pages so an unexpectedly huge space can't loop unbounded (1000 members). */
const SPACE_MEMBERS_MAX_PAGES = 20

/** Minimal view of the host SpaceService the docs seam touches (uid + name + avatar/robot). */
interface HostSpaceMember {
  uid: string
  name?: string
  /** Display avatar URL from GET space/{id}/members. */
  avatar?: string
  /** Host robot flag: 0 = human, 1 = AI. Mapped to SpaceMemberLite.isBot. */
  robot?: number
}
interface HostSpaceService {
  shared: {
    getMembers(spaceId: string, page: number, limit: number): Promise<HostSpaceMember[]>
  }
}

/**
 * Map a host/mock member down to the lite shape, carrying avatar + isBot ONLY when present so
 * callers that supply just `{ uid, name }` (and the existing seam tests) get back exactly that —
 * no `avatar: undefined` / `isBot: false` noise. `robot` (host) → `isBot` (0=human, 1=AI); the
 * test/override path already provides `isBot` directly.
 */
function toLite(m: HostSpaceMember & { isBot?: boolean }): SpaceMemberLite {
  const lite: SpaceMemberLite = { uid: m.uid, name: m.name || m.uid }
  if (m.avatar != null) lite.avatar = m.avatar
  if (typeof m.isBot === 'boolean') lite.isBot = m.isBot
  else if (m.robot != null) lite.isBot = m.robot === 1
  return lite
}

/**
 * Fetch ONE page of the current space's members through the seam, mapped to `{ uid, name }`.
 *
 * Test path: when a mock is injected via setWKApp(), route through its `getSpaceMembers`
 * override (or return [] if it doesn't provide one). Production/dev path: call the REAL host
 * `SpaceService.shared.getMembers(...)` (re-exported from `@octo/base`) and map each member
 * down to uid + display name — docs needs nothing else. `name` falls back to the uid so a
 * member with no display name never renders blank.
 */
export async function getSpaceMembers(
  spaceId: string,
  page: number,
  limit: number = SPACE_MEMBERS_PAGE_SIZE,
): Promise<SpaceMemberLite[]> {
  if (override) {
    if (!override.getSpaceMembers) return []
    const batch = await override.getSpaceMembers(spaceId, page, limit)
    return (batch ?? []).map((m) => toLite(m as HostSpaceMember & { isBot?: boolean }))
  }
  const svc = SpaceService as unknown as HostSpaceService
  const batch = await svc.shared.getMembers(spaceId, page, limit)
  return (batch ?? []).map((m) => toLite(m))
}

/**
 * Fetch ALL members of a space, looping pages until exhausted (page size 50), mirroring the
 * host useMemberList "loop to fetch all pages" pattern. Bounded by SPACE_MEMBERS_MAX_PAGES so
 * a very large space can't loop forever. Returns `{ uid, name }` pairs.
 */
export async function fetchAllSpaceMembers(spaceId: string): Promise<SpaceMemberLite[]> {
  if (!spaceId) return []
  const all: SpaceMemberLite[] = []
  let page = 1
  while (page <= SPACE_MEMBERS_MAX_PAGES) {
    const batch = await getSpaceMembers(spaceId, page, SPACE_MEMBERS_PAGE_SIZE)
    if (!batch || batch.length === 0) break
    all.push(...batch)
    if (batch.length < SPACE_MEMBERS_PAGE_SIZE) break // last page
    page++
  }
  return all
}

/**
 * Re-wrap the REAL host APIClient so its responses look axios-style to docs callers.
 *
 * WHY: the host APIClient (packages/dmworkbase/src/Service/APIClient.ts) `wrapResult()`
 * resolves every request to the response BODY directly (`Promise.resolve(value.data)`) —
 * NOT an axios `{ data }` envelope. But every docs call site destructures
 * `const { data } = await apiClient().get<T>(path)`, and the test mock (octoweb/mock.ts)
 * returns `{ data, status }`. Against the un-wrapped host client `data` is `undefined`, so
 * e.g. DocsHome's `res.items` throws "Cannot read properties of undefined (reading 'items')"
 * — breaking EVERY docs API call in production while all tests stay green.
 *
 * Fixing it here, at the single seam, re-establishes one contract for all ~20 call sites
 * instead of touching each one: the host method resolves to the body, we re-wrap it into
 * `{ data: <body>, status }`. Config (incl. the host's `config.param` → axios params) is
 * forwarded untouched, so the host signature keeps working.
 *
 * The ERROR path needs the same adaptation. The host rejects with `APIClientRejectedError`
 * (`{ error, msg, status, code, … }` — see dmworkbase/Service/APIClient.ts), NOT an axios-style
 * `{ response }`. But every docs error handler reads `err.response?.status` / `err.response.data?.error`
 * (members 404 → user_not_found, attachments 400, versions 409, delete status classification …).
 * Against the un-adapted host rejection `err.response` is `undefined`, so EVERY production error
 * branch silently falls through to its default while all tests (which inject the axios-style mock)
 * stay green. We re-wrap the rejection too, lifting the original axios error's `{ status, data }`
 * up to `.response`, so the same `{ response }` contract holds on both the success and error paths.
 */
function toApiErrorEnvelope(err: unknown): unknown {
  if (!err || typeof err !== 'object') return err
  // Already axios-style (the injected test mock rejects this way, or an upstream re-wrap) — pass through.
  if ('response' in err) return err
  // Host APIClientRejectedError: `{ error: <original axios error>, status, msg, code, … }`.
  // The original axios error carries the faithful `{ response: { status, data } }`; lift it up so
  // docs' `err.response?.status` / `err.response.data?.error` branches see it unchanged.
  const rejected = err as { error?: unknown; status?: number }
  const inner = rejected.error
  if (inner && typeof inner === 'object' && 'response' in inner) {
    const innerResp = (inner as { response?: unknown }).response
    if (innerResp) return Object.assign(err, { response: innerResp })
  }
  // No axios response on the inner error (e.g. timeout / network) but the host normalized an HTTP
  // status — surface it so status-based branches still classify; the body is genuinely unavailable.
  if (typeof rejected.status === 'number') {
    return Object.assign(err, { response: { status: rejected.status } })
  }
  return err
}

export function wrapHostClient(host: APIClient): APIClient {
  // The host RESOLVES TO THE BODY at runtime; it's typed `ApiResponse<T>` only because the
  // seam declares the post-adapter contract. Read each result as the raw body and re-wrap;
  // re-wrap a rejection into the axios-style `{ response }` shape docs error handlers expect.
  const toEnvelope = <T>(p: Promise<unknown>): Promise<ApiResponse<T>> =>
    p.then(
      (body) => ({ data: body as T, status: 200 }),
      (err) => Promise.reject(toApiErrorEnvelope(err)),
    )
  return {
    get: <T>(url: string, config?: ApiRequestConfig) => toEnvelope<T>(host.get<T>(url, config)),
    post: <T>(url: string, body?: unknown, config?: ApiRequestConfig) =>
      toEnvelope<T>(host.post<T>(url, body, config)),
    put: <T>(url: string, body?: unknown, config?: ApiRequestConfig) =>
      toEnvelope<T>(host.put<T>(url, body, config)),
    patch: <T>(url: string, body?: unknown, config?: ApiRequestConfig) =>
      toEnvelope<T>(host.patch<T>(url, body, config)),
    delete: <T>(url: string, config?: ApiRequestConfig) => toEnvelope<T>(host.delete<T>(url, config)),
  }
}

/**
 * Convenience: the shared apiClient (bare-relative `/docs/...` paths, see types.ts).
 *
 * Test path: when a mock is injected via setWKApp(), return its apiClient AS-IS — the mock
 * already produces axios-style `{ data }`. Production/dev path: wrap the REAL host client so
 * its body-returning methods match that same `{ data }` contract (see wrapHostClient).
 */
export function apiClient(): APIClient {
  if (override) return override.apiClient
  return wrapHostClient(getWKApp().apiClient)
}

/** Current authenticated uid (frontend-design §6.1 / §7.3 — token cache is keyed by uid). */
export function getCurrentUid(): string {
  return getWKApp().loginInfo.uid
}

/** Re-export the real i18n so docs code can register namespaces without importing @octo/base directly. */
export { i18n }

/**
 * Re-export the translation helpers through the same seam. `t(key)` reads the current locale
 * synchronously (use in non-component code / one-shot reads); `useI18n()` subscribes a React
 * component to locale changes via the host's I18nProvider context. Both resolve to the REAL
 * `@octo/base` implementation in production and to the lightweight stub in tests.
 */
export { t, useI18n }

/** Re-export the real Menus class so the docs module can register a NavRail entry
 * through the seam without importing @octo/base directly. */
export { Menus }

export * from './types.ts'
