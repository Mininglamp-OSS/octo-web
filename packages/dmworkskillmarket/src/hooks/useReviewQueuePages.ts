import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { t, WKApp } from "@octo/base";
import { listReviewRequests } from "../api/skillApi";
import type { ReviewListMode, ReviewRequest, ReviewStatus } from "../types/skill";

export const HANDLED_STATUSES = ["approved", "rejected", "canceled"] as const;
const STATUSES: ReviewStatus[] = ["pending", ...HANDLED_STATUSES];

interface QueuePage {
  items: ReviewRequest[];
  nextCursor: string | null;
  total: number;
  loading: "initial" | "more" | null;
  error: string | null;
  /** null retries page one; a string retries the failed continuation exactly. */
  failedCursor: string | null;
}

const emptyPage = (): QueuePage => ({
  items: [], nextCursor: null, total: 0, loading: null, error: null, failedCursor: null,
});
const emptyPages = (): Record<ReviewStatus, QueuePage> => ({
  pending: emptyPage(), approved: emptyPage(), rejected: emptyPage(), canceled: emptyPage(),
});

/** Queue-local read ownership: refresh replaces a read, pagination joins an
 * active read, and failures keep both the visible rows and the retry cursor. */
export function useReviewQueuePages(mode: ReviewListMode) {
  const [pages, setPages] = useState(emptyPages);
  const pagesRef = useRef(pages);
  const mountedRef = useRef(false);
  const scopeRef = useRef(0);
  const spaceIdRef = useRef(WKApp.shared?.currentSpaceId);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const requestsRef = useRef<Partial<Record<ReviewStatus, { controller: AbortController; promise: Promise<void> }>>>({});

  const update = useCallback((status: ReviewStatus, page: QueuePage) => {
    pagesRef.current = { ...pagesRef.current, [status]: page };
    setPages(pagesRef.current);
  }, []);

  const abortAll = useCallback(() => {
    scopeRef.current += 1;
    for (const status of STATUSES) requestsRef.current[status]?.controller.abort();
    requestsRef.current = {};
  }, []);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortAll();
    };
  }, [abortAll]);

  const reset = useCallback(() => {
    abortAll();
    spaceIdRef.current = WKApp.shared?.currentSpaceId;
    pagesRef.current = emptyPages();
    setPages(pagesRef.current);
  }, [abortAll]);

  const read = useCallback((status: ReviewStatus, cursor: string | null, replace = false): Promise<void> => {
    if (!mountedRef.current || mode !== modeRef.current) return Promise.resolve();
    const spaceId = spaceIdRef.current;
    if (spaceId !== WKApp.shared?.currentSpaceId) {
      update(status, { ...pagesRef.current[status], loading: null, error: t("skillMarket.review.spaceChanged") });
      return Promise.resolve();
    }
    const previous = requestsRef.current[status];
    if (previous && !replace) return previous.promise;
    previous?.controller.abort();
    const controller = new AbortController();
    const request = { controller, promise: Promise.resolve() };
    requestsRef.current[status] = request;
    const isCurrent = () => mountedRef.current && !controller.signal.aborted && requestsRef.current[status] === request;
    update(status, { ...pagesRef.current[status], loading: cursor ? "more" : "initial", error: null });
    request.promise = (async () => {
      try {
        const page = Number.parseInt(cursor ?? "", 10);
        const result = await listReviewRequests(mode, {
          status, page: Number.isFinite(page) && page > 0 ? page : 1, pageSize: 20, signal: controller.signal,
        });
        if (!isCurrent()) return;
        if (spaceId !== WKApp.shared?.currentSpaceId) throw new Error(t("skillMarket.review.spaceChanged"));
        const existing = pagesRef.current[status];
        update(status, {
          items: cursor ? [...existing.items, ...result.items] : result.items,
          nextCursor: result.nextCursor, total: result.total, loading: null, error: null, failedCursor: null,
        });
      } catch (err) {
        if (!isCurrent()) return;
        update(status, {
          ...pagesRef.current[status], loading: null, failedCursor: cursor,
          error: spaceId !== WKApp.shared?.currentSpaceId ? t("skillMarket.review.spaceChanged")
            : err instanceof Error ? err.message : t("skillMarket.common.loadFailed"),
        });
      } finally {
        if (isCurrent()) delete requestsRef.current[status];
      }
    })();
    return request.promise;
  }, [mode, update]);

  const refresh = useCallback((statuses: readonly ReviewStatus[]) => {
    const scope = scopeRef.current;
    return Promise.all(statuses.map(async (status) => {
      await read(status, null, true);
      // Another reconciliation may supersede ours. Keep an action's lock until
      // that latest read settles too; an obsolete finally cannot unlock it.
      while (mountedRef.current && scope === scopeRef.current && requestsRef.current[status]) {
        await requestsRef.current[status]?.promise;
      }
    })).then(() => undefined);
  }, [read]);

  const loadMore = useCallback((statuses: readonly ReviewStatus[]) => {
    // Read the synchronous state, not an observer's older render closure.
    if (statuses.some((status) => pagesRef.current[status].error || pagesRef.current[status].loading)) return;
    for (const status of statuses) {
      const cursor = pagesRef.current[status].nextCursor;
      if (cursor) void read(status, cursor);
    }
  }, [read]);

  const retry = useCallback((statuses: readonly ReviewStatus[]) => {
    for (const status of statuses) {
      const page = pagesRef.current[status];
      if (page.error && !page.loading) void read(status, page.failedCursor);
    }
  }, [read]);

  return { pages, refresh, loadMore, retry, reset };
}
