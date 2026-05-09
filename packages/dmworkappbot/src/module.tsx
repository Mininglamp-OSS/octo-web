import React from "react"
import { IModule, WKApp, Menus } from "@octo/base"
import AppBotPage from "./AppBotPage"

const AppBotIcon: React.FC<{ active?: boolean }> = ({ active }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="3" width="8" height="8" rx="2" stroke={active ? "#5b6abf" : "#999"} strokeWidth={active ? "2" : "1.5"} fill={active ? "#5b6abf" : "none"} />
    <rect x="13" y="3" width="8" height="8" rx="2" stroke={active ? "#5b6abf" : "#999"} strokeWidth={active ? "2" : "1.5"} fill={active ? "#5b6abf" : "none"} />
    <rect x="3" y="13" width="8" height="8" rx="2" stroke={active ? "#5b6abf" : "#999"} strokeWidth={active ? "2" : "1.5"} fill={active ? "#5b6abf" : "none"} />
    <rect x="13" y="13" width="8" height="8" rx="2" stroke={active ? "#5b6abf" : "#999"} strokeWidth={active ? "2" : "1.5"} fill={active ? "#5b6abf" : "none"} />
  </svg>
)

/** Guard against double-init (HMR in dev or future module lifecycle changes). */
let _initialized = false

// Reset on HMR: tear down old listeners, reset init guard.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _initialized = false
  })
}

export default class AppBotModule implements IModule {
  id(): string {
    return "AppBotModule"
  }

  init(): void {
    if (_initialized) return
    _initialized = true

    // Register route
    WKApp.route.register("/appbot", () => <AppBotPage />)

    // Register NavRail menu item (sort=3000, between chat=1000 and contacts=4000)
    WKApp.menus.register(
      "appbot",
      () => {
        const m = new Menus(
          "appbot",
          "/appbot",
          "应用",
          <AppBotIcon />,
          <AppBotIcon active />,
        )
        return m
      },
      3000,
    )
  }
}
