import React from "react";
import { WKApp, Menus, i18n, t as translate } from "@octo/base";
import type { IModule } from "@octo/base";
import LoopPage from "./pages/LoopPage";
import LoopCliAuthorizePage from "./pages/LoopCliAuthorizePage";
import {
  isLoopCliAuthorizePath,
  LOOP_CLI_AUTHORIZE_PATH,
  resolveLoopCliAuthorizeSearch,
  visibleLoopCliAuthorizeSearch,
} from "./cliAuthorizeSession";
import enUS from "./i18n/en-US.json";
import zhCN from "./i18n/zh-CN.json";

let _initialized = false;
let loopCliAuthorizeInitialSearch = "";
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _initialized = false;
  });
}

function LoopIcon({ active }: { active?: boolean }) {
  const color = active ? "var(--wk-brand-primary, #7C5CFC)" : "currentColor";
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11v-1a4 4 0 014-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v1a4 4 0 01-4 4H3" />
    </svg>
  );
}

/** LoopModule — Loop 一级 Panel（二级菜单：Issue/Skill/Project/Agent/Squad）。 */
export default class LoopModule implements IModule {
  id(): string {
    return "LoopModule";
  }

  init(): void {
    if (_initialized) return;
    _initialized = true;

    i18n.registerNamespace("loop", {
      "zh-CN": zhCN,
      "en-US": enUS,
    });

    if (
      typeof window !== "undefined" &&
      isLoopCliAuthorizePath(window.location.pathname)
    ) {
      loopCliAuthorizeInitialSearch = resolveLoopCliAuthorizeSearch(
        window.location.pathname,
        window.location.search,
        window.sessionStorage
      );

      // RouteManager keeps only `sid` on pageshow. Capture the callback above,
      // then remove it from the address bar before it can remain in history.
      if (new URLSearchParams(window.location.search).get("cli_callback")) {
        try {
          window.history.replaceState(
            {},
            "",
            window.location.pathname +
              visibleLoopCliAuthorizeSearch(window.location.search)
          );
        } catch {
          // The captured prop still protects the flow if History is unavailable.
        }
      }
    }

    WKApp.route.register("/loop", () => <LoopPage />);
    const renderLoopCliAuthorize = () => (
      <LoopCliAuthorizePage
        initialSearch={loopCliAuthorizeInitialSearch}
      />
    );
    WKApp.route.register(LOOP_CLI_AUTHORIZE_PATH, renderLoopCliAuthorize);
    WKApp.route.register(
      `${LOOP_CLI_AUTHORIZE_PATH}/`,
      renderLoopCliAuthorize
    );

    WKApp.menus.register(
      "loop",
      () => {
        return new Menus(
          "loop",
          "/loop",
          translate("loop.menu.title"),
          <LoopIcon />,
          <LoopIcon active />
        );
      },
      4003
    );
  }
}
