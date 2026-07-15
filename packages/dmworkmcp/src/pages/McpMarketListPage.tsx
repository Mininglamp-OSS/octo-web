import React, { Component } from "react";
import { Spin, Toast } from "@douyinfe/semi-ui";
import { IconSearch, IconPlus } from "@douyinfe/semi-icons";
import { I18nContext, t, WKApp, WKInput, WKButton } from "@octo/base";
import { fetchMcpList, fetchMcpMine } from "../api/mcpService";
import type { McpCategory, McpListItem } from "../types/mcp";
import McpCard from "../components/McpCard";
import McpDetailModal from "../components/McpDetailModal";
import McpCreateModal from "../components/McpCreateModal";
import "../index.css";

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
  keyword: string;
  category: string;
  mode: ListMode;
  offset: number;
  total: number;
  detailId: string | null;
  createVisible: boolean;
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
    keyword: "",
    category: "all",
    mode: "all",
    offset: 0,
    total: 0,
    detailId: null,
    createVisible: false,
  };

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private bodyRef = React.createRef<HTMLDivElement>();

  componentDidMount() {
    this.loadData();
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
    this.setState({ loading: true, offset: 0 });
    try {
      const fetcher = this.state.mode === "mine" ? fetchMcpMine : fetchMcpList;
      const resp = await fetcher({
        keyword: this.state.keyword,
        category: this.state.category,
        limit: PAGE_SIZE,
        offset: 0,
      });
      this.setState({
        items: resp.items,
        categories: resp.categories,
        total: resp.total,
        offset: resp.items.length,
        loading: false,
      });
    } catch (err: unknown) {
      this.setState({ loading: false });
      Toast.error(
        err instanceof Error ? err.message : t("mcp.common.loadFailed")
      );
    }
  }

  /** Fetch the next page and append. Guarded against concurrent triggers and
   *  the "reached the end" case (items.length >= total). */
  private async loadMore() {
    const { loading, loadingMore, items, total, offset } = this.state;
    if (loading || loadingMore) return;
    if (items.length >= total) return;
    this.setState({ loadingMore: true });
    try {
      const fetcher = this.state.mode === "mine" ? fetchMcpMine : fetchMcpList;
      const resp = await fetcher({
        keyword: this.state.keyword,
        category: this.state.category,
        limit: PAGE_SIZE,
        offset,
      });
      this.setState((prev) => ({
        items: [...prev.items, ...resp.items],
        // categories intentionally not overwritten mid-scroll — pill counts
        // stay stable while the user keeps scrolling one filtered view.
        total: resp.total,
        offset: prev.offset + resp.items.length,
        loadingMore: false,
      }));
    } catch (err: unknown) {
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
    this.setState({ mode, category: "all" }, () => this.loadData());
  };

  private handleKeyword = (value: string) => {
    this.setState({ keyword: value });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.loadData(), 300);
  };

  private handleCategory = (key: string) => {
    this.setState({ category: key }, () => this.loadData());
  };

  render() {
    const {
      items,
      categories,
      loading,
      loadingMore,
      keyword,
      category,
      mode,
      total,
      detailId,
      createVisible,
    } = this.state;

    const hasMore = items.length < total;

    return (
      <div className="wk-mcp">
        <div className="wk-mcp__topbar">
          <span className="wk-mcp__title">{t("mcp.menu.title")}</span>
          <WKButton
            variant="primary"
            icon={<IconPlus />}
            onClick={() => this.setState({ createVisible: true })}
          >
            {t("mcp.list.create")}
          </WKButton>
        </div>

        <div
          className="wk-mcp__body"
          ref={this.bodyRef}
          onScroll={this.handleScroll}
        >
          <div className="wk-mcp__inner">
            <div className="wk-mcp__head">
              <h1 className="wk-mcp__head-title">{t("mcp.menu.title")}</h1>
              <p className="wk-mcp__head-desc">{t("mcp.list.desc")}</p>
            </div>

            <div className="wk-mcp__mode">
              {(["all", "mine"] as ListMode[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={
                    k === mode
                      ? "wk-mcp__mode-item wk-mcp__mode-item--active"
                      : "wk-mcp__mode-item"
                  }
                  onClick={() => this.handleMode(k)}
                >
                  {t(`mcp.list.mode.${k}`)}
                </button>
              ))}
            </div>

            <div className="wk-mcp__toolbar">
              <div className="wk-mcp__search">
                <WKInput
                  value={keyword}
                  onChange={this.handleKeyword}
                  prefix={<IconSearch />}
                  placeholder={t("mcp.list.searchPlaceholder")}
                />
              </div>
              <div className="wk-mcp__pills">
                {categories.map((cat) => (
                  <button
                    key={cat.key}
                    className={
                      cat.key === category
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

            {loading ? (
              <div className="wk-mcp__state">
                <Spin />
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
        />
        <McpCreateModal
          visible={createVisible}
          onClose={() => this.setState({ createVisible: false })}
          onCreated={() => this.loadData()}
        />
      </div>
    );
  }
}
