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
    render: () => <ExpertMarketListPage />,
  },
];

interface MarketSidebarState {
  activeId: string;
}

function findMarketItemByRoutePath(path?: string): MarketItem | undefined {
  if (!path) return undefined;
  return MARKET_ITEMS.find((item) => item.routePath === path);
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
    // appconfig is fetched asynchronously, so at mount dmloopOn is usually
    // still its default false. Re-render when the first load resolves
    // (addListener) and on any later ops flip (addConfigChangeListener) so
    // the 回路 badge appears or disappears the moment the flag does.
    // Mirrors DriveModule / DocsModule.
    const rc = WKApp.remoteConfig;
    if (rc) {
      const rerender = () => this.forceUpdate();
      if (!rc.requestSuccess) this.configUnsubscribers.push(rc.addListener(rerender));
      this.configUnsubscribers.push(rc.addConfigChangeListener(rerender));
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
    return (
      findMarketItemByRoutePath(WKApp.route.currentPath) ??
      findMarketItemByRoutePath(window.location.pathname) ??
      MARKET_ITEMS.find((item) => item.id === this.state.activeId) ??
      MARKET_ITEMS[0]
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
      MARKET_ITEMS[0];
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
          {MARKET_ITEMS.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                data-testid="market-sidebar-item"
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
