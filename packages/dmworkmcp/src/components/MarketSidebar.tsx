import React, { Component } from "react";
import { I18nContext, t, WKApp } from "@octo/base";
import { SkillListPage } from "@dmwork/skillmarket";
import McpMarketListPage from "../pages/McpMarketListPage";

interface MarketItem {
  id: string;
  routePath: string;
  label: () => string;
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

  componentDidMount() {
    WKApp.mittBus.on("space-changed", this.handleSpaceChanged);
    WKApp.mittBus.on("wk:nav-menu-activated", this.handleNavMenuActivated);
    if (WKApp.currentMenuId === "mcp-market") {
      this.replaceRightPane(this.currentItem());
    }
  }

  componentWillUnmount() {
    WKApp.mittBus.off("space-changed", this.handleSpaceChanged);
    WKApp.mittBus.off("wk:nav-menu-activated", this.handleNavMenuActivated);
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
    const item = this.currentItem();
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
                className={
                  item.id === activeId
                    ? "wk-mcp-sidebar__item wk-mcp-sidebar__item--active"
                    : "wk-mcp-sidebar__item"
                }
                onClick={() => this.handleClick(item)}
              >
                {item.label()}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
}
