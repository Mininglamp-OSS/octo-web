import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@octo/base";
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
  markSkillViewed: (skillId: string) => void;
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
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
        if (controller.signal.aborted) return;
        const normalizedCategories = [
          {
            id: "all",
            // Display goes through i18n; matching is keyed on id === "all"
            // only so an English-locale user does not see 中文 and the
            // filter no longer couples to a translation string.
            name: t("skillMarket.category.all"),
            iconKey: "LayoutGrid",
            sortOrder: 0,
            skillCount: categoryItems.reduce(
              (total, category) =>
                category.id === "all"
                  ? total
                  : total + (category.skillCount ?? 0),
              0
            ),
          },
          ...categoryItems.filter((category) => category.id !== "all"),
        ];
        if (
          categoryId !== "all" &&
          !normalizedCategories.some((category) => category.id === categoryId)
        ) {
          setCategoryIdState("all");
        }
        setCategories(normalizedCategories);
        setSkills((current: Skill[]) =>
          isMore ? [...current, ...page.items] : page.items
        );
        setTotal(page.total);
        setCursor(page.nextCursor);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
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

  const markSkillViewed = useCallback((skillId: string) => {
    setSkills((current) =>
      current.map((skill) =>
        skill.id === skillId
          ? { ...skill, viewCount: (skill.viewCount ?? 0) + 1 }
          : skill
      )
    );
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
    markSkillViewed,
    refresh: () => void fetchPage(null),
    loadMore: () => {
      if (!cursor || loading || loadingMore) return;
      void fetchPage(cursor);
    },
  };
}
