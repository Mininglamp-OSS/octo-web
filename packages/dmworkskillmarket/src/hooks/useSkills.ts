import { useCallback, useEffect, useRef, useState } from "react";
import { t, Dap } from "@octo/base";
import type { Category, Skill, SkillSort } from "../types/skill";
import { getCategories, getMySkills, getSkills } from "../api/skillApi";

interface UseSkillsOptions {
  mine?: boolean;
  selectedTags?: string[];
  sort?: SkillSort;
}

export interface UseSkillsResult {
  categories: Category[];
  skills: Skill[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  query: string;
  categoryId: string;
  hasMore: boolean;
  setQuery: (query: string) => void;
  setCategoryId: (categoryId: string) => void;
  refresh: () => void;
  loadMore: () => void;
}

export function useSkills(options: UseSkillsOptions = {}): UseSkillsResult {
  const selectedTags = options.selectedTags ?? [];
  const sort = options.sort ?? "comprehensive";
  const tagKey = selectedTags.join("\u0001");
  const [categories, setCategories] = useState<Category[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQueryState] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [categoryId, setCategoryIdState] = useState("all");
  // Total visible rows for the synthetic "all" chip. It must come from the list
  // total, not the sum of category counts: uncategorized plugins are visible in
  // the catalog but belong to no category, so the sum undercounts them.
  const allSkillCountRef = useRef(0);
  const refreshNonceRef = useRef(0);
  const lastCountProbeNonceRef = useRef(-1);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // market_searched 需带 has_result(结果计数),而检索的 debounce 与结果 fetch 解耦在两个 effect。
  // DAP-271 finding 3：按 **query identity** 管理待上报状态——记录「待上报的检索词」,仅当某次首页
  // fetch 用的正是该检索词且成功时消费一次。失败/取消/清空/被新检索词替换时相应清除或改写,避免把
  // 普通列表(清空关键词)或另一条检索误记成本次检索成功。null 表示当前无待上报检索。绝不采 keyword 文本。
  const pendingSearchQueryRef = useRef<string | null>(null);

  const fetchPage = useCallback(
    async (nextCursor?: string | null) => {
      // Cancel any in-flight request
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const isMore = Boolean(nextCursor);
      if (isMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const signal = controller.signal;
        const [categoryItems, page] = await Promise.all([
          getCategories({ signal }),
          options.mine
            ? getMySkills(
                {
                  q: debouncedQuery,
                  categoryId,
                  tags: selectedTags,
                  sort,
                  cursor: nextCursor ?? undefined,
                  limit: 20,
                },
                { signal }
              )
            : getSkills(
                {
                  q: debouncedQuery,
                  categoryId,
                  tags: selectedTags,
                  sort,
                  cursor: nextCursor ?? undefined,
                  limit: 20,
                },
                { signal }
              ),
        ]);
        // The unfiltered total is decorative (the 全部 chip); fetch it after the
        // list so its failure can never take down the catalog.
        // Refresh (including a Space change) must refresh the summary even when
        // a search/tag filter is active. Ordinary filter changes reuse the
        // same-scope cache; a filtered page.total must never replace it.
        const forceCountRefresh =
          refreshNonceRef.current !== lastCountProbeNonceRef.current;
        const unfilteredPage =
          !debouncedQuery.trim() &&
          selectedTags.length === 0 &&
          categoryId === "all";
        const shouldProbeAllCount =
          !isMore && (forceCountRefresh || unfilteredPage);
        const allPage = shouldProbeAllCount
          ? await (options.mine
              ? getMySkills({ limit: 1 }, { signal })
              : getSkills({ limit: 1 }, { signal })
            )
              .then((p) => p?.total ?? null)
              .catch(() => null)
          : null;
        if (controller.signal.aborted) return;
        if (allPage !== null) {
          allSkillCountRef.current = allPage;
          lastCountProbeNonceRef.current = refreshNonceRef.current;
        } else if (shouldProbeAllCount && unfilteredPage && !isMore) {
          // Count request failed; the unfiltered page already knows the total.
          allSkillCountRef.current = page.total;
          lastCountProbeNonceRef.current = refreshNonceRef.current;
        }
        const effectiveAllCount = allPage ?? allSkillCountRef.current;
        const normalizedCategories = [
          {
            id: "all",
            // Display goes through i18n; matching is keyed on id === "all"
            // only so an English-locale user does not see 中文 and the
            // filter no longer couples to a translation string.
            name: t("skillMarket.category.all"),
            iconKey: "LayoutGrid",
            sortOrder: 0,
            skillCount: effectiveAllCount,
          },
          ...categoryItems.filter((category) => category.id !== "all"),
        ];
        const selectableCategories = normalizedCategories.filter(
          (category) => category.id === "all" || category.skillCount > 0
        );
        if (
          categoryId !== "all" &&
          !selectableCategories.some((category) => category.id === categoryId)
        ) {
          setCategoryIdState("all");
        }
        setCategories(normalizedCategories);
        setSkills((current: Skill[]) =>
          isMore ? [...current, ...page.items] : page.items
        );
        setTotal(page.total);
        setCursor(page.nextCursor);
        // 检索触发的首页拉取成功后发 market_searched(market_type='skill'),带 has_result。
        // DAP-271 finding 3：仅首页(!isMore)、且本次 fetch 用的检索词(debouncedQuery)正是待上报的检索词
        // (query identity 匹配)时消费一次;分类/标签/加载更多、以及清空关键词后的普通列表 fetch 都不发。
        if (
          !isMore &&
          pendingSearchQueryRef.current !== null &&
          pendingSearchQueryRef.current === debouncedQuery
        ) {
          pendingSearchQueryRef.current = null;
          Dap.shared.track("market_searched", {
            market_type: "skill",
            has_result: page.total > 0,
          });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        // DAP-271 finding 3：本次检索请求失败——清除对应待上报标记,避免清空关键词后普通列表成功被误记
        //   成本次检索成功。仅清除与当前失败 fetch 检索词一致的标记(被更新检索词替换的场景已由上面
        //   的 identity 匹配天然隔离)。
        if (pendingSearchQueryRef.current === debouncedQuery) {
          pendingSearchQueryRef.current = null;
        }
        setError(
          err instanceof Error
            ? err.message
            : t("skillMarket.common.loadFailed")
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [categoryId, debouncedQuery, options.mine, sort, tagKey]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query);
      // 埋点 317:market_searched 移到结果 fetch 返回后再发,以带 has_result。这里按 query identity 记录
      // 待上报的检索词,由 debouncedQuery 变化触发的下一次首页 fetch 成功后消费(见 fetchPage)。
      // DAP-271 finding 3：清空关键词(trim 为空)时清除待上报标记——清空后的普通列表 fetch 不得发
      //   market_searched;非空检索词则记录该词本身以做后续 identity 匹配。绝不采 keyword 文本。
      const trimmed = query.trim();
      pendingSearchQueryRef.current = trimmed ? query : null;
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    void fetchPage(null);
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchPage]);

  const setQuery = useCallback((value: string) => {
    setQueryState(value);
    setSkills([]);
    setCursor(null);
    setLoading(true);
  }, []);

  const setCategoryId = useCallback((value: string) => {
    setCategoryIdState(value);
    setSkills([]);
    setCursor(null);
    setLoading(true);
  }, []);

  return {
    categories,
    skills,
    total,
    loading,
    loadingMore,
    error,
    query,
    categoryId,
    hasMore: Boolean(cursor),
    setQuery,
    setCategoryId,
    refresh: () => {
      // Force the next fetch to re-probe the unfiltered total (Space change or
      // an explicit refresh) even while a filter is active.
      refreshNonceRef.current += 1;
      void fetchPage(null);
    },
    loadMore: () => {
      if (!cursor || loading || loadingMore) return;
      void fetchPage(cursor);
    },
  };
}
