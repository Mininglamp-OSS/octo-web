import React from "react";
import { IModule, WKApp, Menus, i18n, t } from "@octo/base";
import AppBotPage from "./AppBotPage";
import enUS from "./i18n/en-US.json";
import zhCN from "./i18n/zh-CN.json";

const AppBotIcon: React.FC<{ active?: boolean }> = ({ active }) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect
      x="3"
      y="3"
      width="8"
      height="8"
      rx="2"
      stroke="currentColor"
      strokeWidth={active ? "2" : "1.5"}
      fill={active ? "currentColor" : "none"}
    />
    <rect
      x="13"
      y="3"
      width="8"
      height="8"
      rx="2"
      stroke="currentColor"
      strokeWidth={active ? "2" : "1.5"}
      fill={active ? "currentColor" : "none"}
    />
    <rect
      x="3"
      y="13"
      width="8"
      height="8"
      rx="2"
      stroke="currentColor"
      strokeWidth={active ? "2" : "1.5"}
      fill={active ? "currentColor" : "none"}
    />
    <rect
      x="13"
      y="13"
      width="8"
      height="8"
      rx="2"
      stroke="currentColor"
      strokeWidth={active ? "2" : "1.5"}
      fill={active ? "currentColor" : "none"}
    />
  </svg>
);

/** Guard against double-init (HMR in dev or future module lifecycle changes). */
let _initialized = false;

// Reset on HMR: tear down old listeners, reset init guard.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _initialized = false;
  });
}

export default class AppBotModule implements IModule {
  id(): string {
    return "AppBotModule";
  }

  init(): void {
    if (_initialized) return;
    _initialized = true;

    i18n.registerNamespace("appbot", {
      "zh-CN": zhCN,
      "en-US": enUS,
    });

    // Register route
    WKApp.route.register("/appbot", () => <AppBotPage />);

    // Register NavRail menu item (sort=6000, at the bottom)
    WKApp.menus.register(
      "appbot",
      () => {
        const m = new Menus(
          "appbot",
          "/appbot",
          t("appbot.menu.title"),
          <AppBotIcon />,
          <AppBotIcon active />
        );
        return m;
      },
      6000
    );
  }
}
