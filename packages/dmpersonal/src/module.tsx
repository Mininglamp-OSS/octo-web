import React from "react";
import { WKApp, Menus, i18n, t as translate } from "@octo/base";
import type { IModule } from "@octo/base";
import PersonalPage from "./PersonalPage";
import enUS from "./i18n/en-US.json";
import zhCN from "./i18n/zh-CN.json";

let _initialized = false;
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    _initialized = false;
  });
}

function PersonalIcon({ active }: { active?: boolean }) {
  const color = active ? "var(--wk-brand-primary)" : "currentColor";

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
      <path d="M16 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2" />
      <circle cx="9.5" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

export default class PersonalModule implements IModule {
  id(): string {
    return "DMPersonalModule";
  }

  init(): void {
    if (_initialized) return;
    _initialized = true;

    i18n.registerNamespace("personal", {
      "zh-CN": zhCN,
      "en-US": enUS,
    });

    WKApp.route.register("/personal", () => <PersonalPage />);

    WKApp.menus.register(
      "dmpersonal",
      () => new Menus(
        "dmpersonal",
        "/personal",
        translate("personal.menu.title"),
        <PersonalIcon />,
        <PersonalIcon active />,
      ),
      4004,
    );
  }
}
