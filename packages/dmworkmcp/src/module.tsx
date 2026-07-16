import React from "react";
import type { IModule } from "@octo/base";
import { i18n, I18nProvider, WKApp, Menus, t as translate } from "@octo/base";
import { SkillListPage } from "@dmwork/skillmarket";
import McpMarketListPage from "./pages/McpMarketListPage";
import MarketSidebar from "./components/MarketSidebar";
import enUS from "./i18n/en-US.json";
import zhCN from "./i18n/zh-CN.json";
import "./index.css";

/**
 * NavRail 顶层菜单图标（MCP 市场）。与 dmworksummary / dmworktodo 的菜单图标同构：
 * 纯 SVG、随 active 变色，不引入额外依赖。图标语义：插件 / 拼装块（MCP = 可插拔工具）。
 */
function McpMarketIcon({ active }: { active?: boolean }) {
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
      <path d="M4 7h4V5a2 2 0 012-2h0a2 2 0 012 2v2h4a1 1 0 011 1v4h2a2 2 0 012 2v0a2 2 0 01-2 2h-2v3a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z" />
    </svg>
  );
}

export class McpMarketModule implements IModule {
  id(): string {
    return "McpMarketModule";
  }

  init(): void {
    i18n.registerNamespace("mcp", {
      "zh-CN": zhCN,
      "en-US": enUS,
    });

    // Left sidebar (renders in WKLayout.contentLeft when the "mcp-market"
    // NavRail entry is active). Its children — MCP 市场（未来还会追加 Skills
    // 市场等）— push their actual page into WKApp.routeRight, so the market
    // content lives in the right pane just like chat/summary detail views.
    WKApp.route.register("/mcp-market", () => {
      return <MarketSidebar />;
    });

    // Route mounted into WKLayout.contentRight by MarketSidebar / the menu's
    // onPress. Kept separate from the sidebar so future markets (Skills 市场,
    // …) can register additional /mcp-market/* routes without touching this
    // one.
    WKApp.route.register("/mcp-market/mcp", () => {
      return <McpMarketListPage />;
    });

    // Skills market tab — physically owned by @dmwork/skillmarket (i18n +
    // page live there), but mounted under the shared "/mcp-market" shell so
    // both markets share one NavRail entry + one sidebar. dmworkskillmarket's
    // module no longer registers its own NavRail icon; this route is the
    // single source of truth for the Skills market URL.
    WKApp.route.register("/mcp-market/skills", () => {
      return <SkillListPage />;
    });

    // 顶层 NavRail 菜单入口。sort=5003 紧跟在 summary(4002/5000) 之后，
    // 与既有 chat(1000)/contacts(4000) 图标栏共用同一注册机制
    // (WKApp.menus.register)，不新造导航体系。菜单 id "mcp-market" 与
    // McpMarketListPage 监听的 wk:nav-menu-activated(menuId==="mcp-market")
    // 保持一致；routePath 指向 /mcp-market 侧边栏路由。
    WKApp.menus.register(
      "mcp-market",
      () => {
        const m = new Menus(
          "mcp-market",
          "/mcp-market",
          translate("mcp.menu.title"),
          <McpMarketIcon />,
          <McpMarketIcon active />
        );
        // Point the right pane at the MCP market on click. Mirrors summary's
        // onPress (apps/web/src/App/index.tsx:154) — Main/index.tsx's default
        // click handler is bypassed when onPress is defined, so we own both
        // the left popToRoot and the right replaceToRoot here.
        m.onPress = () => {
          WKApp.routeLeft.popToRoot();
          const page = WKApp.route.get("/mcp-market/mcp");
          if (page && React.isValidElement(page)) {
            WKApp.routeRight.replaceToRoot(page);
          }
        };
        return m;
      },
      5003
    );
  }
}

// HMR: endpoints are keyed by id, so re-registration on reload overwrites
// rather than duplicates; no extra teardown needed here (mirrors the shape of
// dmworksummary's dispose hook).
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    /* no-op: registrations are idempotent by id */
  });
}
