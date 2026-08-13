import React, { Component } from "react";
import { I18nContext, t, WKApp } from "@octo/base";
import { SkillListPage } from "@dmwork/skillmarket";
import McpMarketListPage from "../pages/McpMarketListPage";
import ExpertMarketListPage from "../pages/ExpertMarketListPage";

interface MarketItem {
  id: string;
  routePath: string;
  label: () => string;
  /** Optional pill shown to the right of the label (e.g. "回路" on experts,
   *  signalling the catalog feeds the Loop module). */
  badge?: () => string;
  render: () => React.ReactElement;
}

// Order below controls the sidebar tab order. Keep MCP first — it's the
// original tenant of "/mcp-market" and the NavRail's onPress boots into it.
// Skills was folded in from the standalone /skill-market module (which now
// only registers i18n + this page) so users see a single "市场" entry with
// two tabs, not two navrail icons.
const MARKET_ITEMS: MarketItem[] = [
  {
    id: "mcp",
    routePath: "/mcp-market/mcp",
    label: () => t("mcp.sidebar.mcp"),
    render: () => <McpMarketListPage />,
  },
  {
    id: "skills",
    routePath: "/mcp-market/skills",
    label: () => t("mcp.sidebar.skills"),
    render: () => <SkillListPage />,
  },
  {
    id: "experts",
    routePath: "/mcp-market/experts",
    label: () => t("mcp.sidebar.experts"),
    badge: () => t("mcp.sidebar.expertsBadge"),
    // Defence in depth: every path to render() goes through visibleMarketItems()
    // today, but the gate must not depend on that staying true — a future caller
    // reaching this item directly must still get the fallback, not the gated page.
    render: () =>
      WKApp.remoteConfig?.expertMarketOn ? <ExpertMarketListPage /> : <McpMarketListPage />,
  },
];

// The experts entry is display-gated on expert_market_on (fail-safe, default
// false): its /market/api/v1/experts backend (octo-marketplace#51) may not be
// deployed in an environment tracking marketplace main, and an ungated tab
// would 404 on its first request. Mirrors the docs_on / dmloop_on / drive_on
// convention (dmworkbase App.tsx) — pure display gate, no auth semantics.
function visibleMarketItems(): MarketItem[] {
  return WKApp.remoteConfig?.expertMarketOn
    ? MARKET_ITEMS
    : MARKET_ITEMS.filter((item) => item.id !== "experts");
}

interface MarketSidebarState {
  activeId: string;
}

function findMarketItemByRoutePath(path?: string): MarketItem | undefined {
  if (!path) return undefined;
  return visibleMarketItems().find((item) => item.routePath === path);
}

/**
 * "Markets" sidebar rendered in WKLayout.contentLeft when the mcp-market
 * NavRail entry is active. Users click items to switch which market page
 * is mounted in WKLayout.contentRight (via WKApp.routeRight.replaceToRoot).
 *
 * The initial right-pane content is pushed by the NavRail menu's onPress
 * (see module.tsx) — this component only reacts to sidebar clicks, so we
 * don't double-mount the page on activation. activeId is seeded to the
 * first item to match that initial push.
 */
export default class MarketSidebar extends Component<{}, MarketSidebarState> {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  state: MarketSidebarState = {
    activeId:
      findMarketItemByRoutePath(WKApp.route.currentPath)?.id ??
      findMarketItemByRoutePath(window.location.pathname)?.id ??
      MARKET_ITEMS[0].id,
  };

  private configUnsubscribers: Array<() => void> = [];

  componentDidMount() {
    WKApp.mittBus.on("space-changed", this.handleSpaceChanged);
    WKApp.mittBus.on("wk:nav-menu-activated", this.handleNavMenuActivated);
    // appconfig is fetched asynchronously, so at mount expertMarketOn /
    // dmloopOn are usually still their default false. Re-render when the first
    // load resolves (addListener) and on any later ops flip
    // (addConfigChangeListener) so the experts entry and the 回路 badge appear
    // or disappear the moment the flags do. Mirrors DriveModule / DocsModule.
    // Re-rendering the sidebar alone is not enough: the RIGHT PANE was mounted
    // from the pre-flip item set (e.g. a hard refresh on /mcp-market/experts
    // mounted the MCP fallback before the flag resolved true, or an ops
    // kill-switch flipped it false while the expert page is open and calling
    // the now-disabled backend). Reconcile it against the current visible item
    // whenever this market is the active menu — the same pairing DriveModule
    // does with WKApp.menus.refresh().
    const rc = WKApp.remoteConfig;
    if (rc) {
      const reconcile = () => {
        // Sync the highlighted entry and the mounted pane to the post-flip
        // item set (a stale activeId like "experts" after a kill-switch flip
        // falls back through currentItem() to the first visible item).
        const item = this.currentItem();
        if (item.id !== this.state.activeId) {
          this.setState({ activeId: item.id });
        } else {
          this.forceUpdate();
        }
        if (WKApp.currentMenuId === "mcp-market") {
          this.replaceRightPane(item);
        }
      };
      if (!rc.requestSuccess) this.configUnsubscribers.push(rc.addListener(reconcile));
      this.configUnsubscribers.push(rc.addConfigChangeListener(reconcile));
    }
    if (WKApp.currentMenuId === "mcp-market") {
      this.replaceRightPane(this.currentItem());
    }
  }

  componentWillUnmount() {
    WKApp.mittBus.off("space-changed", this.handleSpaceChanged);
    WKApp.mittBus.off("wk:nav-menu-activated", this.handleNavMenuActivated);
    for (const unsub of this.configUnsubscribers) unsub();
    this.configUnsubscribers = [];
  }

  private currentItem = () => {
    const visible = visibleMarketItems();
    return (
      findMarketItemByRoutePath(WKApp.route.currentPath) ??
      findMarketItemByRoutePath(window.location.pathname) ??
      visible.find((item) => item.id === this.state.activeId) ??
      visible[0]
    );
  };

  private replaceRightPane = (item: MarketItem) => {
    try {
      WKApp.routeRight.replaceToRoot(item.render());
    } catch {
      window.setTimeout(() => {
        try {
          WKApp.routeRight.replaceToRoot(item.render());
        } catch (retryError) {
          console.error("[mcp-market] failed to mount right pane", retryError);
        }
      }, 0);
    }
  };

  private handleClick = (item: MarketItem) => {
    if (item.id !== this.state.activeId) {
      this.setState({ activeId: item.id });
    }
    this.replaceRightPane(item);
    // Sync the URL so refresh/copy-link/back button land on this tab
    // rather than whatever stale path was in the address bar before.
    WKApp.route.syncPath(item.routePath);
  };

  private handleSpaceChanged = () => {
    if (WKApp.currentMenuId !== "mcp-market") return;
    this.replaceRightPane(this.currentItem());
  };

  private handleNavMenuActivated = ({ menuId }: { menuId: string }) => {
    if (menuId !== "mcp-market") return;
    // Main first activates the top-level `/mcp-market` route, then the menu's
    // onPress redirects the right pane to MCP. Do not reuse a stale Skills
    // state during that short interval: the top-level entry always defaults
    // to MCP, while explicit deep links keep their matching item.
    const item =
      findMarketItemByRoutePath(WKApp.route.currentPath) ??
      findMarketItemByRoutePath(window.location.pathname) ??
      visibleMarketItems()[0];
    if (item.id !== this.state.activeId) {
      this.setState({ activeId: item.id });
    }
  };

  render() {
    const { activeId } = this.state;
    return (
      <div className="wk-mcp-sidebar">
        <div className="wk-mcp-sidebar__header">
          {t("mcp.sidebar.header")}
        </div>
        <ul className="wk-mcp-sidebar__list">
          {visibleMarketItems().map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={
                  item.id === activeId
                    ? "wk-mcp-sidebar__item wk-mcp-sidebar__item--active"
                    : "wk-mcp-sidebar__item"
                }
                onClick={() => this.handleClick(item)}
              >
                <span className="wk-mcp-sidebar__item-label">{item.label()}</span>
                {item.badge && WKApp.remoteConfig?.dmloopOn && (
                  <span className="wk-mcp-sidebar__badge">{item.badge()}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
}
