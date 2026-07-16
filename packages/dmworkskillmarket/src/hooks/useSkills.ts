import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@octo/base";
import type { Category, Skill } from "../types/skill";
import { getCategories, getMySkills, getSkills } from "../api/skillApi";

interface UseSkillsOptions {
  mine?: boolean;
}

export interface UseSkillsResult {
  categories: Category[];
  skills: Skill[];
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
  const [categories, setCategories] = useState<Category[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
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
            ? getMySkills({ q: debouncedQuery, categoryId, cursor: nextCursor ?? undefined, limit: 20 }, { signal })
            : getSkills({ q: debouncedQuery, categoryId, cursor: nextCursor ?? undefined, limit: 20 }, { signal }),
        ]);
        if (controller.signal.aborted) return;
        setCategories(categoryItems);
        setSkills((current: Skill[]) => (isMore ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : t("skillMarket.common.loadFailed"));
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [categoryId, debouncedQuery, options.mine],
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

  return {
    categories,
    skills,
    loading,
    loadingMore,
    error,
    query,
    categoryId,
    hasMore: Boolean(cursor),
    setQuery,
    setCategoryId,
    refresh: () => void fetchPage(null),
    loadMore: () => {
      if (!cursor || loading || loadingMore) return;
      void fetchPage(cursor);
    },
  };
}
