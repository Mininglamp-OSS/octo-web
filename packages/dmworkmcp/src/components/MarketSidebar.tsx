import React, { Component, useEffect, useRef } from "react";
import { Plug, ShieldCheck, Sparkles, UserRound, Users } from "lucide-react";
import { I18nContext, t, WKApp, Dap } from "@octo/base";
import {
  SkillListPage,
  SpaceReviewPage,
  useReviewRequests,
  useSpaceRole,
} from "@dmwork/skillmarket";
import McpMarketListPage from "../pages/McpMarketListPage";
import ExpertMarketListPage from "../pages/ExpertMarketListPage";
import MyAssetsPage from "../pages/MyAssetsPage";

/**
 * Everything the sidebar needs to decide whether the reviewer-only row is
 * shown and what its badge says. Resolved by <ReviewGateProbe /> (hooks live in
 * @dmwork/skillmarket; this component is a class) and mirrored into state.
 *
 * `isReviewer` is COSMETIC. The server independently enforces the reviewer role
 * — `mode=space` list / approve / reject answer 403 for a plain member and 404
 * across Spaces — so this only decides whether we advertise an action the user
 * cannot take. Never treat it as an authorization boundary.
 */
interface ReviewGate {
  /** True only once the role has resolved AND the user may review. */
  isReviewer: boolean;
  /** True while the role is still in flight. The row stays hidden (no flash for
   *  members) but the route stays resolvable, so a reviewer's deep link is not
   *  bounced before we know who they are. */
  roleLoading: boolean;
  /** Pending requests in this Space, for the row badge. 0 when not a reviewer. */
  pendingCount: number;
}

const INITIAL_REVIEW_GATE: ReviewGate = {
  isReviewer: false,
  roleLoading: true,
  pendingCount: 0,
};

interface MarketItem {
  id: string;
  routePath: string;
  label: () => string;
  /** Leading glyph for the sidebar row — a lucide icon that reads the market's
   *  asset kind at a glance (connector / skill / expert). */
  icon: React.ReactElement;
  /** Optional pill shown to the right of the label. Returns null to render
   *  nothing — the feature-flag / count gate lives inside each item's own
   *  function, so one row's gate can never silence another's (the 回路 pill is
   *  `dmloopOn`-gated; the review count is not). */
  badge?: (gate: ReviewGate) => string | null;
  /** Render a horizontal divider above this row — separates the personal
   *  "我的发布" entry from the discovery markets (技能 / 连接器 / 专家). */
  dividerBefore?: boolean;
  /** Show this row in the sidebar list. Omitted = always shown. Must answer
   *  false while the gate is still resolving so the row never flashes for a
   *  user who turns out not to be allowed to see it. */
  visible?: (gate: ReviewGate) => boolean;
  /** Allow URL → item resolution for this row. Defaults to `visible`. Kept
   *  separate because a deep link / cold load arrives BEFORE the role resolves:
   *  routing must stay permissive while unknown and only close once we know the
   *  user is not a reviewer. */
  routable?: (gate: ReviewGate) => boolean;
  render: () => React.ReactElement;
}

// Order below controls the sidebar tab order: 技能 → 连接器 → 专家 → 我的发布
// → 组织发布管理. The NavRail menu's onPress still boots the right pane into
// /mcp-market/mcp (see module.tsx), independent of this order; this array only
// drives the sidebar's visual order + the path-miss fallback.
//
// The array stays a module-level, side-effect-free constant: per-user
// visibility is expressed as the `visible` / `routable` predicates above and
// applied against the gate held in component state, so no row needs hook state
// at definition time.
const MARKET_ITEMS: MarketItem[] = [
  {
    id: "skills",
    routePath: "/mcp-market/skills",
    label: () => t("mcp.sidebar.skills"),
    icon: <Sparkles size={16} aria-hidden="true" />,
    render: () => <SkillListPage />,
  },
  {
    id: "mcp",
    routePath: "/mcp-market/mcp",
    label: () => t("mcp.sidebar.mcp"),
    icon: <Plug size={16} aria-hidden="true" />,
    render: () => <McpMarketListPage />,
  },
  {
    id: "experts",
    routePath: "/mcp-market/experts",
    label: () => t("mcp.sidebar.experts"),
    icon: <Users size={16} aria-hidden="true" />,
    badge: () => (WKApp.remoteConfig?.dmloopOn ? t("mcp.sidebar.expertsBadge") : null),
    render: () => <ExpertMarketListPage />,
  },
  {
    id: "mine",
    routePath: "/mcp-market/mine",
    label: () => t("mcp.sidebar.mine"),
    icon: <UserRound size={16} aria-hidden="true" />,
    dividerBefore: true,
    render: () => <MyAssetsPage />,
  },
  {
    id: "review",
    routePath: "/mcp-market/review",
    label: () => t("mcp.sidebar.review"),
    icon: <ShieldCheck size={16} aria-hidden="true" />,
    // Count badge, ungated by dmloopOn — hidden at zero so the row is quiet
    // when the queue is empty.
    badge: (gate) =>
      gate.pendingCount > 0 ? (gate.pendingCount > 99 ? "99+" : String(gate.pendingCount)) : null,
    dividerBefore: true,
    visible: (gate) => gate.isReviewer,
    routable: (gate) => gate.roleLoading || gate.isReviewer,
    render: () => <SpaceReviewPage />,
  },
];

/** Rows the current user may see. */
function listableItems(gate: ReviewGate): MarketItem[] {
  return MARKET_ITEMS.filter((item) => item.visible?.(gate) ?? true);
}

/** Rows the current user may be routed to (superset of `listableItems` while
 *  the gate is still resolving). */
function routableItems(gate: ReviewGate): MarketItem[] {
  return MARKET_ITEMS.filter((item) => (item.routable ?? item.visible)?.(gate) ?? true);
}

interface MarketSidebarState {
  activeId: string;
  gate: ReviewGate;
}

function findMarketItemByRoutePath(
  path: string | undefined,
  gate: ReviewGate
): MarketItem | undefined {
  if (!path) return undefined;
  return routableItems(gate).find((item) => item.routePath === path);
}

/**
 * Hook adapter for the class below. `useSpaceRole` / `useReviewRequests` live in
 * @dmwork/skillmarket and MarketSidebar is a class component (mittBus wiring,
 * remoteConfig subscriptions and a forceUpdate re-render trick all depend on
 * that), so rather than convert the whole component we mount a headless child
 * that runs the hooks and reports upward. `onChange` must be a stable callback.
 */
function ReviewGateProbe({ onChange }: { onChange: (gate: ReviewGate) => void }) {
  const { isReviewer, loading } = useSpaceRole();
  // Badge-only probe: one row, and held back entirely until the role resolves
  // so a plain member never fires the 403-ing `mode=space` read.
  const { pendingCount, refresh } = useReviewRequests({
    mode: "space",
    status: "pending",
    pageSize: 1,
    enabled: isReviewer,
  });

  // Re-read the count for the Space the user just switched INTO.
  //
  // The count is Space-scoped server-side (every read carries `X-Space-Id`) but
  // `useReviewRequests` keys its fetch on mode/status/pageSize only, so a switch
  // moves none of them and nothing refetches. The reviewer gate does not save
  // us either: `enabled` is `isReviewer`, and an owner who switches to another
  // Space they own leaves it true, so the probe keeps rendering the previous
  // Space's number. Unlike the market pages the sidebar is never remounted by
  // the switch — MarketSidebar only replaces the RIGHT pane — so the re-read has
  // to be explicit here, exactly as SkillListPage / McpMarketListPage /
  // ExpertMarketListPage each do it in their own `space-changed` handler.
  //
  // Deliberately `refresh()` and not `notifyReviewsChanged()`: a Space switch is
  // not a review mutation. Broadcasting it on the mutation signal would tell
  // every subscriber that the QUEUE moved, which is a different (and false)
  // claim, and the other subscribers already handle the switch themselves.
  //
  // `refresh` is read through a ref so a new identity on every render does not
  // churn the mitt subscription.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const handleSpaceChanged = () => refreshRef.current();
    WKApp.mittBus.on("space-changed", handleSpaceChanged);
    return () => WKApp.mittBus.off("space-changed", handleSpaceChanged);
  }, []);

  useEffect(() => {
    onChange({ isReviewer, roleLoading: loading, pendingCount: isReviewer ? pendingCount : 0 });
  }, [onChange, isReviewer, loading, pendingCount]);

  return null;
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
      findMarketItemByRoutePath(WKApp.route.currentPath, INITIAL_REVIEW_GATE)?.id ??
      findMarketItemByRoutePath(window.location.pathname, INITIAL_REVIEW_GATE)?.id ??
      MARKET_ITEMS[0].id,
    gate: INITIAL_REVIEW_GATE,
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
    const { gate } = this.state;
    return (
      findMarketItemByRoutePath(WKApp.route.currentPath, gate) ??
      findMarketItemByRoutePath(window.location.pathname, gate) ??
      // The activeId lookup is gated too: a stale reviewer-only activeId must
      // not survive a demotion / Space switch and re-mount a 403 view.
      routableItems(gate).find((item) => item.id === this.state.activeId) ??
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
      // market_tab_switched:仅在真正切到不同 tab 时计一次。原 TrackRules 的 market-sidebar-item
      // 点击规则对「重复点当前 tab」也会触发 → 虚增(见 review P2-7)。已移除该规则,改此处 gate。
      Dap.shared.track("market_tab_switched", {});
      this.setState({ activeId: item.id });
    }
    this.replaceRightPane(item);
    // Sync the URL so refresh/copy-link/back button land on this tab
    // rather than whatever stale path was in the address bar before.
    WKApp.route.syncPath(item.routePath);
  };

  /**
   * Reported by <ReviewGateProbe />. Whenever the gate closes on the row the
   * user is currently sitting on — a Space switch that demotes them, or a
   * deep-link whose role probe has just come back "member" — move them to a
   * permitted row instead of leaving a view that will 403.
   */
  private handleGateChange = (gate: ReviewGate) => {
    const current = this.state.gate;
    if (
      current.isReviewer === gate.isReviewer &&
      current.roleLoading === gate.roleLoading &&
      current.pendingCount === gate.pendingCount
    ) {
      return;
    }
    this.setState({ gate }, () => {
      const active = MARKET_ITEMS.find((item) => item.id === this.state.activeId);
      if (!active) return;
      if ((active.routable ?? active.visible)?.(gate) ?? true) return;
      const fallback = MARKET_ITEMS[0];
      this.setState({ activeId: fallback.id });
      if (WKApp.currentMenuId !== "mcp-market") return;
      this.replaceRightPane(fallback);
      WKApp.route.syncPath(fallback.routePath);
    });
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
    const { gate } = this.state;
    const item =
      findMarketItemByRoutePath(WKApp.route.currentPath, gate) ??
      findMarketItemByRoutePath(window.location.pathname, gate) ??
      MARKET_ITEMS[0];
    if (item.id !== this.state.activeId) {
      this.setState({ activeId: item.id });
    }
  };

  render() {
    const { activeId, gate } = this.state;
    return (
      <div className="wk-mcp-sidebar">
        <ReviewGateProbe onChange={this.handleGateChange} />
        <div className="wk-mcp-sidebar__brand">
          <span className="wk-mcp-sidebar__brand-glyph" aria-hidden="true">
            {t("mcp.sidebar.brandGlyph")}
          </span>
          <span className="wk-mcp-sidebar__brand-text">
            <strong>{t("mcp.sidebar.header")}</strong>
            <small>{t("mcp.sidebar.tagline")}</small>
          </span>
        </div>
        <ul className="wk-mcp-sidebar__list">
          {listableItems(gate).map((item) => {
            const badge = item.badge?.(gate);
            return (
              <React.Fragment key={item.id}>
                {item.dividerBefore && (
                  <li className="wk-mcp-sidebar__divider" role="separator" aria-hidden="true" />
                )}
                <li>
                  <button
                    type="button"
                    className={
                      item.id === activeId
                        ? "wk-mcp-sidebar__item wk-mcp-sidebar__item--active"
                        : "wk-mcp-sidebar__item"
                    }
                    onClick={() => this.handleClick(item)}
                  >
                    <span className="wk-mcp-sidebar__item-left">
                      <span className="wk-mcp-sidebar__item-icon">{item.icon}</span>
                      <span className="wk-mcp-sidebar__item-label">{item.label()}</span>
                    </span>
                    {badge && <span className="wk-mcp-sidebar__badge">{badge}</span>}
                  </button>
                </li>
              </React.Fragment>
            );
          })}
        </ul>
        <div className="wk-mcp-sidebar__footnote">{t("mcp.sidebar.footnote")}</div>
      </div>
    );
  }
}
