import React from "react";
import type { IModule } from "@octo/base";
import { ChatPage, i18n, I18nProvider, WKApp, Menus, t as translate, Dap } from "@octo/base";
import { SkillListPage } from "@dmwork/skillmarket";
import McpMarketListPage from "./pages/McpMarketListPage";
import MyAssetsPage from "./pages/MyAssetsPage";
import ExpertMarketListPage from "./pages/ExpertMarketListPage";
import MarketSidebar from "./components/MarketSidebar";
import enUS from "./i18n/en-US.json";
import zhCN from "./i18n/zh-CN.json";
import "./index.css";

/**
 * NavRail 顶层菜单图标（MCP 市场）。与 dmworksummary 的菜单图标同构：
 * 纯 SVG、随 active 变色，不引入额外依赖。图标语义：插件 / 拼装块（MCP = 可插拔工具）。
 */
function McpMarketIcon(_props: { active?: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M15.5221 1.99993C15.9763 1.99989 16.4133 2.17371 16.7434 2.48571C17.0735 2.79771 17.2716 3.22422 17.2972 3.67772L17.9972 16.1223C18.0108 16.3638 17.975 16.6055 17.8919 16.8326C17.8089 17.0598 17.6804 17.2676 17.5143 17.4434C17.3481 17.6192 17.1479 17.7592 16.9258 17.8549C16.7037 17.9506 16.4644 18 16.2225 18.0001H3.77794C3.53604 18.0001 3.29669 17.9507 3.07452 17.8551C2.85236 17.7594 2.65206 17.6193 2.48588 17.4436C2.31971 17.2678 2.19116 17.0599 2.10809 16.8327C2.02503 16.6055 1.98921 16.3638 2.00281 16.1223L2.70327 3.67772C2.72882 3.22422 2.92698 2.79771 3.25708 2.48571C3.58718 2.17371 4.02418 1.99989 4.47839 1.99993H15.5221ZM13.5558 4.66662C13.4028 4.6667 13.2524 4.70629 13.1191 4.78155C12.9859 4.8568 12.8743 4.96518 12.7953 5.0962C12.7162 5.22721 12.6723 5.37642 12.6678 5.52937C12.6633 5.68233 12.6983 5.83386 12.7696 5.9693C12.2438 7.15197 11.2531 7.7782 10.0002 7.7782C8.73932 7.7782 7.75265 7.15597 7.23042 5.97107C7.30978 5.82094 7.34447 5.65122 7.33039 5.48199C7.31631 5.31275 7.25405 5.1511 7.15098 5.01614C7.04791 4.88118 6.90833 4.77858 6.74877 4.72046C6.58921 4.66234 6.41634 4.65114 6.25061 4.6882C6.08489 4.72525 5.93324 4.80899 5.81362 4.92953C5.694 5.05006 5.61141 5.20234 5.57562 5.36834C5.53983 5.53434 5.55234 5.70712 5.61167 5.86624C5.671 6.02535 5.77467 6.16414 5.91041 6.26619C6.60819 8.08665 8.12465 9.1111 10.0002 9.1111C11.8678 9.1111 13.3878 8.08176 14.0891 6.26663C14.2384 6.15469 14.3486 5.99863 14.4043 5.82055C14.4599 5.64248 14.4581 5.45141 14.3991 5.27442C14.3401 5.09743 14.2269 4.94349 14.0756 4.8344C13.9242 4.72532 13.7424 4.66662 13.5558 4.66662Z" fill="currentColor" />
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

    // The three `/mcp-market*` routes are sidebar-level (opened inside the
    // Main shell), NOT full pages. Two distinct callers hit these handlers:
    //   • MainContentLeft (apps/web/src/Pages/Main/index.tsx:28) reads via
    //     `WKApp.route.get(routePath)` to mount the sidebar panel — wants
    //     the raw sidebar / page component below.
    //   • RouteManager.renderCurrentPath (dmworkbase Service/Route.tsx) fires
    //     on cold-load / bfcache pageshow / back-forward — before PR#851's
    //     fix it also used the same handler, so refreshing /mcp-market/*
    //     collapsed the whole host to a bare sidebar (no NavRail, no shell).
    //
    // The `hostShell` opt-in on register() tells RouteManager: for URL-driven
    // renders, mount <ChatPage /> (the full Main shell) instead, and let the
    // shell's syncMenuFromBrowserPath activate the correct NavRail entry from
    // the URL, which triggers the `mcp-market` menu.onPress below to mount
    // the sidebar + right-pane page. See dmworkbase Service/Route.tsx for the
    // RouteRegisterOptions comment and the two-code-path map.
    const marketHostShell = () => <ChatPage />;

    // Left sidebar (renders in WKLayout.contentLeft when the "mcp-market"
    // NavRail entry is active). Its children — MCP 市场（未来还会追加 Skills
    // 市场等）— push their actual page into WKApp.routeRight, so the market
    // content lives in the right pane just like chat/summary detail views.
    WKApp.route.register("/mcp-market", () => <MarketSidebar />, { hostShell: marketHostShell });

    // Route mounted into WKLayout.contentRight by MarketSidebar / the menu's
    // onPress. Kept separate from the sidebar so future markets (Skills 市场,
    // …) can register additional /mcp-market/* routes without touching this
    // one.
    WKApp.route.register("/mcp-market/mcp", () => <McpMarketListPage />, { hostShell: marketHostShell });

    // Skills market tab — physically owned by @dmwork/skillmarket (i18n +
    // page live there), but mounted under the shared "/mcp-market" shell so
    // both markets share one NavRail entry + one sidebar. dmworkskillmarket's
    // module no longer registers its own NavRail icon; this route is the
    // single source of truth for the Skills market URL.
    WKApp.route.register("/mcp-market/skills", () => <SkillListPage />, { hostShell: marketHostShell });

    // Expert market tab — squads & single experts. Same static-first shell as
    // the other markets: an additional /mcp-market/* route + a MarketSidebar
    // entry, no new NavRail icon. Ungated like the MCP / Skills tabs: its
    // /market/api/v1/experts|squads backend (octo-marketplace#51) is merged
    // and deployed, and the /market/api/v1 nginx location fail-louds (503)
    // when the marketplace is absent. See src/pages/ExpertMarketListPage.tsx.
    WKApp.route.register("/mcp-market/experts", () => <ExpertMarketListPage />, { hostShell: marketHostShell });

    // 我的 (personal assets) — the sidebar's fourth entry. One page hosting
    // skills / experts / connectors in their variant="mine" mode under type
    // sub-tabs, so personal assets live in one place instead of a per-market
    // tab. Same shared "/mcp-market" shell as the three discovery markets.
    WKApp.route.register("/mcp-market/mine", () => <MyAssetsPage />, { hostShell: marketHostShell });

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
        // Point the right pane at the MCP market on click.
        // onPress (apps/web/src/App/index.tsx:154) — Main/index.tsx's default
        // click handler is bypassed when onPress is defined, so we own both
        // the left popToRoot and the right replaceToRoot here.
        m.onPress = (reentry?: boolean) => {
          // 重复点击已激活的市场菜单不计 module_entered(见二审 P2-4);宿主按 prevMenuId===id 传 reentry。
          if (!reentry) {
            Dap.shared.track("market_module_entered", {});
          }
          WKApp.routeLeft.popToRoot();
          const page = WKApp.route.get("/mcp-market/mcp");
          if (page && React.isValidElement(page)) {
            WKApp.routeRight.replaceToRoot(page);
          }
          // Sync URL so refresh/copy-link/back button land on the same tab.
          // Main/index.tsx#onMenuClick already syncPath's to the menu's
          // `/mcp-market` before firing onPress, but the mounted pane is the
          // more specific MCP landing route — reflect that.
          WKApp.route.syncPath("/mcp-market/mcp");
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
