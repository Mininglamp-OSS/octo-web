import React from 'react'
import { WKApp, IModule } from '@octo/base'
import BindPage from './BindPage'

// 在 module init 时 (startup 同步阶段, 早于 RouteManager 的 pageshow handler)
// 抓住 location.search 快照. RouteManager 的 pageshow 监听器会 push 一个带
// sid= 的新 URL, 把 bind 入口参数 (token / authcode / return_to / provider)
// 一起冲掉; BindPage 再去读 window.location.search 就拿不到了.
//
// 这个 snapshot 在 BindModule.init() 调用瞬间 capture, 然后通过 prop 注入,
// 比 useEffect 里读 window.location.search 更早, 也更确定.
let bindInitialSearch = ''

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
    if (typeof window !== 'undefined' && window.location.pathname === '/oidc/bind') {
      bindInitialSearch = window.location.search
    }
    WKApp.route.register('/oidc/bind', (): JSX.Element => {
      return <BindPage initialSearch={bindInitialSearch} />
    })
  }
}
