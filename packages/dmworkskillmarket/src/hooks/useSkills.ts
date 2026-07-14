import { useCallback, useEffect, useRef, useState } from "react";
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
  const [categoryId, setCategoryIdState] = useState("all");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const fetchPage = useCallback(
    async (nextCursor?: string | null) => {
      const seq = requestSeq.current + 1;
      requestSeq.current = seq;
      const isMore = Boolean(nextCursor);
      if (isMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const [categoryItems, page] = await Promise.all([
          getCategories(),
          options.mine
            ? getMySkills({ q: query, categoryId, cursor: nextCursor ?? undefined, limit: 20 })
            : getSkills({ q: query, categoryId, cursor: nextCursor ?? undefined, limit: 20 }),
        ]);
        if (requestSeq.current !== seq) return;
        setCategories(categoryItems);
        setSkills((current: Skill[]) => (isMore ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (err) {
        if (requestSeq.current !== seq) return;
        setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (requestSeq.current === seq) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [categoryId, options.mine, query],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchPage(null);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [fetchPage]);

  const setQuery = useCallback((value: string) => {
    setQueryState(value);
  }, []);

  const setCategoryId = useCallback((value: string) => {
    setCategoryIdState(value);
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
