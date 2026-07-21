import React, { Component } from "react";
import { Spin, Toast } from "@douyinfe/semi-ui";
import { IconSearch, IconPlus } from "@douyinfe/semi-icons";
import { I18nContext, t, WKApp, WKInput, WKButton } from "@octo/base";
import { fetchMcpList, fetchMcpMine } from "../api/mcpService";
import { mcpListErrorI18nKey } from "../api/mcpListError";
import type { McpCategory, McpCreatedByType, McpDetail, McpListItem } from "../types/mcp";
import McpCard from "../components/McpCard";
import McpDetailModal from "../components/McpDetailModal";
import McpCreateModal from "../components/McpCreateModal";
import "../index.css";
import { parseMcpListQuery, serializeMcpListQuery } from "./mcpListQuery";

/** Which slice of the marketplace the list view is showing. */
type ListMode = "all" | "mine";

/** Page size for the infinite-scroll fetches. Backend caps at 100. */
const PAGE_SIZE = 20;
/** Fire the next page when the user scrolls within this many px of bottom. */
const SCROLL_THRESHOLD_PX = 200;

/** Source (来源) segmented control options. Module-level const so the array
 *  is stable across renders — otherwise every parent update re-allocates it
 *  and defeats any downstream memoisation on the pills. */
const SOURCE_FILTER_OPTIONS: ReadonlyArray<{
  value: McpCreatedByType | undefined;
  labelKey: string;
}> = [
  { value: undefined, labelKey: "mcp.list.source.all" },
  { value: "human", labelKey: "mcp.source.human" },
  { value: "bot", labelKey: "mcp.source.bot" },
];

interface McpMarketListPageState {
  items: McpListItem[];
  categories: McpCategory[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  keyword: string;
  categoriesSelected: string[];
  /** Provenance filter (issue #894). Single-select; undefined = 全部来源. */
  createdByType?: McpCreatedByType;
  mode: ListMode;
  offset: number;
  total: number;
  detailId: string | null;
  createVisible: boolean;
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
    createdByType: undefined,
    mode: "all",
    offset: 0,
    total: 0,
    detailId: null,
    createVisible: false,
    editingDetail: null,
  };

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private requestVersion = 0;
  private bodyRef = React.createRef<HTMLDivElement>();

  componentDidMount() {
    this.setState(parseMcpListQuery(window.location.search), () => this.loadData());
    WKApp.mittBus.on("wk:nav-menu-activated", this.handleNavMenuActivated_);
    WKApp.mittBus.on("space-changed", this.handleSpaceChanged_);
  }

  componentWillUnmount() {
    WKApp.mittBus.off("wk:nav-menu-activated", this.handleNavMenuActivated_);
    WKApp.mittBus.off("space-changed", this.handleSpaceChanged_);
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

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
        createdByType: this.state.createdByType,
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
    const requestCreatedBy = this.state.createdByType ?? "";
    this.setState({ loadingMore: true });
    try {
      const fetcher = this.state.mode === "mine" ? fetchMcpMine : fetchMcpList;
      const resp = await fetcher({
        keyword: this.state.keyword,
        categories: this.state.categoriesSelected,
        createdByType: this.state.createdByType,
        limit: PAGE_SIZE,
        offset,
      });
      if (
        requestVersion !== this.requestVersion ||
        requestKeyword !== this.state.keyword ||
        requestCategories !== this.state.categoriesSelected.join(",") ||
        requestCreatedBy !== (this.state.createdByType ?? "")
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
    this.setState({ mode, categoriesSelected: [], createdByType: undefined }, () => this.loadData());
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

  /** Toggle the "来源" segmented filter (issue #894). value === undefined
   *  means the 全部 pill. */
  private handleCreatedBy = (value: McpCreatedByType | undefined) => {
    if (value === this.state.createdByType) return;
    this.setState({ createdByType: value }, () => this.loadData());
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
      createdByType,
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
              <WKInput
                value={keyword}
                onChange={this.handleKeyword}
                prefix={<IconSearch />}
                placeholder={t("mcp.list.searchPlaceholder")}
              />
            </div>
            <WKButton
              variant="primary"
              icon={<IconPlus />}
              onClick={() => this.setState({ createVisible: true })}
            >
              {t("mcp.list.create")}
            </WKButton>
          </div>
        </header>

        <div
          className={
            mode === "mine"
              ? "wk-mcp__toolbar wk-mcp__toolbar--mine"
              : "wk-mcp__toolbar"
          }
        >
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
          {/* Provenance filter — segmented, single-select. Positioned to the
              right of the category pills so it reads as an orthogonal
              refinement. `全部` = clear filter. */}
          <div className="wk-mcp__source-filter" role="group" aria-label={t("mcp.list.source.filterLabel")}>
            {SOURCE_FILTER_OPTIONS.map(({ value, labelKey }) => {
              const active =
                value === undefined ? createdByType === undefined : createdByType === value;
              return (
                <button
                  key={value ?? "all"}
                  type="button"
                  className={
                    active
                      ? "wk-mcp__source-btn wk-mcp__source-btn--active"
                      : "wk-mcp__source-btn"
                  }
                  onClick={() => this.handleCreatedBy(value)}
                >
                  {t(labelKey)}
                </button>
              );
            })}
          </div>
          {mode === "mine" && (
            <span className="wk-mcp__mine-count">
              {t("mcp.list.mineTotal", { values: { count: total } })}
            </span>
          )}
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
            ) : items.length === 0 ? (
              <div className="wk-mcp__state">{t("mcp.list.empty")}</div>
            ) : (
              <>
                <div className="wk-mcp__grid">
                  {items.map((item) => (
                    <McpCard
                      key={item.id}
                      item={item}
                      keyword={keyword}
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
      </div>
    );
  }
}
