import React from 'react'
import { WKApp, IModule } from '@octo/base'
import BindPage from './BindPage'
import { clearBindUrl } from '../oidc/bind'

// 在 module init 时 (startup 同步阶段, 早于 RouteManager 的 pageshow handler)
// 抓住 location.search 快照. RouteManager 的 pageshow 监听器会 push 一个带
// sid= 的新 URL, 把 bind 入口参数 (token / authcode / return_to / provider)
// 一起冲掉; BindPage 再去读 window.location.search 就拿不到了.
//
// 这个 snapshot 在 BindModule.init() 调用瞬间 capture, 然后通过 prop 注入,
// 比 useEffect 里读 window.location.search 更早, 也更确定.
let bindInitialSearch = ''
let bindInitialHref = ''

// Module-level latch set by init() when the current document is an OIDC bind
// entry. Layout gates BindPage on this in addition to pathname, because in
// packaged Electron (file://) Chromium rejects any history.replaceState() that
// changes the path — so pathname stays as .../build/index.html no matter what
// scrub we run. The latch is derived once at init and survives clearBindUrl()
// in BindPage's mount.
//
// Reset triggers:
//  - Full document load re-imports this module and re-initializes the latch
//    (the OIDC exit paths — resolveBindNavigationUrl().replace — do this).
//  - BindPage unmount (SPA route exit without full reload) calls
//    resetBindEntry() so the layout doesn't keep re-rendering BindPage after
//    the flow ends.
let bindEntryActive = false

export function isBindEntry(): boolean {
  return bindEntryActive
}

/**
 * Clear the bind-entry latch and drop the captured URL snapshot. Called by
 * BindPage on unmount to end the "route to BindPage regardless of pathname"
 * override; BindPage's exit paths issue full-page reloads that would also
 * reset the module, but this makes SPA-only navigation safe as well.
 */
export function resetBindEntry(): void {
  bindEntryActive = false
  bindInitialSearch = ''
  bindInitialHref = ''
}

// Legacy alias used by unit tests; kept for compatibility with existing specs.
export const __resetBindEntryForTests = resetBindEntry

/**
 * Reduce the pre-scrub entry URL to origin + pathname so the bind token,
 * authcode, and other query params never live inside a React prop. Only
 * origin/pathname are consulted by resolveBindNavigationUrl (search is
 * overwritten by the target's search), so dropping the query loses nothing
 * downstream while stripping the credential retention path.
 */
function reduceInitialHref(href: string): string {
  try {
    const url = new URL(href)
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

export default class BindModule implements IModule {
  id(): string {
    return 'BindModule'
  }
  init(): void {
    // Assumption (PR #72 review yujiawei P2-3): the user arrives at /oidc/bind
    // via the backend's full-page 302 from the OIDC callback, so init() always
    // runs while window.location.search still has the bind params. If a future
    // path ever routes to /oidc/bind via SPA navigation (no full reload), init
    // won't fire again and the route factory will hand BindPage an empty
    // snapshot — falling cleanly to the "链接无效" fatal stage rather than
    // silently picking up stale params. Acceptable trade-off given the
    // documented flow.
    if (typeof window !== 'undefined') {
      const isElectronBindEntry =
        new URLSearchParams(window.location.search).get('__octo_route') === '/oidc/bind'
      if (window.location.pathname === '/oidc/bind' || isElectronBindEntry) {
        bindInitialSearch = window.location.search
        bindInitialHref = reduceInitialHref(window.location.href)
        bindEntryActive = true
        // Scrub the live URL *synchronously* here, before RouteManager's
        // pageshow handler runs window.history.pushState to add the sid URL
        // on top. If we wait for BindPage's useEffect, the current entry is
        // already the sid URL (see Route.tsx push()), and replaceState there
        // leaves the original `?token=...` entry behind in the Back stack —
        // pressing Back exposes the bind token via address bar / referrer.
        //
        // Use the path-preserving BIND_QUERY_KEYS strip: on Electron file://
        // Chromium throws SecurityError on any history.replaceState() that
        // changes the path, so the previous replaceState('/oidc/bind') was a
        // silent no-op — leaving the bind token in the packaged document URL
        // for the rest of the session. clearBindUrl edits only the search
        // and works uniformly on http(s) and file://.
        clearBindUrl()
      }
    }
    WKApp.route.register('/oidc/bind', (): JSX.Element => {
      return <BindPage initialSearch={bindInitialSearch} initialHref={bindInitialHref} />
    })
  }
}
