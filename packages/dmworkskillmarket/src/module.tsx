import React from "react";
import { Blocks } from "lucide-react";
import type { IModule } from "@octo/base";
import { i18n, Menus, t as translate, WKApp } from "@octo/base";
import SkillMarketSidebar from "./components/SkillMarketSidebar";
import SkillListPage from "./pages/SkillListPage";
import MyCreatedPage from "./pages/MyCreatedPage";
import enUS from "./i18n/en-US.json";
import zhCN from "./i18n/zh-CN.json";
import "./index.css";

function SkillMarketIcon({ active }: { active?: boolean }) {
  return (
    <Blocks
      size={22}
      strokeWidth={2}
      color={active ? "var(--wk-brand-primary, #1C1C23)" : "currentColor"}
    />
  );
}

export class SkillMarketModule implements IModule {
  id(): string {
    return "SkillMarketModule";
  }

  init(): void {
    i18n.registerNamespace("skillMarket", {
      "zh-CN": zhCN,
      "en-US": enUS,
    });

    WKApp.route.register("/skill-market", () => <SkillMarketSidebar />);
    WKApp.route.register("/skill-market/skills", () => <SkillListPage />);
    WKApp.route.register("/skill-market/mine", () => <MyCreatedPage />);

    WKApp.menus.register(
      "skill-market",
      () => {
        const menu = new Menus(
          "skill-market",
          "/skill-market",
          translate("skillMarket.menu.title"),
          <SkillMarketIcon />,
          <SkillMarketIcon active />,
        );
        menu.onPress = () => {
          WKApp.routeLeft.popToRoot();
          WKApp.routeRight.replaceToRoot(<SkillListPage />);
        };
        return menu;
      },
      5004,
    );
  }
}

const hot = (import.meta as ImportMeta & { hot?: { dispose: (callback: () => void) => void } }).hot;

if (hot) {
  hot.dispose(() => {
    /* menu and route registration are id-keyed in the host app */
  });
}
