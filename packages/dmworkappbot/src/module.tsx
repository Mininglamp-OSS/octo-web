import React from "react";
import { IModule, WKApp, Menus, i18n, t } from "@octo/base";
import AppBotPage from "./AppBotPage";
import enUS from "./i18n/en-US.json";
import zhCN from "./i18n/zh-CN.json";

const AppBotIcon: React.FC<{ active?: boolean }> = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    xmlns="http://www.w3.org/2000/svg"
  >
    <g transform="translate(1.66665 1.66665)" fill="currentColor">
      <path d="M2.5 0C1.11929 0 0 1.11929 0 2.5V5C0 6.38071 1.11929 7.5 2.5 7.5H5C6.38071 7.5 7.5 6.38071 7.5 5V2.5C7.5 1.11929 6.38071 0 5 0H2.5Z" />
      <path d="M2.5 9.16667C1.11929 9.16667 0 10.286 0 11.6667V14.1667C0 15.5474 1.11929 16.6667 2.5 16.6667H5C6.38071 16.6667 7.5 15.5474 7.5 14.1667V11.6667C7.5 10.286 6.38071 9.16667 5 9.16667H2.5Z" />
      <path d="M9.16667 11.6667C9.16667 10.286 10.286 9.16667 11.6667 9.16667H14.1667C15.5474 9.16667 16.6667 10.286 16.6667 11.6667V14.1667C16.6667 15.5474 15.5474 16.6667 14.1667 16.6667H11.6667C10.286 16.6667 9.16667 15.5474 9.16667 14.1667V11.6667Z" />
      <path fillRule="evenodd" clipRule="evenodd" d="M10.8333 0C9.91286 0 9.16667 0.746192 9.16667 1.66667V5.83333C9.16667 6.75381 9.91286 7.5 10.8333 7.5H15C15.9205 7.5 16.6667 6.75381 16.6667 5.83333V1.66667C16.6667 0.746192 15.9205 0 15 0H10.8333ZM10.8333 1.66667H15V5.83333H10.8333V1.66667Z" />
    </g>
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
