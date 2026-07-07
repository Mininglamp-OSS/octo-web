import React from "react";
import { WKApp, Menus, i18n, t as translate } from "@octo/base";
import type { IModule } from "@octo/base";
import RuntimePage from "./pages/RuntimePage";
import enUS from "./i18n/en-US.json";
import zhCN from "./i18n/zh-CN.json";

let _initialized = false;
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _initialized = false;
  });
}

function RuntimeIcon({ active }: { active?: boolean }) {
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
      <rect x="4" y="4" width="16" height="12" rx="2" />
      <path d="M2 20h20" />
      <path d="M8 20v-4M16 20v-4" />
    </svg>
  );
}

/** RuntimeModule — Loop 设备/Runtime 一级 Panel（只读展示）。 */
export default class RuntimeModule implements IModule {
  id(): string {
    return "RuntimeModule";
  }

  init(): void {
    if (_initialized) return;
    _initialized = true;

    i18n.registerNamespace("runtime", {
      "zh-CN": zhCN,
      "en-US": enUS,
    });

    WKApp.route.register("/runtime", () => <RuntimePage />);

    WKApp.menus.register(
      "runtime",
      () => {
        return new Menus(
          "runtime",
          "/runtime",
          translate("runtime.menu.title"),
          <RuntimeIcon />,
          <RuntimeIcon active />,
        );
      },
      4002,
    );
  }
}
