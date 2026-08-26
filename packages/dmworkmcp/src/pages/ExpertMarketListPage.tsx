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
  listExpertCategories,
  listExperts,
  listMyExperts,
  listMySquads,
  listSquads,
  prefetchLoopTargets,
} from "../api/expertService";
import type { ExpertCatalogSort, ExpertCategoryCount } from "../api/expertService";
import { expertListErrorI18nKey } from "../api/expertListError";
import ExpertCard from "../components/ExpertCard";
import ExpertDetailModal from "../components/ExpertDetailModal";
import ExpertEditorPage from "./ExpertEditorPage";
import SquadEditorPage from "./SquadEditorPage";
import ExpertDeleteConfirmModal from "../components/ExpertDeleteConfirmModal";
import ExpertAddToLoopModal from "../components/ExpertAddToLoopModal";

type ExpertKind = "agent" | "squad" | "mine";

const TOAST_DURATION = 3000;
// The localized "all" chip / sentinel. Sourced from the shared category list
// (not a re-typed literal) so it stays in one place and out of the i18n scan.
const ALL_CATEGORY = EXPERT_CATEGORIES[0];
// Catalog lists are fetched with page_size=100 (expertService default); when the
// true total exceeds this the catalog is truncated and we surface a notice.
const LIST_PAGE_SIZE = 100;
// Catalog sort modes, mirroring the skill market's control: the backend orders
// the list (metric-backed modes rank by resource_metrics counters), the client
// only filters. `descending` adds the ↓ affordance on the count-based modes.
const SORT_OPTIONS: Array<{ value: ExpertCatalogSort; labelKey: string; descending?: boolean }> = [
  { value: "latest", labelKey: "mcp.expert.sortLatest" },
  { value: "installs", labelKey: "mcp.expert.sortHottest" },
];

/** Keyword match against name / summary / tags (all lower-cased upstream). */
function matchesQuery(item: ExpertItem, q: string): boolean {
  if (!q) return true;
  return (
    item.name.toLowerCase().includes(q) ||
    item.summary.toLowerCase().includes(q) ||
    item.tags.some((tag) => tag.toLowerCase().includes(q))
  );
}

/**
 * Expert Marketplace catalog — the third tab under 市场 (after MCP / Skills).
 * Data comes from the octo-marketplace expert catalog (expertService.ts): the
 * catalog list for the active kind (ordered server-side by the sort control,
 * mirroring the skill market's 综合/最新/安装/浏览 modes), the caller's own
 * records for the 我的 tab, and category chips with live counts. Keyword /
 * category / tag filtering stays client-side over the fetched arrays. Sub-tabs
 * switch between 专家 (single experts) and 专家团 (squads); 专家 is the default.
 * Clicking a card fetches the full detail (list items are projections) and
 * opens the shared detail modal.
 */
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
  const [deleteTarget, setDeleteTarget] = useState<ExpertItem | null>(null);
  const [addToLoopTarget, setAddToLoopTarget] = useState<ExpertItem | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState("");

  // Server-backed data — one array per catalog list, plus category counts.
  const [agentsData, setAgentsData] = useState<ExpertItem[]>([]);
  const [squadsData, setSquadsData] = useState<ExpertItem[]>([]);
  const [myAgentsData, setMyAgentsData] = useState<ExpertItem[]>([]);
  const [mySquadsData, setMySquadsData] = useState<ExpertItem[]>([]);
  // True totals behind the mine sections: the list fetch caps at
  // LIST_PAGE_SIZE, and 我的 is the only entry point to edit/delete, so a
  // silent cut at 100 would make older records unmanageable with no clue.
  const [myAgentsTotal, setMyAgentsTotal] = useState(0);
  const [mySquadsTotal, setMySquadsTotal] = useState(0);
  // True catalog totals per kind (the list fetch caps at PAGE_SIZE, so total can
  // exceed the loaded array length — see the truncation notice below).
  const [agentsTotal, setAgentsTotal] = useState(0);
  const [squadsTotal, setSquadsTotal] = useState(0);
  const [categories, setCategories] = useState<ExpertCategoryCount[]>([]);
  const [loading, setLoading] = useState(false);
  // Holds the i18n key for the specific load failure (auth / forbidden /
  // network / server / unknown), or null when the load succeeded. Lets the
  // error state show an actionable message instead of a single generic one.
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const toastTimerRef = useRef<number | null>(null);
  const tagFilterRef = useRef<HTMLDivElement | null>(null);
  // Monotonic request counter: each load() captures its version and bails after
  // every await if a newer load (kind switch / space-change reload) has started,
  // so a slow response can't overwrite the current tab's state. Mirrors
  // McpMarketListPage's requestVersion guard.
  const reqVer = useRef(0);
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const sortRef = useRef(sort);
  sortRef.current = sort;

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

  // Fetch the data backing the active tab. The catalog tabs (专家 / 专家团) load
  // the full kind list (ordered server-side by the active sort mode) + category
  // counts; the 我的 tab loads the caller's own experts and squads (rendered in
  // two sections). Keyword / category / tag filtering stays client-side over
  // the returned arrays.
  const load = useCallback(async (activeKind: ExpertKind, activeSort: ExpertCatalogSort) => {
    const v = ++reqVer.current;
    setLoading(true);
    setErrorKey(null);
    try {
      if (activeKind === "mine") {
        const [mine, minesq] = await Promise.all([listMyExperts(), listMySquads()]);
        if (v !== reqVer.current) return;
        setMyAgentsData(mine.items);
        setMyAgentsTotal(mine.total);
        setMySquadsData(minesq.items);
        setMySquadsTotal(minesq.total);
      } else if (activeKind === "squad") {
        const [list, cats] = await Promise.all([
          listSquads({ sort: activeSort }),
          listExpertCategories("squad"),
        ]);
        if (v !== reqVer.current) return;
        setSquadsData(list.items);
        setSquadsTotal(list.total);
        setCategories(cats);
      } else {
        const [list, cats] = await Promise.all([
          listExperts({ sort: activeSort }),
          listExpertCategories("agent"),
        ]);
        if (v !== reqVer.current) return;
        setAgentsData(list.items);
        setAgentsTotal(list.total);
        setCategories(cats);
      }
    } catch (err) {
      if (v !== reqVer.current) return;
      setErrorKey(expertListErrorI18nKey(err));
    } finally {
      if (v === reqVer.current) setLoading(false);
    }
  }, []);

  const reload = useCallback(
    () => load(kindRef.current, sortRef.current),
    [load]
  );

  // Load on mount and whenever the active tab or sort mode changes (ordering is
  // server-side, so a sort switch is a refetch).
  useEffect(() => {
    load(kind, sort);
  }, [kind, sort, load]);

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
      reload();
    };
    WKApp.mittBus.on("space-changed", handleSpaceChanged);
    return () => WKApp.mittBus.off("space-changed", handleSpaceChanged);
  }, [reload, loopOn]);

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

  // All tags in the current tab's catalog, de-duped and sorted, for the popover.
  const allTags = useMemo(() => {
    const source: ExpertItem[] = kind === "squad" ? squadsData : agentsData;
    const set = new Set<string>();
    source.forEach((item) => item.tags.forEach((tag) => set.add(tag)));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  }, [kind, squadsData, agentsData]);

  const visibleTags = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    if (!q) return allTags;
    return allTags.filter((tag) => tag.toLowerCase().includes(q));
  }, [allTags, tagQuery]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]
    );
  };

  const items = useMemo(() => {
    const source: ExpertItem[] = kind === "squad" ? squadsData : agentsData;
    const q = query.trim().toLowerCase();
    // The backend already ordered the list by the active sort mode; filtering
    // preserves that order.
    return source.filter((item) => {
      if (category !== ALL_CATEGORY && item.category !== category) return false;
      // Tag filter: item must carry EVERY selected tag (AND, matching the MCP
      // market's tag semantics).
      if (
        selectedTags.length &&
        !selectedTags.every((tag) => item.tags.includes(tag))
      ) {
        return false;
      }
      return matchesQuery(item, q);
    });
  }, [kind, category, query, squadsData, agentsData, selectedTags]);

  // Per-category counts for the filter chips, reflecting the active keyword /
  // tag filters (but not the selected category itself, so every chip shows how
  // many results choosing it would yield). "全部" holds the total.
  const categoryCounts = useMemo(() => {
    const source: ExpertItem[] = kind === "squad" ? squadsData : agentsData;
    const q = query.trim().toLowerCase();
    // With no keyword/tag filter active, use the authoritative server counts:
    // they cover the WHOLE catalog, while the loaded slice caps at
    // LIST_PAGE_SIZE — recomputing from the slice under-reports on a truncated
    // catalog and contradicts the header total rendered beside the chips.
    // Keyword/tag filtering is client-side over the slice, so once a filter is
    // active the recount below is the honest number for what choosing a chip
    // would actually yield.
    if (!q && selectedTags.length === 0 && categories.length) {
      const counts: Record<string, number> = {
        [ALL_CATEGORY]: kind === "squad" ? squadsTotal : agentsTotal,
      };
      for (const c of categories) counts[c.name] = c.count;
      return counts;
    }
    const base = source.filter((item) => {
      if (
        selectedTags.length &&
        !selectedTags.every((tag) => item.tags.includes(tag))
      ) {
        return false;
      }
      return matchesQuery(item, q);
    });
    const counts: Record<string, number> = { [ALL_CATEGORY]: base.length };
    for (const item of base) {
      counts[item.category] = (counts[item.category] ?? 0) + 1;
    }
    return counts;
  }, [kind, squadsData, agentsData, query, selectedTags, categories, squadsTotal, agentsTotal]);

  // 我的 tab: the caller's own experts / squads (GET /experts/mine +
  // /squads/mine). Only the keyword search applies here (the sort control and
  // category / tag filters are hidden in this tab); each kind gets its own
  // section, keeping the backend's newest-first order.
  const myAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    return myAgentsData.filter((item) => matchesQuery(item, q));
  }, [myAgentsData, query]);

  const mySquads = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mySquadsData.filter((item) => matchesQuery(item, q));
  }, [mySquadsData, query]);

  // The active catalog's true total vs. how many were actually loaded. The list
  // fetch caps at LIST_PAGE_SIZE, so when the total exceeds the loaded count the
  // catalog is truncated (client-side filtering only sees the loaded slice).
  const activeTotal = kind === "squad" ? squadsTotal : agentsTotal;
  const loadedCount = kind === "squad" ? squadsData.length : agentsData.length;
  const isTruncated = loadedCount < activeTotal;

  // The header count must not contradict the visible grid. Filtering is
  // client-side, so once a keyword / category / tag filter is active show how
  // many results are actually rendered (items.length); with no filter show the
  // backend catalog total (which may exceed the loaded slice — see the
  // truncation notice above).

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
    // Agents and squads both open their full-page editor.
    if (item.kind === "squad") {
      WKApp.routeRight.push(<SquadEditorPage mode="edit" squadId={item.id} />);
      return;
    }
    WKApp.routeRight.push(<ExpertEditorPage mode="edit" expertId={item.id} />);
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
          <div className="wk-mcp-expert-hero-title">
            <h1>{t("mcp.expert.pageTitle")}</h1>
            <p className="wk-mcp-expert-hero-subtitle">{t("mcp.expert.pageSubtitle")}</p>
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
                <X size={14} />
              </button>
            )}
            {kind !== "mine" && (
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
                    {visibleTags.length > 0 ? (
                      visibleTags.map((tag) => {
                        const active = selectedTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            type="button"
                            role="option"
                            aria-selected={active}
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
                      {selectedTags.length
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
            )}
          </div>
          {variant === "mine" && (
            <div className="wk-mcp-expert-publish">
              <WKButton
                variant="primary"
                icon={<Upload size={15} />}
                onClick={() =>
                  mineType === "squad"
                    ? WKApp.routeRight.push(<SquadEditorPage mode="create" />)
                    : WKApp.routeRight.push(<ExpertEditorPage mode="create" />)
                }
              >
                {mineType === "squad"
                  ? t("mcp.expert.publish")
                  : t("mcp.expert.publishAgent")}
              </WKButton>
            </div>
          )}
        </div>
      </header>

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
                <span className="wk-mcp-expert-category__count">
                  {categoryCounts[cat] ?? 0}
                </span>
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
              {mySquadsData.length < mySquadsTotal && (
                <p className="wk-mcp-expert-truncated" role="note">
                  {t("mcp.expert.truncatedNotice", {
                    values: { count: mySquadsData.length },
                  })}
                </p>
              )}
              {mySquads.length > 0 ? (
                <div className="wk-mcp-expert-grid">
                  {mySquads.map((item) => (
                    <ExpertCard
                      key={item.id}
                      item={item}
                      onOpen={openDetail}
                      onAddToLoop={loopOn ? openAddToLoop : undefined}
                      onEdit={handleEdit}
                      onDelete={setDeleteTarget}
                      showStats={variant === "mine"}
                    />
                  ))}
                </div>
              ) : (
                <p className="wk-mcp-expert-mine-empty">
                  {t("mcp.expert.mineSquadsEmpty")}
                </p>
              )}
            </section>
            )}
            {mineType !== "squad" && (
            <section className="wk-mcp-expert-mine-section">
              {!mineType && (
                <h2 className="wk-mcp-expert-mine-title">
                  <span>{t("mcp.expert.mineAgentsTitle")}</span>
                </h2>
              )}
              {myAgentsData.length < myAgentsTotal && (
                <p className="wk-mcp-expert-truncated" role="note">
                  {t("mcp.expert.truncatedNotice", {
                    values: { count: myAgentsData.length },
                  })}
                </p>
              )}
              {myAgents.length > 0 ? (
                <div className="wk-mcp-expert-grid">
                  {myAgents.map((item) => (
                    <ExpertCard
                      key={item.id}
                      item={item}
                      onOpen={openDetail}
                      onAddToLoop={loopOn ? openAddToLoop : undefined}
                      onEdit={handleEdit}
                      onDelete={setDeleteTarget}
                      showStats={variant === "mine"}
                    />
                  ))}
                </div>
              ) : (
                <p className="wk-mcp-expert-mine-empty">
                  {t("mcp.expert.mineAgentsEmpty")}
                </p>
              )}
            </section>
            )}
          </div>
        ) : (
          <>
            {isTruncated && (
              <p className="wk-mcp-expert-truncated" role="note">
                {t("mcp.expert.truncatedNotice", {
                  values: { count: LIST_PAGE_SIZE },
                })}
              </p>
            )}

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
          </>
        )}
      </main>

      <ExpertDetailModal
        item={selected}
        onClose={() => setSelected(null)}
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
