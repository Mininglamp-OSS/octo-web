// WKApp accessor.
//
// In the octo-web monorepo this seam resolves the REAL WKApp singleton exported by
// `@octo/base` (packages/dmworkbase). The standalone docs repo used a settable mock
// holder; here we keep `setWKApp` ONLY as a test-injection point (vitest passes a
// createMockWKApp(), see octoweb/mock.ts) and fall back to the real `@octo/base` WKApp
// whenever no override has been set — i.e. in production and dev.

import { WKApp, i18n, t, useI18n, Menus } from '@octo/base'
import type { WKAppShape } from './types.ts'

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

/** Convenience: the shared apiClient (bare-relative `/docs/...` paths, see types.ts). */
export function apiClient() {
  return getWKApp().apiClient
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
