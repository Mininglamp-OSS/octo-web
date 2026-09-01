import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@octo/base";
import type {
  PagedResult,
  ReviewListMode,
  ReviewRequest,
  ReviewStatus,
} from "../types/skill";
import { listReviewRequests } from "../api/skillApi";
import type { ReviewListParams } from "../api/skillApi";

export interface UseReviewRequestsOptions {
  mode: ReviewListMode;
  status?: ReviewStatus;
  pageSize?: number;
  /** Defaults to true. Set false to hold the fetch back — `mode=space` 403s
   *  for a non-reviewer, so the reviewer-queue badge must not fire until the
   *  role has resolved. */
  enabled?: boolean;
}

export interface UseReviewRequestsResult {
  items: ReviewRequest[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  /** Total pending requests in `mode`, for the tab badge. */
  pendingCount: number;
  refresh: () => void;
  loadMore: () => void;
}

/** Mirrors `useSkills`: a single in-flight controller aborted on refetch and on
 *  unmount, `AbortError` swallowed, `loading` split from `loadingMore`. */
export function useReviewRequests(
  options: UseReviewRequestsOptions
): UseReviewRequestsResult {
  const pageSize = options.pageSize ?? 20;
  const enabled = options.enabled ?? true;
  const [items, setItems] = useState<ReviewRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPage = useCallback(
    async (nextCursor?: string | null) => {
      // Abort BEFORE anything else, including the disabled early-return. The
      // disabled branch clears state, and a still-running request from the
      // previous Space / previous filter would otherwise land afterwards and
      // repopulate what was just cleared (its `controller.signal.aborted`
      // guards would all read false).
      if (abortRef.current) abortRef.current.abort();
      if (!enabled) {
        abortRef.current = null;
        setItems([]);
        setTotal(0);
        setPendingCount(0);
        setCursor(null);
        setError(null);
        setLoading(false);
        setLoadingMore(false);
        return;
      }
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
        const page = Number.parseInt(nextCursor ?? "", 10);
        const params: ReviewListParams = {
          status: options.status,
          page: Number.isFinite(page) && page > 0 ? page : 1,
          pageSize,
          signal: controller.signal,
        };
        const result: PagedResult<ReviewRequest> = await listReviewRequests(
          options.mode,
          params
        );
        if (controller.signal.aborted) return;
        setItems((current) =>
          isMore ? [...current, ...result.items] : result.items
        );
        setTotal(result.total);
        setCursor(result.nextCursor);
        if (!isMore) {
          if (options.status === "pending") {
            // The page just loaded already IS the pending set.
            setPendingCount(result.total);
          } else {
            // Badge-only probe: page_size=1 so the server effectively just
            // returns pagination.total. It shares the page controller, so a
            // refetch / unmount / disable cancels it too, and every setState
            // below is guarded on that same signal — otherwise a probe from a
            // previous Space could write its count over the current one.
            listReviewRequests(options.mode, {
              status: "pending",
              page: 1,
              pageSize: 1,
              signal: controller.signal,
            })
              .then((probe) => {
                if (controller.signal.aborted) return;
                setPendingCount(probe.total);
              })
              .catch(() => {
                if (controller.signal.aborted) return;
                setPendingCount(0);
              });
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : t("skillMarket.common.loadFailed")
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [enabled, options.mode, options.status, pageSize]
  );

  useEffect(() => {
    void fetchPage(null);
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchPage]);

  return {
    items,
    total,
    loading,
    loadingMore,
    error,
    hasMore: Boolean(cursor),
    pendingCount,
    refresh: () => void fetchPage(null),
    loadMore: () => {
      if (!cursor || loading || loadingMore) return;
      void fetchPage(cursor);
    },
  };
}
