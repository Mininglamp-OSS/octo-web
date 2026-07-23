import React, { Component } from "react";
import { Spin, Toast } from "@douyinfe/semi-ui";
import { IconSearch, IconClose } from "@douyinfe/semi-icons";
import { Bot, ChevronDown, Upload } from "lucide-react";
import { I18nContext, t, WKApp, WKButton } from "@octo/base";
import { fetchMcpList, fetchMcpMine } from "../api/mcpService";
import { mcpListErrorI18nKey } from "../api/mcpListError";
import type { McpCategory, McpDetail, McpListItem } from "../types/mcp";
import McpCard from "../components/McpCard";
import McpDetailModal from "../components/McpDetailModal";
import McpCreateModal from "../components/McpCreateModal";
import McpBotPublishModal from "../components/McpBotPublishModal";
import "../index.css";
import { parseMcpListQuery, serializeMcpListQuery } from "./mcpListQuery";

/** Which slice of the marketplace the list view is showing. */
type ListMode = "all" | "mine";

/** Page size for the infinite-scroll fetches. Backend caps at 100. */
const PAGE_SIZE = 20;
/** Fire the next page when the user scrolls within this many px of bottom. */
const SCROLL_THRESHOLD_PX = 200;

interface McpMarketListPageState {
  items: McpListItem[];
  categories: McpCategory[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  keyword: string;
  categoriesSelected: string[];
  mode: ListMode;
  offset: number;
  total: number;
  detailId: string | null;
  createVisible: boolean;
  /** Dropdown-menu open state for the "上架 MCP" button. Mirrors Skill's
   *  `publishMenuOpen`. */
  publishMenuOpen: boolean;
  /** Bot 上架 modal open state. */
  botPublishVisible: boolean;
  /** When set, the create/edit modal opens in EDIT mode prefilled from this
   *  detail. Cleared on modal close. Distinct from `createVisible` — this
   *  drives the "editing" branch of the shared modal component. */
  editingDetail: McpDetail | null;
}

/**
 * Top-level MCP Market page. Rendered full-width in the main content area
 * (no secondary sidebar) when the "mcp-market" NavRail entry is active.
 */
export default class McpMarketListPage extends Component<
  {},
  McpMarketListPageState
> {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  state: McpMarketListPageState = {
    items: [],
    categories: [],
    loading: false,
    loadingMore: false,
    error: null,
    keyword: "",
    categoriesSelected: [],
    mode: "all",
    offset: 0,
    total: 0,
    detailId: null,
    createVisible: false,
    publishMenuOpen: false,
    botPublishVisible: false,
    editingDetail: null,
  };

  private publishMenuRef = React.createRef<HTMLDivElement>();

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private requestVersion = 0;
  private bodyRef = React.createRef<HTMLDivElement>();

  componentDidMount() {
    this.setState(parseMcpListQuery(window.location.search), () => this.loadData());
    WKApp.mittBus.on("wk:nav-menu-activated", this.handleNavMenuActivated_);
    WKApp.mittBus.on("space-changed", this.handleSpaceChanged_);
  }

  componentDidUpdate(_prevProps: {}, prevState: McpMarketListPageState) {
    // Only own the two global listeners while the publish dropdown is open —
    // mirrors dmworkskillmarket's SkillListPage. Attaching in componentDidMount
    // unconditionally forces every card click / scroll on the page to trip
    // through a no-op guard for the 99% of the session where the menu is
    // closed.
    if (prevState.publishMenuOpen !== this.state.publishMenuOpen) {
      if (this.state.publishMenuOpen) {
        document.addEventListener("pointerdown", this.handleGlobalPointerDown_);
        document.addEventListener("keydown", this.handleGlobalKeyDown_);
      } else {
        document.removeEventListener("pointerdown", this.handleGlobalPointerDown_);
        document.removeEventListener("keydown", this.handleGlobalKeyDown_);
      }
    }
  }

  componentWillUnmount() {
    WKApp.mittBus.off("wk:nav-menu-activated", this.handleNavMenuActivated_);
    WKApp.mittBus.off("space-changed", this.handleSpaceChanged_);
    // Idempotent — safe if the menu was closed at unmount.
    document.removeEventListener("pointerdown", this.handleGlobalPointerDown_);
    document.removeEventListener("keydown", this.handleGlobalKeyDown_);
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  /** Close the publish dropdown on outside click. Attached only while
   *  publishMenuOpen (see componentDidUpdate). */
  private handleGlobalPointerDown_ = (e: PointerEvent) => {
    if (!this.publishMenuRef.current?.contains(e.target as Node)) {
      this.setState({ publishMenuOpen: false });
    }
  };

  /** Close the publish dropdown on Escape. Attached only while
   *  publishMenuOpen (see componentDidUpdate). */
  private handleGlobalKeyDown_ = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      this.setState({ publishMenuOpen: false });
    }
  };

  private handleSpaceChanged_ = () => this.loadData();

  private handleNavMenuActivated_ = ({ menuId }: { menuId: string }) => {
    if (menuId === "mcp-market") {
      this.loadData();
    }
  };

  /** Initial / filtered load. Resets offset and replaces items. */
  async loadData() {
    const requestVersion = ++this.requestVersion;
    this.syncQuery();
    this.setState({ loading: true, loadingMore: false, offset: 0, error: null });
    try {
      const fetcher = this.state.mode === "mine" ? fetchMcpMine : fetchMcpList;
      const resp = await fetcher({
        keyword: this.state.keyword,
        categories: this.state.categoriesSelected,
        limit: PAGE_SIZE,
        offset: 0,
      });
      if (requestVersion !== this.requestVersion) return;
      this.setState({
        items: resp.items,
        categories: resp.categories,
        total: resp.total,
        offset: resp.items.length,
        loading: false,
      });
    } catch (err: unknown) {
      if (requestVersion !== this.requestVersion) return;
      this.setState({
        loading: false,
        items: [],
        error: t(mcpListErrorI18nKey(err)),
      });
    }
  }

  private syncQuery() {
    const query = serializeMcpListQuery(this.state, window.location.search);
    const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", next);
  }

  /** Fetch the next page and append. Guarded against concurrent triggers and
   *  the "reached the end" case (items.length >= total). */
  private async loadMore() {
    const { loading, loadingMore, items, total, offset } = this.state;
    if (loading || loadingMore) return;
    if (items.length >= total) return;
    const requestVersion = this.requestVersion;
    const requestKeyword = this.state.keyword;
    const requestCategories = this.state.categoriesSelected.join(",");
    this.setState({ loadingMore: true });
    try {
      const fetcher = this.state.mode === "mine" ? fetchMcpMine : fetchMcpList;
      const resp = await fetcher({
        keyword: this.state.keyword,
        categories: this.state.categoriesSelected,
        limit: PAGE_SIZE,
        offset,
      });
      if (
        requestVersion !== this.requestVersion ||
        requestKeyword !== this.state.keyword ||
        requestCategories !== this.state.categoriesSelected.join(",")
      ) {
        return;
      }
      this.setState((prev) => ({
        items: [...prev.items, ...resp.items],
        // categories intentionally not overwritten mid-scroll — pill counts
        // stay stable while the user keeps scrolling one filtered view.
        total: resp.total,
        offset: prev.offset + resp.items.length,
        loadingMore: false,
      }));
    } catch (err: unknown) {
      if (requestVersion !== this.requestVersion) return;
      this.setState({ loadingMore: false });
      Toast.error(
        err instanceof Error ? err.message : t("mcp.common.loadFailed")
      );
    }
  }

  /** Near-bottom scroll listener on .wk-mcp__body — the vertical scroll
   *  container. Uses a threshold so the next page starts fetching before the
   *  user hits the actual bottom. */
  private handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remaining <= SCROLL_THRESHOLD_PX) {
      this.loadMore();
    }
  };

  private handleMode = (mode: ListMode) => {
    if (mode === this.state.mode) return;
    this.setState({ mode, categoriesSelected: [] }, () => this.loadData());
  };

  /** Patch a single row after a successful edit — keeps scroll position
   *  intact (a full loadData() would reset offset to 0 and rebuild the grid).
   *  Category-pill counts may go slightly stale until the next full reload,
   *  which is an acceptable tradeoff for not losing the user's scroll spot. */
  private handleItemUpdated = (updated: McpDetail) => {
    this.setState((prev) => {
      const idx = prev.items.findIndex((it) => it.id === updated.id);
      if (idx === -1) return null;
      const next = prev.items.slice();
      next[idx] = {
        ...next[idx],
        name: updated.name,
        slogan: updated.slogan,
        category: updated.category,
        tags: updated.tags,
        toolCount: updated.toolCount,
        icon: updated.icon,
        visibility: updated.visibility,
        creatorName: updated.creatorName,
      };
      return { items: next };
    });
  };

  /** Drop a single row after a successful delete — same scroll-preserving
   *  rationale as handleItemUpdated. `total` decrements so the "reached the
   *  end" footnote and infinite-scroll gate stay accurate. */
  private handleItemDeleted = (id: string) => {
    this.setState((prev) => {
      const idx = prev.items.findIndex((it) => it.id === id);
      if (idx === -1) return null;
      return {
        items: prev.items.filter((it) => it.id !== id),
        total: Math.max(0, prev.total - 1),
        offset: Math.max(0, prev.offset - 1),
      };
    });
  };

  /** Post-save handler. Edit → in-place patch (no scroll reset). Create →
   *  full reload so the new row surfaces at its natural sort position. */
  private handleSaved = (updated?: McpDetail) => {
    if (updated) {
      this.handleItemUpdated(updated);
    } else {
      this.loadData();
    }
  };

  private handleKeyword = (value: string) => {
    this.setState({ keyword: value });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.loadData(), 300);
  };

  private handleCategory = (key: string) => {
    this.setState((prev) => ({
      categoriesSelected:
        key === "all" || prev.categoriesSelected[0] === key ? [] : [key],
    }), () => this.loadData());
  };

  render() {
    const {
      items,
      categories,
      loading,
      loadingMore,
      error,
      keyword,
      categoriesSelected,
      mode,
      total,
      detailId,
      createVisible,
      editingDetail,
    } = this.state;

    const hasMore = items.length < total;
    // Ownership check: the "mine" tab is defined as caller-owned records
    // (backend enforces owner-only PATCH/DELETE — mcp-v1.md §4.5/§4.6), so
    // we can safely expose the manage actions on any card in this mode
    // without a per-record owner_uid comparison.
    const canManage = mode === "mine";

    return (
      <div className="wk-mcp">
        <header className="wk-mcp__topbar">
          <nav className="wk-mcp__tabs" aria-label={t("mcp.list.navLabel")}>
            {(["all", "mine"] as ListMode[]).map((k) => (
              <button
                key={k}
                type="button"
                className={k === mode ? "is-active" : ""}
                onClick={() => this.handleMode(k)}
              >
                {t(`mcp.list.mode.${k}`)}
              </button>
            ))}
          </nav>
          <div className="wk-mcp__topbar-actions">
            <div className="wk-mcp__search">
              <div className="wk-mcp__search-control">
                <IconSearch aria-hidden />
                <input
                  type="search"
                  value={keyword}
                  onChange={(e) => this.handleKeyword(e.target.value)}
                  placeholder={t("mcp.list.searchPlaceholder")}
                  aria-label={t("mcp.list.searchPlaceholder")}
                />
                {keyword && (
                  <button
                    type="button"
                    className="wk-mcp__search-clear"
                    aria-label={t("mcp.list.searchClear")}
                    title={t("mcp.list.searchClear")}
                    onClick={() => this.handleKeyword("")}
                  >
                    <IconClose aria-hidden />
                  </button>
                )}
              </div>
            </div>
            <div className="wk-mcp-publish-menu" ref={this.publishMenuRef}>
              <WKButton
                variant="primary"
                icon={<Upload size={15} />}
                onClick={() =>
                  this.setState((prev) => ({ publishMenuOpen: !prev.publishMenuOpen }))
                }
                aria-haspopup="menu"
                aria-expanded={this.state.publishMenuOpen}
              >
                {t("mcp.list.create")}
                <ChevronDown size={14} />
              </WKButton>
              {this.state.publishMenuOpen && (
                <div className="wk-mcp-publish-menu__panel" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      this.setState({ publishMenuOpen: false, botPublishVisible: true })
                    }
                  >
                    <Bot size={16} />
                    <span>
                      <strong>{t("mcp.publishMenu.botTitle")}</strong>
                      <small>{t("mcp.publishMenu.botHint")}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      this.setState({ publishMenuOpen: false, createVisible: true })
                    }
                  >
                    <Upload size={16} />
                    <span>
                      <strong>{t("mcp.publishMenu.manualTitle")}</strong>
                      <small>{t("mcp.publishMenu.manualHint")}</small>
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="wk-mcp__toolbar">
          <div className="wk-mcp__pills">
            {categories.map((cat) => (
              <button
                key={cat.key}
                className={
                  (cat.key === "all" ? categoriesSelected.length === 0 : categoriesSelected.includes(cat.key))
                    ? "wk-mcp__pill wk-mcp__pill--active"
                    : "wk-mcp__pill"
                }
                onClick={() => this.handleCategory(cat.key)}
              >
                {cat.label}
                <span className="wk-mcp__pill-count">{cat.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div
          className="wk-mcp__body"
          ref={this.bodyRef}
          onScroll={this.handleScroll}
        >
          <div className="wk-mcp__inner">

            {loading ? (
              <div className="wk-mcp__state">
                <Spin />
              </div>
            ) : error ? (
              <div className="wk-mcp__state wk-mcp__state--error" role="alert">
                <strong>{t("mcp.list.errorTitle")}</strong>
                <span>{error}</span>
                <WKButton onClick={() => this.loadData()}>{t("mcp.list.retry")}</WKButton>
              </div>
            ) : (
              <>
                <div className="wk-mcp__result-summary">
                  <span
                    className="wk-mcp__result-summary-total"
                    aria-live="polite"
                  >
                    {t("mcp.list.total", { values: { count: total } })}
                  </span>
                </div>
                {items.length === 0 ? (
                  <div className="wk-mcp__state">{t("mcp.list.empty")}</div>
                ) : (
                  <>
                    <div className="wk-mcp__grid">
                      {items.map((item) => (
                        <McpCard
                          key={item.id}
                          item={item}
                          onClick={(it) => this.setState({ detailId: it.id })}
                        />
                      ))}
                    </div>
                    <div className="wk-mcp__footnote">
                      {loadingMore ? (
                        <Spin size="small" />
                      ) : hasMore ? (
                        <span>{t("mcp.list.loadMore")}</span>
                      ) : (
                        <span>{t("mcp.list.reachedEnd")}</span>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <McpDetailModal
          mcpId={detailId}
          onClose={() => this.setState({ detailId: null })}
          canManage={canManage}
          onEdit={(d) =>
            // Close the detail modal and hand off to the shared create/edit
            // modal in edit mode. State batching keeps this a single render.
            this.setState({ detailId: null, editingDetail: d, createVisible: true })
          }
          onDeleted={this.handleItemDeleted}
        />
        <McpCreateModal
          visible={createVisible}
          editing={editingDetail}
          onClose={() =>
            this.setState({ createVisible: false, editingDetail: null })
          }
          onSaved={this.handleSaved}
        />
        <McpBotPublishModal
          visible={this.state.botPublishVisible}
          onClose={() => this.setState({ botPublishVisible: false })}
        />
      </div>
    );
  }
}
