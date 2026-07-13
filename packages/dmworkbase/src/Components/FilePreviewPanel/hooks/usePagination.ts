import { useCallback, useEffect, useRef, useState } from "react";

export interface PaginationState {
  current: number;
  total: number;
}

export interface UsePaginationResult {
  page: PaginationState;
  setPageIndex: (index: number) => void;
  goPrev: () => void;
  goNext: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
  reset: (total: number) => void;
}

/**
 * 分页导航 Hook — 翻页逻辑 + 边界防护。
 * index 始终被 clamp 在 [0, total-1]。
 */
export function usePagination(initialTotal = 0): UsePaginationResult {
  const [page, setPage] = useState<PaginationState>({ current: 0, total: initialTotal });

  const clamp = useCallback((index: number, total: number) => {
    if (total <= 0) return 0;
    return Math.max(0, Math.min(index, total - 1));
  }, []);

  const setPageIndex = useCallback((index: number) => {
    setPage((p) => ({ ...p, current: clamp(index, p.total) }));
  }, [clamp]);

  const goPrev = useCallback(() => {
    setPage((p) => ({ ...p, current: clamp(p.current - 1, p.total) }));
  }, [clamp]);

  const goNext = useCallback(() => {
    setPage((p) => ({ ...p, current: clamp(p.current + 1, p.total) }));
  }, [clamp]);

  const reset = useCallback((total: number) => {
    setPage({ current: 0, total: Math.max(0, total) });
  }, []);

  return {
    page,
    setPageIndex,
    goPrev,
    goNext,
    canGoPrev: page.current > 0,
    canGoNext: page.current < page.total - 1,
    reset,
  };
}

export default usePagination;
