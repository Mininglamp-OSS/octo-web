import React from "react";
import { WKApp, Menus, i18n, t as translate } from "@octo/base";
import type { IModule } from "@octo/base";
import LoopPage from "./pages/LoopPage";
import MulticaCliAuthorizePage from "./pages/MulticaCliAuthorizePage";
import enUS from "./i18n/en-US.json";
import zhCN from "./i18n/zh-CN.json";

let _initialized = false;
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

    WKApp.route.register("/loop", () => <LoopPage />);
    // TODO(octo-multica): adjust this path after the Octo Web product route is finalized.
    WKApp.route.register("/loop/multica/cli-authorize", () => (
      <MulticaCliAuthorizePage />
    ));

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
