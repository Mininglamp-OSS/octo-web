import React, { Component } from "react";
import axios from "axios";
import { Spin, Toast } from "@douyinfe/semi-ui";
import { IconSearch, IconClose } from "@douyinfe/semi-icons";
import { Bot, Check, ChevronDown, SlidersHorizontal, Upload } from "lucide-react";
import { I18nContext, t, WKApp, WKButton } from "@octo/base";
import { fetchMcpDetail, fetchMcpList, fetchMcpMine, fetchMcpTags, McpTagSuggestion } from "../api/mcpService";
import { mcpListErrorI18nKey } from "../api/mcpListError";
import type { McpCategory, McpDetail, McpListItem } from "../types/mcp";
import McpCard from "../components/McpCard";
import McpDetailModal from "../components/McpDetailModal";
import McpCreateModal from "../components/McpCreateModal";
import McpBotPublishModal from "../components/McpBotPublishModal";
import McpDeleteConfirmModal from "../components/McpDeleteConfirmModal";
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
  /** Multi-tag filter (mcp-v1.md §4.2, AND semantics). Populated from
   *  `?tag=` URL params on mount; the tag popover in the search bar drives
   *  updates. Empty = no tag filter. */
  tagsSelected: string[];
  /** Whether the search-bar tag popover is open. Kept in class state so the
   *  outside-click listener + Escape handler can toggle it. */
  tagFilterOpen: boolean;
  /** Fuzzy filter typed into the tag-popover search input. Debounced fetch
   *  against `/mcp_tags` populates `tagSuggestions`. */
  tagQuery: string;
  /** Backend-supplied tag suggestions (mcp-v1.md §4.8). Repopulated whenever
   *  the popover opens or `tagQuery` changes; empty until the first fetch
   *  resolves. */
  tagSuggestions: McpTagSuggestion[];
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
  /** When set, the standalone delete-confirm modal is visible for this row.
   *  Mirrors dmworkskillmarket's `deleting` state — a card-level trash click
   *  short-circuits opening the detail modal. */
  deletingItem: McpListItem | null;
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
    tagsSelected: [],
    tagFilterOpen: false,
    tagQuery: "",
    tagSuggestions: [],
    mode: "all",
    offset: 0,
    total: 0,
    detailId: null,
    createVisible: false,
    publishMenuOpen: false,
    botPublishVisible: false,
    editingDetail: null,
    deletingItem: null,
  };

  private publishMenuRef = React.createRef<HTMLDivElement>();
  private tagFilterRef = React.createRef<HTMLDivElement>();
  private tagSearchInputRef = React.createRef<HTMLInputElement>();

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private requestVersion = 0;
  private bodyRef = React.createRef<HTMLDivElement>();

  componentDidMount() {
    this.setState(parseMcpListQuery(window.location.search), () => this.loadData());
    WKApp.mittBus.on("wk:nav-menu-activated", this.handleNavMenuActivated_);
    WKApp.mittBus.on("space-changed", this.handleSpaceChanged_);
  }

  componentDidUpdate(_prevProps: {}, prevState: McpMarketListPageState) {
    // Only own the two global listeners while EITHER the publish dropdown or
    // the tag filter popover is open — mirrors dmworkskillmarket's
    // SkillListPage. Attaching in componentDidMount unconditionally forces
    // every card click / scroll on the page to trip through a no-op guard
    // for the 99% of the session where both are closed.
    const wasOpen = prevState.publishMenuOpen || prevState.tagFilterOpen;
    const isOpen = this.state.publishMenuOpen || this.state.tagFilterOpen;
    if (wasOpen !== isOpen) {
      if (isOpen) {
        document.addEventListener("pointerdown", this.handleGlobalPointerDown_);
        document.addEventListener("keydown", this.handleGlobalKeyDown_);
      } else {
        document.removeEventListener("pointerdown", this.handleGlobalPointerDown_);
        document.removeEventListener("keydown", this.handleGlobalKeyDown_);
      }
    }
    // Fetch tag suggestions whenever the popover just opened or the fuzzy
    // query changed while it's open. Debounced by 160ms — mirrors Skill's
    // SearchBar (dmworkskillmarket/SearchBar.tsx) so the two markets pace
    // the tag catalog the same way.
    const openedNow = !prevState.tagFilterOpen && this.state.tagFilterOpen;
    const queryChanged = prevState.tagQuery !== this.state.tagQuery && this.state.tagFilterOpen;
    if (openedNow || queryChanged) {
      this.scheduleTagFetch_();
    }
    if (openedNow) {
      // Focus the popover search input WITHOUT letting the browser scroll
      // the ancestor list container — the input lives inside `.wk-mcp__body`
      // which owns the near-bottom scroll listener; a scrollIntoView nudge
      // there would trip loadMore() at the worst possible time.
      this.tagSearchInputRef.current?.focus({ preventScroll: true });
    }
    if (prevState.tagFilterOpen && !this.state.tagFilterOpen) {
      this.cancelTagFetch_();
    }
  }

  componentWillUnmount() {
    WKApp.mittBus.off("wk:nav-menu-activated", this.handleNavMenuActivated_);
    WKApp.mittBus.off("space-changed", this.handleSpaceChanged_);
    this.cancelTagFetch_();
    // Idempotent — safe if both popovers were closed at unmount.
    document.removeEventListener("pointerdown", this.handleGlobalPointerDown_);
    document.removeEventListener("keydown", this.handleGlobalKeyDown_);
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  /** Close either open dropdown on outside click. Attached only while at
   *  least one is open (see componentDidUpdate). */
  private handleGlobalPointerDown_ = (e: PointerEvent) => {
    if (
      this.state.publishMenuOpen &&
      !this.publishMenuRef.current?.contains(e.target as Node)
    ) {
      this.setState({ publishMenuOpen: false });
    }
    if (
      this.state.tagFilterOpen &&
      !this.tagFilterRef.current?.contains(e.target as Node)
    ) {
      this.setState({ tagFilterOpen: false });
    }
  };

  /** Close either open dropdown on Escape. Attached only while at least one
   *  is open (see componentDidUpdate). */
  private handleGlobalKeyDown_ = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      this.setState({ publishMenuOpen: false, tagFilterOpen: false });
    }
  };

  /** Reset per-space UI state on space switch — dropped selections + closed
   *  popovers before refetching. Tags / categories are space-scoped so a
   *  filter from space A stays with space A; leaving it selected across a
   *  switch produces a request the new backend will silently return zero
   *  rows for. Matches dmworkskillmarket's SkillListPage handler. */
  private handleSpaceChanged_ = () => {
    this.cancelTagFetch_();
    this.setState({
      tagsSelected: [],
      tagFilterOpen: false,
      tagQuery: "",
      tagSuggestions: [],
      categoriesSelected: [],
      publishMenuOpen: false,
      botPublishVisible: false,
    }, () => this.loadData());
  };

  private tagFetchTimer: ReturnType<typeof setTimeout> | null = null;
  private tagFetchController: AbortController | null = null;

  /** Identity-keyed memo for the popover's `tagRows`. Recomputing the
   *  selected+suggestions union + sort on every parent re-render was
   *  O(n*m) — measurable when the caller has typed several keystrokes into
   *  the primary search input while the tag popover is open. Keying on the
   *  array references is fine: state updates always produce new refs, so a
   *  hit is a genuine "nothing changed" reuse. */
  private tagRowsCacheKey_: [string[], McpTagSuggestion[]] | null = null;
  private tagRowsCache_: Array<{ name: string; count?: number }> = [];

  private memoizedTagRows_(
    selected: string[],
    suggestions: McpTagSuggestion[]
  ): Array<{ name: string; count?: number }> {
    if (
      this.tagRowsCacheKey_ &&
      this.tagRowsCacheKey_[0] === selected &&
      this.tagRowsCacheKey_[1] === suggestions
    ) {
      return this.tagRowsCache_;
    }
    const suggestionNames = new Set(suggestions.map((s) => s.name));
    const rows: Array<{ name: string; count?: number }> = [];
    for (const name of selected) {
      if (!suggestionNames.has(name)) rows.push({ name });
    }
    for (const s of suggestions) rows.push(s);
    rows.sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.name.localeCompare(b.name));
    this.tagRowsCacheKey_ = [selected, suggestions];
    this.tagRowsCache_ = rows;
    return rows;
  }

  /** Debounce + fire a /mcp_tags fetch, wiring the response into
   *  tagSuggestions. Cancels any in-flight request via AbortController so a
   *  fast typist doesn't clobber a fresh response with a stale one. */
  private scheduleTagFetch_() {
    if (this.tagFetchTimer) window.clearTimeout(this.tagFetchTimer);
    this.tagFetchTimer = window.setTimeout(() => {
      this.tagFetchTimer = null;
      this.cancelTagFetch_();
      const controller = new AbortController();
      this.tagFetchController = controller;
      const query = this.state.tagQuery;
      const mode = this.state.mode;
      fetchMcpTags(query, { signal: controller.signal, limit: 100, mode })
        .then((items) => {
          if (this.tagFetchController !== controller) return;
          this.setState({ tagSuggestions: items });
        })
        .catch((err) => {
          // Stale request: newer fetch or cancellation already superseded us.
          if (this.tagFetchController !== controller) return;
          // Abort path: axios cancellation (get<T>() re-throws unchanged) OR
          // the mock's DOMException. Either way, silently drop.
          if (
            axios.isCancel(err) ||
            (err instanceof DOMException && err.name === "AbortError")
          ) {
            return;
          }
          // Surface the classified failure so the popover doesn't leave
          // stale suggestions on a real backend/network problem — matches
          // loadMore()'s Toast pattern one method away.
          Toast.error(t(mcpListErrorI18nKey(err)));
        });
    }, 160);
  }

  private cancelTagFetch_() {
    if (this.tagFetchTimer) {
      window.clearTimeout(this.tagFetchTimer);
      this.tagFetchTimer = null;
    }
    if (this.tagFetchController) {
      this.tagFetchController.abort();
      this.tagFetchController = null;
    }
  }

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
        tags: this.state.tagsSelected,
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
    // Snapshot the filter state by array reference — setState always allocates
    // a fresh array on toggle/clear, so an identity mismatch after the await
    // is a reliable "the user changed filters mid-request" signal. Avoids
    // `join(",")` collisions between e.g. ["v1.0,beta"] and ["v1.0","beta"]
    // (tags may themselves contain commas — see mcpListQuery.ts).
    const requestCategoriesRef = this.state.categoriesSelected;
    const requestTagsRef = this.state.tagsSelected;
    this.setState({ loadingMore: true });
    try {
      const fetcher = this.state.mode === "mine" ? fetchMcpMine : fetchMcpList;
      const resp = await fetcher({
        keyword: this.state.keyword,
        categories: this.state.categoriesSelected,
        tags: this.state.tagsSelected,
        limit: PAGE_SIZE,
        offset,
      });
      if (
        requestVersion !== this.requestVersion ||
        requestKeyword !== this.state.keyword ||
        requestCategoriesRef !== this.state.categoriesSelected ||
        requestTagsRef !== this.state.tagsSelected
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
    // Full reset — tag suggestions are mode-scoped on the backend (see
    // /mcp_tags?mode=mine), so keeping stale suggestions after a tab switch
    // paints suggestions the just-loaded list can't produce. Mirrors
    // handleSpaceChanged_ for the same reason.
    this.cancelTagFetch_();
    this.setState({
      mode,
      categoriesSelected: [],
      tagsSelected: [],
      tagFilterOpen: false,
      tagQuery: "",
      tagSuggestions: [],
    }, () => this.loadData());
  };

  /** Patch a single row after a successful edit — keeps scroll position
   *  intact (a full loadData() would reset offset to 0 and rebuild the grid).
   *  Category-pill counts may go slightly stale until the next full reload,
   *  which is an acceptable tradeoff for not losing the user's scroll spot.
   *  Also refreshes updatedAt + owner attribution so re-opening the detail
   *  modal doesn't show pre-edit metadata, and drops matchReasons since the
   *  edited fields may no longer align with the current search hit. */
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
        updatedAt: updated.updatedAt,
        createdByType: updated.createdByType,
        createdByBotName: updated.createdByBotName,
        matchReasons: undefined,
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

  /** Edit from a card. The list carries `McpListItem` (no quickStart/tools),
   *  but the shared create/edit modal is prefilled from `McpDetail`, so
   *  fetch the full row first. Toast on failure — do NOT silently open a
   *  half-empty modal. */
  private handleEditFromCard = async (item: McpListItem) => {
    try {
      const detail = await fetchMcpDetail(item.id);
      this.setState({ editingDetail: detail, createVisible: true });
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : t("mcp.edit.failed"));
    }
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

  /** Multi-tag filter — clicking a tag in the popover toggles membership.
   *  AND semantics: a row must carry every selected tag (mcp-v1.md §4.2).
   *  Refetches on every change; the tag popover stays open so the user can
   *  toggle several tags in one interaction. */
  private handleToggleTag = (tag: string) => {
    this.setState((prev) => ({
      tagsSelected: prev.tagsSelected.includes(tag)
        ? prev.tagsSelected.filter((t) => t !== tag)
        : [...prev.tagsSelected, tag],
    }), () => this.loadData());
  };

  private handleClearTags = () => {
    if (this.state.tagsSelected.length === 0) return;
    this.setState({ tagsSelected: [] }, () => this.loadData());
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
      tagsSelected,
      tagFilterOpen,
      mode,
      total,
      detailId,
      createVisible,
      editingDetail,
    } = this.state;

    // Tag popover options: backend-authoritative via /mcp_tags (mcp-v1.md
    // §4.8). Union with tagsSelected so a chip the user selected before the
    // fetch completes (or from a stale query) still shows up so they can
    // un-select it. Cached on the class instance keyed on the identity of
    // (tagsSelected, tagSuggestions) — recomputing the union+sort on every
    // parent re-render (keyword keystroke, hover, etc.) was measurable at
    // 100+ suggestions.
    const selectedNames = new Set<string>(tagsSelected);
    const tagRows = this.memoizedTagRows_(tagsSelected, this.state.tagSuggestions);

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
                <div className="wk-mcp-tag-filter" ref={this.tagFilterRef}>
                  <button
                    type="button"
                    className={
                      tagsSelected.length > 0
                        ? "wk-mcp-tag-filter__trigger is-active"
                        : "wk-mcp-tag-filter__trigger"
                    }
                    aria-expanded={tagFilterOpen}
                    aria-haspopup="listbox"
                    onClick={() =>
                      this.setState((prev) => ({
                        tagFilterOpen: !prev.tagFilterOpen,
                      }))
                    }
                  >
                    <SlidersHorizontal size={15} aria-hidden="true" />
                    {t("mcp.filter.tags")}
                    {tagsSelected.length > 0 && (
                      <span className="wk-mcp-tag-filter__count">
                        {tagsSelected.length}
                      </span>
                    )}
                  </button>
                  {tagFilterOpen && (
                    <div className="wk-mcp-tag-filter__popover">
                      <label className="wk-mcp-tag-filter__search">
                        <IconSearch aria-hidden />
                        <input
                          ref={this.tagSearchInputRef}
                          type="search"
                          value={this.state.tagQuery}
                          onChange={(e) => this.setState({ tagQuery: e.target.value })}
                          placeholder={t("mcp.filter.searchTags")}
                          aria-label={t("mcp.filter.searchTags")}
                        />
                      </label>
                      <div
                        className="wk-mcp-tag-filter__list"
                        role="listbox"
                        aria-label={t("mcp.filter.tags")}
                      >
                        {tagRows.length > 0 ? (
                          tagRows.map((row) => {
                            const selected = selectedNames.has(row.name);
                            return (
                              <button
                                key={row.name}
                                type="button"
                                className={
                                  selected
                                    ? "wk-mcp-tag-filter__option is-active"
                                    : "wk-mcp-tag-filter__option"
                                }
                                role="option"
                                aria-selected={selected}
                                title={row.name}
                                onClick={() => this.handleToggleTag(row.name)}
                              >
                                <span className="wk-mcp-tag-filter__check">
                                  {selected && (
                                    <Check size={15} aria-hidden="true" />
                                  )}
                                </span>
                                <span className="wk-mcp-tag-filter__option-name">{row.name}</span>
                              </button>
                            );
                          })
                        ) : (
                          <div className="wk-mcp-tag-filter__empty">
                            {t("mcp.filter.noTags")}
                          </div>
                        )}
                      </div>
                      <div className="wk-mcp-tag-filter__footer">
                        <span>
                          {tagsSelected.length > 0
                            ? t("mcp.filter.tagsSelected", {
                                values: { count: tagsSelected.length },
                              })
                            : t("mcp.filter.noTagsSelected")}
                        </span>
                        <button
                          type="button"
                          onClick={this.handleClearTags}
                          disabled={tagsSelected.length === 0}
                        >
                          {t("mcp.filter.clear")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
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
                          onEdit={canManage ? this.handleEditFromCard : undefined}
                          onDelete={
                            canManage
                              ? (it) => this.setState({ deletingItem: it })
                              : undefined
                          }
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
        <McpDeleteConfirmModal
          item={this.state.deletingItem}
          onClose={() => this.setState({ deletingItem: null })}
          onDeleted={(id) => {
            this.handleItemDeleted(id);
            Toast.success(t("mcp.delete.success"));
          }}
        />
      </div>
    );
  }
}
