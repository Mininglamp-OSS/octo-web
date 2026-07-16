import React from "react";
import WKApp from "../App";
import { EndpointCategory, EndpointID } from "./Const";
import { EndpointManager } from "./Module";
import { normalizeRoutePath } from "./RoutePath";
import { ensureSessionSid } from "./SessionScope";

export default class RouteManager {
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
    this.currentPath = normalizeRoutePath(window.location.pathname)
  }
  public static shared = new RouteManager()

  destroy() {
    window.removeEventListener('popstate', this.handlePopState);
    window.removeEventListener('pageshow', this.handlePageShow);
  }

  currentPath?:string // 当前路由path

  register(path: string, handler: (param: any) => JSX.Element| React.ElementType) {
    const routePath = normalizeRoutePath(path)
    EndpointManager.shared.setMethod(`${EndpointID.routePrefix}${routePath}`, (param) => {
      return handler(param);
    }, { category: EndpointCategory.routes });
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

  renderCurrentPath(path: string, param?: any) {
    const routePath = normalizeRoutePath(path)
    this.currentPath = routePath
    const component = EndpointManager.shared.invoke(`${EndpointID.routePrefix}${routePath}`, param)
    if (component) {
      WKApp.shared.restContent(component)
    }
  }

  push(path: string, param?: any) {
    const routePath = normalizeRoutePath(path)
    this.currentPath = routePath
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
