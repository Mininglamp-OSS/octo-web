import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, Check, HelpCircle, PackageOpen, Search, SlidersHorizontal, Upload, X } from "lucide-react";
import { Toast, Tooltip } from "@douyinfe/semi-ui";
import { t, useI18n, WKApp, WKButton } from "@octo/base";
import { EXPERT_CATEGORIES } from "../mock/expertMock";
import type { ExpertItem } from "../mock/expertMock";
import {
  clearLoopCache,
  deleteExpert,
  deleteSquad,
  getExpert,
  getSquad,
  prefetchLoopTargets,
} from "../api/expertService";
import type { ExpertCatalogSort } from "../api/expertService";
import { useExpertCatalog } from "../bridge/useExpertCatalog";
import ExpertCard from "../components/ExpertCard";
import ExpertDetailModal from "../components/ExpertDetailModal";
import ExpertBotPublishModal from "../components/ExpertBotPublishModal";
import ExpertDeleteConfirmModal from "../components/ExpertDeleteConfirmModal";
import ExpertAddToLoopModal from "../components/ExpertAddToLoopModal";
import { MineTable } from "@dmwork/skillmarket";
import { getMcpAvatarColor } from "../utils/mcpAvatar";
import { normalizeVisibility } from "../utils/visibility";

type ExpertKind = "agent" | "squad" | "mine";

const TOAST_DURATION = 3000;
// The unified catalog accepts at most 20 AND-combined tag filters.
const MAX_SELECTED_TAGS = 20;
// The localized "all" chip / sentinel. Sourced from the shared category list
// (not a re-typed literal) so it stays in one place and out of the i18n scan.
const ALL_CATEGORY = EXPERT_CATEGORIES[0];
// Ordering and filtering both apply on the server before pagination.
const SORT_OPTIONS: Array<{ value: ExpertCatalogSort; labelKey: string; descending?: boolean }> = [
  { value: "latest", labelKey: "mcp.expert.sortLatest" },
  { value: "installs", labelKey: "mcp.expert.sortHottest" },
];

/**
 * Rendering variant. "market" (default) = discovery catalog (专家/专家团 tabs).
 * "mine" = personal assets mounted inside MyAssetsPage — forces the mine view,
 * hides the in-page tab strip + hero title. `mineType` narrows the mine view to
 * a single section so MyAssetsPage can split 专家 / 专家团 into their own tabs;
 * omitted = both sections stacked.
 */
interface ExpertMarketListPageProps {
  variant?: "market" | "mine";
  mineType?: "agent" | "squad";
}

export default function ExpertMarketListPage({
  variant = "market",
  mineType,
}: ExpertMarketListPageProps = {}) {
  useI18n();
  // Loop(回路) feature gate. The install flow (添加到回路), its explainer, and the
  // Loop-target prefetch all depend on octo-fleet being deployed; until ops flips
  // dmloop_on this UI must stay hidden so the feature can land on main "dark"
  // (mirrors the driveOn / docs_on pattern in dmworkbase). When off, cards get no
  // onAddToLoop (ExpertCard then hides the button) and we skip the fleet prefetch.
  const loopOn = WKApp.remoteConfig?.dmloopOn ?? false;
  // appconfig is fetched asynchronously, so at mount dmloopOn is usually still
  // its default false. Re-render when the first load resolves (addListener) and
  // on later ops flips (addConfigChangeListener) so the Loop UI appears/disappears
  // the moment the flag does — same seam DriveModule / dmworkbase Messages/File use.
  const [, setConfigRevision] = useState(0);
  useEffect(() => {
    const rc = WKApp.remoteConfig;
    if (!rc) return;
    const bump = () => setConfigRevision((n) => n + 1);
    const unsubscribers = [
      ...(rc.requestSuccess ? [] : [rc.addListener(bump)]),
      rc.addConfigChangeListener(bump),
    ];
    return () => {
      for (const unsub of unsubscribers) unsub();
    };
  }, []);
  const [kind, setKind] = useState<ExpertKind>(
    variant === "mine" ? "mine" : "agent"
  );
  const [category, setCategory] = useState<string>(ALL_CATEGORY);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ExpertCatalogSort>("latest");
  const [selected, setSelected] = useState<ExpertItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** Bot-authored create/update flow (the previous version): create opens the
   *  publish prompt; editTarget drives the update prompt for an existing record. */
  const [botPublishOpen, setBotPublishOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<
    { id: string; kind: "agent" | "squad" } | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<ExpertItem | null>(null);
  const [addToLoopTarget, setAddToLoopTarget] = useState<ExpertItem | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState("");

  const [scopeRevision, setScopeRevision] = useState(0);
  const catalogOptions = {
    mine: kind === "mine",
    keyword: query,
    category: kind === "mine" ? undefined : category,
    tags: selectedTags,
    sort,
    scopeRevision,
    tagKeyword: tagQuery,
  };
  const agents = useExpertCatalog({
    ...catalogOptions,
    kind: "agent",
    enabled: kind === "agent" || (kind === "mine" && mineType !== "squad"),
  });
  const squads = useExpertCatalog({
    ...catalogOptions,
    kind: "squad",
    enabled: kind === "squad" || (kind === "mine" && mineType !== "agent"),
  });
  const activeCatalog = kind === "squad" ? squads : agents;
  const categories = activeCatalog.categories;
  const items = activeCatalog.items;
  const myAgents = agents.items;
  const mySquads = squads.items;
  const loading = agents.loading || squads.loading;
  const errorKey = agents.errorKey || squads.errorKey;
  const tagsLoading = agents.tagsLoading || squads.tagsLoading;
  const tagsErrorKey = agents.tagsErrorKey || squads.tagsErrorKey;
  const reloadAgents = agents.reload;
  const reloadSquads = squads.reload;
  const reload = useCallback(() => {
    reloadAgents();
    reloadSquads();
  }, [reloadAgents, reloadSquads]);

  const toastTimerRef = useRef<number | null>(null);
  const tagFilterRef = useRef<HTMLDivElement | null>(null);
  const showToast = (message: string) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, TOAST_DURATION);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Warm the Loop workspace/runtime lists on mount so the "添加到回路" dialog opens
  // with its selects already populated instead of waiting on two sequential
  // fleet round-trips at open time. Fire-and-forget; the dialog still fetches
  // (cache-hit) on real open.
  useEffect(() => {
    if (loopOn) prefetchLoopTargets();
  }, [loopOn]);

  // Reset transient UI + filters and reload on space switch, matching the other
  // market pages (visibility/ownership is Space-scoped on the backend).
  useEffect(() => {
    const handleSpaceChanged = () => {
      setSelected(null);
      setBotPublishOpen(false);
      setEditTarget(null);
      setDeleteTarget(null);
      setAddToLoopTarget(null);
      setQuery("");
      setCategory(ALL_CATEGORY);
      setSelectedTags([]);
      setTagFilterOpen(false);
      setTagQuery("");
      // Loop targets are Space-scoped: drop the old Space's cache and warm the
      // new one so the dialog stays instant after a switch.
      clearLoopCache();
      if (loopOn) prefetchLoopTargets();
      setScopeRevision((value) => value + 1);
    };
    WKApp.mittBus.on("space-changed", handleSpaceChanged);
    return () => WKApp.mittBus.off("space-changed", handleSpaceChanged);
  }, [loopOn]);

  // Tags and categories are catalog-specific, so switching the 专家 / 专家团 tab
  // clears any active tag filter (a squad tag rarely matches an agent, and vice
  // versa) AND the category: a carried-over category may not exist in the new
  // kind's category set, which would filter the list down to empty while no
  // chip renders as active — an empty catalog with no visible reason.
  useEffect(() => {
    setCategory(ALL_CATEGORY);
    setSelectedTags([]);
    setTagFilterOpen(false);
    setTagQuery("");
  }, [kind]);

  // Dismiss the tag-filter popover on outside click / Escape.
  useEffect(() => {
    if (!tagFilterOpen) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!tagFilterRef.current?.contains(event.target as Node)) {
        setTagFilterOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTagFilterOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [tagFilterOpen]);

  // Category chips: 全部 sentinel first, then the fetched category set (or the
  // static fallback, which already includes 全部).
  const categoryChips = useMemo(() => {
    if (categories.length) return [ALL_CATEGORY, ...categories.map((c) => c.name)];
    return EXPERT_CATEGORIES;
  }, [categories]);

  // The scoped tag endpoint includes tags on records beyond the loaded page.
  const allTags = useMemo(() => {
    const tags = kind === "mine" ? [...agents.tags, ...squads.tags] : activeCatalog.tags;
    return Array.from(new Set([...tags, ...selectedTags])).sort((a, b) => a.localeCompare(b));
  }, [kind, agents.tags, squads.tags, activeCatalog.tags, selectedTags]);

  const visibleTags = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    if (!q) return allTags;
    return allTags.filter((tag) => tag.toLowerCase().includes(q));
  }, [allTags, tagQuery]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((x) => x !== tag) : prev.length < MAX_SELECTED_TAGS ? [...prev, tag] : prev
    );
  };

  // Category counts are unfiltered server aggregates. Suppress them during
  // keyword/tag search: recounting the loaded page would under-report results.
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (query.trim() || selectedTags.length || loading || errorKey) return counts;
    for (const item of categories) counts[item.name] = item.count;
    if (category === ALL_CATEGORY) counts[ALL_CATEGORY] = activeCatalog.total;
    return counts;
  }, [query, selectedTags, loading, errorKey, categories, category, activeCatalog.total]);

  const renderPagination = (catalog: typeof agents) => (
    <div className="wk-mcp-expert-pagination">
      <span role="status">
        {t("mcp.expert.loadedCount", {
          values: { count: catalog.items.length, total: catalog.total },
        })}
      </span>
      {catalog.moreErrorKey && <span role="alert">{t(catalog.moreErrorKey)}</span>}
      {catalog.hasMore && (
        <WKButton
          variant="secondary"
          disabled={catalog.loadingMore}
          onClick={() => catalog.loadMore()}
        >
          {t(catalog.loadingMore ? "mcp.expert.loading" : catalog.moreErrorKey ? "mcp.list.retry" : "mcp.expert.loadMore")}
        </WKButton>
      )}
    </div>
  );

  // List items are projections — fetch the full detail before opening the
  // detail modal / install prompt / editor so members, instruction, mcpConfig
  // and skills are present.
  const hydrate = useCallback(
    (item: ExpertItem): Promise<ExpertItem> =>
      item.kind === "squad" ? getSquad(item.id) : getExpert(item.id),
    []
  );

  const openDetail = async (item: ExpertItem) => {
    // Open immediately with the list item so the click feels instant (a
    // setState after `await` is a promise continuation that React 17 does not
    // flush until the next event — the modal would otherwise open one click
    // late). Then hydrate the full record (instruction / members / …) and swap
    // it in, guarding against the user having closed or switched target.
    setSelected(item);
    try {
      const full = await hydrate(item);
      setSelected((cur) => (cur && cur.id === item.id ? full : cur));
    } catch {
      showToast(t("mcp.expert.loadError"));
    }
  };

  // Add-to-Loop: the marketplace backend reads the full spec by id, so no
  // client-side hydrate is needed — we only need the id + name to display and to
  // fire the install call. For a squad this provisions the member agents + team;
  // for an expert, a single agent.
  const openAddToLoop = (item: ExpertItem) => {
    setAddToLoopTarget(item);
  };

  // -------- 我的 tab manage actions (edit / delete) --------
  // Edit hands a Bot the marketplace "update" prompt for this listing (carrying
  // its id); the Bot performs the update via octo-cli. Only id + kind are
  // needed here — the Bot reads the current record and asks the user for the
  // fields to change, so no hydrate is required.
  const handleEdit = (item: ExpertItem) => {
    // Edit via the Bot update prompt (previous version) — the Bot reads the
    // current record and asks for the fields to change.
    setEditTarget({ id: item.id, kind: item.kind === "squad" ? "squad" : "agent" });
  };

  const handleConfirmDelete = async (id: string) => {
    const isSquad = deleteTarget?.kind === "squad";
    try {
      if (isSquad) {
        await deleteSquad(id);
      } else {
        await deleteExpert(id);
      }
      await reload();
      Toast.success(t("mcp.expert.deleteSuccess"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("mcp.expert.loadError"));
    }
  };

  const searchPlaceholder =
    kind === "squad"
      ? t("mcp.expert.searchPlaceholderSquad")
      : kind === "agent"
        ? t("mcp.expert.searchPlaceholderAgent")
        : t("mcp.expert.searchPlaceholder");

  return (
    <div className="wk-mcp-expert-page">
      <header className="wk-mcp-expert-topbar">
        {variant !== "mine" && (
          <div className="wk-mcp-expert-topbar__left">
            <nav className="wk-mcp-expert-tabs" aria-label={t("mcp.expert.navAriaLabel")}>
              <button
                type="button"
                className={kind === "agent" ? "is-active" : ""}
                onClick={() => setKind("agent")}
              >
                {t("mcp.expert.typeAgent")}
              </button>
              <button
                type="button"
                className={kind === "squad" ? "is-active" : ""}
                onClick={() => setKind("squad")}
              >
                {t("mcp.expert.typeSquad")}
              </button>
            </nav>
            {loopOn && (
              <Tooltip
                content={t("mcp.expert.loopIntro")}
                className="wk-mcp-tooltip-light"
                mouseEnterDelay={100}
                position="bottomLeft"
              >
                <button
                  type="button"
                  className="wk-mcp-expert-help"
                  aria-label={t("mcp.expert.loopIntro")}
                >
                  <HelpCircle size={16} aria-hidden="true" />
                </button>
              </Tooltip>
            )}
          </div>
        )}
        <div className="wk-mcp-expert-topbar__actions">
          <div className="wk-mcp-expert-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder={searchPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={searchPlaceholder}
            />
            {query && (
              <button
                type="button"
                className="wk-mcp-expert-search__clear"
                aria-label={t("mcp.expert.searchClear")}
                onClick={() => setQuery("")}
              >
                <X size={18} />
              </button>
            )}
              <div className="wk-mcp-expert-tagfilter" ref={tagFilterRef}>
              <button
                type="button"
                className={
                  selectedTags.length
                    ? "wk-mcp-expert-tagfilter__toggle is-active"
                    : "wk-mcp-expert-tagfilter__toggle"
                }
                aria-haspopup="listbox"
                aria-expanded={tagFilterOpen}
                onClick={() => setTagFilterOpen((open) => !open)}
              >
                <SlidersHorizontal size={15} aria-hidden="true" />
                <span>{t("mcp.expert.tagFilter")}</span>
                {selectedTags.length > 0 && (
                  <span className="wk-mcp-expert-tagfilter__count">
                    {selectedTags.length}
                  </span>
                )}
              </button>
              {tagFilterOpen && (
                <div className="wk-mcp-expert-tagfilter__popover">
                  <label className="wk-mcp-expert-tagfilter__search">
                    <Search size={16} aria-hidden="true" />
                    <input
                      type="search"
                      autoFocus
                      value={tagQuery}
                      placeholder={t("mcp.expert.tagSearchPlaceholder")}
                      onChange={(event) => setTagQuery(event.target.value)}
                      aria-label={t("mcp.expert.tagSearchPlaceholder")}
                    />
                  </label>
                  <div
                    className="wk-mcp-expert-tagfilter__list"
                    role="listbox"
                    aria-label={t("mcp.expert.tagFilter")}
                  >
                    {tagsLoading ? (
                      <div className="wk-mcp-expert-tagfilter__empty" role="status">{t("mcp.expert.loading")}</div>
                    ) : tagsErrorKey ? (
                      <div className="wk-mcp-expert-tagfilter__empty" role="alert">
                        <p>{t(tagsErrorKey)}</p>
                        <WKButton onClick={() => { agents.reloadTags(); squads.reloadTags(); }}>{t("mcp.list.retry")}</WKButton>
                      </div>
                    ) : visibleTags.length > 0 ? (
                      visibleTags.map((tag) => {
                        const active = selectedTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            type="button"
                            role="option"
                            aria-selected={active}
                            disabled={!active && selectedTags.length >= MAX_SELECTED_TAGS}
                            title={tag}
                            className={
                              active
                                ? "wk-mcp-expert-tagfilter__option is-active"
                                : "wk-mcp-expert-tagfilter__option"
                            }
                            onClick={() => toggleTag(tag)}
                          >
                            <span className="wk-mcp-expert-tagfilter__check">
                              {active && <Check size={15} aria-hidden="true" />}
                            </span>
                            <span>{tag}</span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="wk-mcp-expert-tagfilter__empty">
                        {t("mcp.expert.tagEmpty")}
                      </div>
                    )}
                  </div>
                  <div className="wk-mcp-expert-tagfilter__footer">
                    <span>
                      {selectedTags.length >= MAX_SELECTED_TAGS
                        ? t("mcp.expert.tagLimit", { values: { count: MAX_SELECTED_TAGS } })
                        : selectedTags.length
                        ? t("mcp.expert.tagSelectedCount", {
                            values: { count: selectedTags.length },
                          })
                        : t("mcp.expert.tagNoneSelected")}
                    </span>
                    <button
                      type="button"
                      className="wk-mcp-expert-tagfilter__clear"
                      disabled={!selectedTags.length}
                      onClick={() => setSelectedTags([])}
                    >
                      {t("mcp.expert.tagClear")}
                    </button>
                  </div>
                </div>
              )}
              </div>
          </div>
          {variant === "mine" && (
            <div className="wk-mcp-expert-publish">
              <WKButton
                variant="primary"
                icon={<Upload size={15} />}
                onClick={() => setBotPublishOpen(true)}
              >
                {mineType === "squad"
                  ? t("mcp.expert.publish")
                  : t("mcp.expert.publishAgent")}
              </WKButton>
            </div>
          )}
        </div>
      </header>

      {kind !== "mine" && (
        <section className="wk-mcp-expert-filter-bar">
          <div className="wk-mcp-expert-categories">
            {categoryChips.map((cat) => (
              <button
                key={cat}
                type="button"
                className="wk-mcp-expert-category"
                aria-pressed={category === cat}
                onClick={() => setCategory(cat)}
              >
                {cat === ALL_CATEGORY ? t("mcp.expert.categoryAll") : cat}
                {categoryCounts[cat] !== undefined && (
                  <span className="wk-mcp-expert-category__count">
                    {categoryCounts[cat]}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="wk-mcp-expert-sort" aria-label={t("mcp.expert.sortAriaLabel")}>
            <div className="wk-mcp-expert-sort__options">
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={sort === option.value ? "is-active" : ""}
                  aria-pressed={sort === option.value}
                  onClick={() => setSort(option.value)}
                >
                  <span>{t(option.labelKey)}</span>
                  {option.descending && <ArrowDown size={12} aria-hidden="true" />}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      <main className="wk-mcp-expert-content">
        {loading ? (
          <div className="wk-mcp-expert-empty">
            <strong>{t("mcp.expert.loading")}</strong>
          </div>
        ) : errorKey ? (
          <div className="wk-mcp-expert-empty">
            <PackageOpen size={48} aria-hidden="true" />
            <strong>{t(errorKey)}</strong>
            <WKButton variant="primary" onClick={() => reload()}>
              {t("mcp.list.retry")}
            </WKButton>
          </div>
        ) : kind === "mine" ? (
          <div className="wk-mcp-expert-mine">
            {mineType !== "agent" && (
            <section className="wk-mcp-expert-mine-section">
              {!mineType && (
                <h2 className="wk-mcp-expert-mine-title">
                  <span>{t("mcp.expert.mineSquadsTitle")}</span>
                </h2>
              )}
              {mySquads.length > 0 ? (
                <MineTable
                  rows={mySquads.map((item) => ({
                    id: item.id,
                    type: "squad" as const,
                    trackItemType: "expert",
                    icon: (
                      <span
                        className="wk-mine-table__avatar-tile"
                        style={{ background: getMcpAvatarColor(item.id) }}
                      >
                        {item.shortName}
                      </span>
                    ),
                    name: item.name,
                    description: item.summary,
                    category: item.category,
                    version: item.version,
                    visibility: normalizeVisibility(item.visibility),
                    views: item.viewCount,
                    downloads: item.installCount,
                    ariaLabel: item.name,
                    onOpen: () => openDetail(item),
                    onEdit: () => handleEdit(item),
                    onDelete: () => setDeleteTarget(item),
                    editAria: t("mcp.expert.editAriaLabel", { values: { name: item.name } }),
                    deleteAria: t("mcp.expert.deleteAriaLabel", { values: { name: item.name } }),
                  }))}
                  visibilityLabel={(v) => t(`mcp.visibility.${v}`)}
                />
              ) : (
                <p className="wk-mcp-expert-mine-empty">
                  {t("mcp.expert.mineSquadsEmpty")}
                </p>
              )}
              {renderPagination(squads)}
            </section>
            )}
            {mineType !== "squad" && (
            <section className="wk-mcp-expert-mine-section">
              {!mineType && (
                <h2 className="wk-mcp-expert-mine-title">
                  <span>{t("mcp.expert.mineAgentsTitle")}</span>
                </h2>
              )}
              {myAgents.length > 0 ? (
                <MineTable
                  rows={myAgents.map((item) => ({
                    id: item.id,
                    type: "expert" as const,
                    trackItemType: "expert",
                    icon: (
                      <span
                        className="wk-mine-table__avatar-tile"
                        style={{ background: getMcpAvatarColor(item.id) }}
                      >
                        {item.shortName}
                      </span>
                    ),
                    name: item.name,
                    description: item.summary,
                    category: item.category,
                    version: item.version,
                    visibility: normalizeVisibility(item.visibility),
                    views: item.viewCount,
                    downloads: item.installCount,
                    ariaLabel: item.name,
                    onOpen: () => openDetail(item),
                    onEdit: () => handleEdit(item),
                    onDelete: () => setDeleteTarget(item),
                    editAria: t("mcp.expert.editAriaLabel", { values: { name: item.name } }),
                    deleteAria: t("mcp.expert.deleteAriaLabel", { values: { name: item.name } }),
                  }))}
                  visibilityLabel={(v) => t(`mcp.visibility.${v}`)}
                />
              ) : (
                <p className="wk-mcp-expert-mine-empty">
                  {t("mcp.expert.mineAgentsEmpty")}
                </p>
              )}
              {renderPagination(agents)}
            </section>
            )}
          </div>
        ) : (
          <>
            {items.length > 0 ? (
              <div className="wk-mcp-expert-grid">
                {items.map((item) => (
                  <ExpertCard
                    key={item.id}
                    item={item}
                    onOpen={openDetail}
                    onAddToLoop={loopOn ? openAddToLoop : undefined}
                    showStats={variant === "mine"}
                  />
                ))}
              </div>
            ) : (
              <div className="wk-mcp-expert-empty">
                <PackageOpen size={48} aria-hidden="true" />
                <strong>{t("mcp.expert.empty")}</strong>
                <p>{t("mcp.expert.emptyHint")}</p>
                {(query || category !== ALL_CATEGORY || selectedTags.length > 0) && (
                  <WKButton
                    variant="primary"
                    onClick={() => {
                      setQuery("");
                      setCategory(ALL_CATEGORY);
                      setSelectedTags([]);
                      setTagQuery("");
                    }}
                  >
                    {t("mcp.expert.resetFilters")}
                  </WKButton>
                )}
              </div>
            )}
            {renderPagination(activeCatalog)}
          </>
        )}
      </main>

      <ExpertDetailModal
        item={selected}
        onClose={() => setSelected(null)}
      />
      <ExpertBotPublishModal
        visible={botPublishOpen}
        kind={mineType === "squad" ? "squad" : "agent"}
        mode="create"
        onClose={() => setBotPublishOpen(false)}
        onToast={showToast}
      />
      <ExpertBotPublishModal
        visible={Boolean(editTarget)}
        kind={editTarget?.kind ?? "agent"}
        mode="update"
        editingId={editTarget?.id}
        onClose={() => setEditTarget(null)}
        onToast={showToast}
      />
      <ExpertDeleteConfirmModal
        item={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
      <ExpertAddToLoopModal
        key={addToLoopTarget?.id ?? "none"}
        item={addToLoopTarget}
        onClose={() => setAddToLoopTarget(null)}
      />

      {toast &&
        createPortal(
          <div className="wk-mcp-expert-toast" role="status">
            {toast}
          </div>,
          document.body
        )}
    </div>
  );
}
