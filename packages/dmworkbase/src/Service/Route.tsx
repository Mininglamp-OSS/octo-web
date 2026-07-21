import React from "react";
import WKApp from "../App";
import { EndpointCategory, EndpointID } from "./Const";
import { EndpointManager } from "./Module";
import { normalizeRoutePath } from "./RoutePath";
import { ensureSessionSid, stripSessionSidFromUrl } from "./SessionScope";

/**
 * Options for `RouteManager.register`. Kept optional so every existing
 * `register(path, handler)` call site (upstream `/`, `/contacts`, and
 * every summary/todo/… module) keeps its old semantics with no change.
 *
 * `hostShell` is the opt-in escape hatch that fixes the "refresh a
 * sidebar-level URL and the whole page collapses to a bare sidebar"
 * regression (PR#851 review 🔴, dmworkmcp `/mcp-market*`). See the
 * `renderCurrentPath` comment below for the full story. When set,
 * `renderCurrentPath` mounts the shell into host content and lets the
 * shell's own URL-driven code (`syncMenuFromBrowserPath`) re-derive the
 * active NavRail entry and right-pane — so refresh/back/copy-link land
 * on the intended page with sidebar and NavRail intact. `handler(param)`
 * is still used verbatim by `MainContentLeft` (via `route.get`) for the
 * in-shell sidebar mount, so the two contexts get the component they
 * each want without conflict.
 */
export interface RouteRegisterOptions {
  hostShell?: () => JSX.Element;
}

export default class RouteManager {
  // Per-path host-shell factories registered with `register(..., { hostShell })`.
  // Absent path → path is not shell-scoped → renderCurrentPath falls back to
  // the pre-fix behaviour (restContent(handlerResult)).
  private hostShells: Map<string, () => JSX.Element> = new Map();

  private handlePopState = () => {
    RouteManager.shared.renderCurrentPath(window.location.pathname)
  }

  private handlePageShow = () => {
    RouteManager.shared.renderCurrentPath(window.location.pathname)
  }

  private constructor() {
    window.addEventListener('popstate', this.handlePopState);
    window.addEventListener('pageshow', this.handlePageShow);
    ensureSessionSid()
    // Scrub the initial `?sid=` off the address bar (and browser history)
    // now that the session id is cached in sessionStorage. Otherwise the
    // sid lingers in Referer headers and back-stack — this restores the
    // pre-consolidation behaviour that the boot sequence used to enforce
    // in apps/web/src/index.tsx.
    stripSessionSidFromUrl()
    this.currentPath = normalizeRoutePath(window.location.pathname)
  }
  public static shared = new RouteManager()

  destroy() {
    window.removeEventListener('popstate', this.handlePopState);
    window.removeEventListener('pageshow', this.handlePageShow);
  }

  currentPath?:string // 当前路由path

  register(
    path: string,
    handler: (param: any) => JSX.Element | React.ElementType,
    options?: RouteRegisterOptions,
  ) {
    const routePath = normalizeRoutePath(path)
    EndpointManager.shared.setMethod(`${EndpointID.routePrefix}${routePath}`, (param) => {
      return handler(param);
    }, { category: EndpointCategory.routes });
    if (options?.hostShell) {
      this.hostShells.set(routePath, options.hostShell);
    } else {
      // Unregister any previously-declared shell so a caller re-registering
      // without `hostShell` returns to the plain-host behaviour.
      this.hostShells.delete(routePath);
    }
  }

  get(path: string, param?: any): JSX.Element| React.ElementType {
    const routePath = normalizeRoutePath(path)
    const component = EndpointManager.shared.invoke(`${EndpointID.routePrefix}${routePath}`, param)
    return component
  }

  syncPath(path: string, mode: "push" | "replace" = "push") {
    const routePath = normalizeRoutePath(path)
    this.currentPath = routePath

    const currentUrl = window.location.pathname + window.location.search
    if (currentUrl === routePath) return

    if (mode === "replace") {
      window.history.replaceState({}, "title", routePath)
      return
    }
    window.history.pushState({}, "title", routePath)
  }

  /**
   * Compute what to render into host content for the given URL. Fired on
   * cold-load / bfcache pageshow (via `handlePageShow`) and on
   * back/forward (`handlePopState`) — the two entry points where the
   * only thing that changed is the URL, not any in-app action.
   *
   * Two paths:
   *   1) Path has a `hostShell` opted in at register time → mount the
   *      shell into host content. The shell's own URL-driven logic
   *      (ChatPage → syncMenuFromBrowserPath → NavRail menu.onPress)
   *      then re-derives the active menu + sidebar + right pane from
   *      the URL. This is the fix for `/mcp-market*` (and any future
   *      sidebar-level route) collapsing the whole page to a bare
   *      sidebar on refresh (PR#851 review 🔴).
   *   2) No hostShell → old behaviour verbatim: the handler's output
   *      becomes the whole host. Kept so upstream `/` (registered as
   *      ChatPage) and any legacy standalone routes (e.g. login-only
   *      pages, /d/:docId cold-loads) are byte-identical to before.
   */
  renderCurrentPath(path: string, param?: any) {
    const routePath = normalizeRoutePath(path)
    this.currentPath = routePath
    const shell = this.hostShells.get(routePath);
    if (shell) {
      WKApp.shared.restContent(shell());
      return;
    }
    const component = EndpointManager.shared.invoke(`${EndpointID.routePrefix}${routePath}`, param)
    if (component) {
      WKApp.shared.restContent(component)
    }
  }

  push(path: string, param?: any) {
    const routePath = normalizeRoutePath(path)
    this.currentPath = routePath
    const shell = this.hostShells.get(routePath);
    if (shell) {
      // Same push URL semantics as before, but ensure a URL-driven
      // navigation into a shell-scoped route mounts the shell (not the
      // raw sidebar). Consumers that specifically want the sidebar
      // component in the current shell should call `WKApp.route.get(path)`
      // + `WKApp.routeLeft.replaceToRoot(...)` themselves.
      const url = new URL(routePath, window.location.origin)
      const nextUrl = url.pathname + url.search
      const currentUrl = window.location.pathname + window.location.search
      if (currentUrl !== nextUrl) {
        window.history.pushState({}, "title", nextUrl)
      }
      WKApp.shared.restContent(shell())
      return;
    }
    const component = EndpointManager.shared.invoke(`${EndpointID.routePrefix}${routePath}`, param)
    if (component) {
      const url = new URL(routePath, window.location.origin)
      const nextUrl = url.pathname + url.search
      const currentUrl = window.location.pathname + window.location.search
      if (currentUrl !== nextUrl) {
        window.history.pushState({}, "title", nextUrl)
      }
      WKApp.shared.restContent(component)
    }
  }
}

export class ContextRouteManager {
  setPush!:(view:JSX.Element)=>void
  setReplaceToRoot!:(view:JSX.Element)=>void
  setPop!:()=>void
  setPopToRoot!:()=>void

  push(view:JSX.Element) {
    this.setPush(view)
  }

  replaceToRoot(view: JSX.Element): void {
    this.setReplaceToRoot(view)
  }

  pop() {
    this.setPop()
  }

  popToRoot() {
    this.setPopToRoot()
  }
}
