import { useCallback, useEffect, useRef, useState } from "react";
import NameSearchService, {
  isNameSearchQueryChanged,
  isNameSearchPermissionLost,
} from "../../Service/NameSearchService";
import type {
  NameSearchItem,
  NameSearchKind,
  NameSearchPage,
  NameSearchQuery,
} from "../../Service/NameSearchTypes";
import { nameQueryIdentity } from "./queryIdentity";

interface State {
  key: string;
  items: NameSearchItem[];
  total: number | null;
  complete: boolean;
  incompleteReasons: string[];
  hasMore: boolean;
  nextCursor: string;
  resultRevision: string;
  loading: boolean;
  loadingMore: boolean;
  error: unknown;
  loadMoreError: unknown;
}
function empty(key: string, loading = false): State {
  return {
    key,
    items: [],
    total: null,
    complete: false,
    incompleteReasons: [],
    hasMore: false,
    nextCursor: "",
    resultRevision: "",
    loading,
    loadingMore: false,
    error: null,
    loadMoreError: null,
  };
}
export interface NameSearchOptions {
  userId: string;
  kind: NameSearchKind;
  query: NameSearchQuery | null;
  fetch?: (
    query: NameSearchQuery,
    signal?: AbortSignal
  ) => Promise<NameSearchPage>;
  /** Engineering default, not a product promise of instant remote updates. */
  revalidateMs?: number;
}

export default function useNameSearch(options: NameSearchOptions) {
  const key = nameQueryIdentity(options.userId, options.kind, options.query);
  const [state, setState] = useState<State>(() => empty(key));
  const snapshot = useRef(state);
  const renderKey = useRef(key);
  renderKey.current = key;
  const queryRef = useRef(options.query);
  queryRef.current = options.query;
  const fetchRef = useRef(options.fetch);
  fetchRef.current =
    options.fetch ??
    (options.kind === "contact"
      ? NameSearchService.searchContacts
      : options.kind === "group"
      ? NameSearchService.searchGroups
      : NameSearchService.searchThreads);
  const generation = useRef(0);
  const flight = useRef<{ controller: AbortController } | null>(null);
  const [refresh, setRefresh] = useState(0);

  const update = useCallback((next: State) => {
    snapshot.current = next;
    setState(next);
  }, []);
  const invalidate = useCallback(() => {
    generation.current += 1;
    flight.current?.controller.abort();
    flight.current = null;
    update(empty(renderKey.current, !!renderKey.current));
    setRefresh((n) => n + 1);
  }, [update]);

  const run = useCallback(
    async (mode: "replace" | "append" | "verify", cursor = "") => {
      const activeKey = renderKey.current,
        query = queryRef.current,
        request = fetchRef.current;
      if (!activeKey || !query || !request || flight.current) return;
      const currentGeneration = generation.current;
      const record = { controller: new AbortController() };
      flight.current = record;
      const current = () =>
        renderKey.current === activeKey &&
        generation.current === currentGeneration &&
        !record.controller.signal.aborted;
      if (mode === "replace") update(empty(activeKey, true));
      if (mode === "append")
        update({ ...snapshot.current, loadingMore: true, loadMoreError: null });
      try {
        const page = await request(
          { ...query, cursor },
          record.controller.signal
        );
        if (!current()) return;
        if (
          mode === "append" &&
          page.resultRevision !== snapshot.current.resultRevision
        ) {
          invalidate();
          return;
        }
        if (
          mode === "verify" &&
          page.resultRevision === snapshot.current.resultRevision &&
          !snapshot.current.error
        )
          return;
        let items = page.items;
        if (mode === "append") {
          const ids = new Set(snapshot.current.items.map((item) => item.id));
          if (items.some((item) => ids.has(item.id)))
            throw new Error("Repeated name search page");
          items = [...snapshot.current.items, ...items];
        }
        update({
          key: activeKey,
          items,
          total: page.total,
          complete: page.complete,
          incompleteReasons: page.incompleteReasons,
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
          resultRevision: page.resultRevision,
          loading: false,
          loadingMore: false,
          error: null,
          loadMoreError: null,
        });
      } catch (error) {
        if (!current()) return;
        if (mode !== "replace" && isNameSearchQueryChanged(error)) {
          invalidate();
          return;
        }
        if (mode === "append" && !isNameSearchPermissionLost(error))
          update({
            ...snapshot.current,
            loadingMore: false,
            loadMoreError: error,
          });
        else update({ ...empty(activeKey), error }); // Unverified results are not a successful current result.
      } finally {
        if (flight.current === record) flight.current = null;
      }
    },
    [invalidate, update]
  );

  useEffect(() => {
    generation.current += 1;
    flight.current?.controller.abort();
    flight.current = null;
    update(empty(key, !!key));
    if (key) void run("replace");
    return () => {
      generation.current += 1;
      flight.current?.controller.abort();
      flight.current = null;
    };
  }, [key, refresh, run, update]);

  useEffect(() => {
    if (!key) return;
    const check = () => {
      if (document.visibilityState !== "hidden") void run("verify");
    };
    const interval = options.revalidateMs ?? 30_000;
    const timer =
      interval > 0 ? window.setInterval(check, interval) : undefined;
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [key, options.revalidateMs, run]);

  const loadMore = useCallback(async () => {
    const value = snapshot.current;
    if (
      value.key !== renderKey.current ||
      !value.hasMore ||
      value.loading ||
      value.loadingMore ||
      value.error
    )
      return;
    await run("append", value.nextCursor);
  }, [run]);

  // Mask synchronously on render, before effects run for a new condition.
  const visible = state.key === key ? state : empty(key, !!key);
  return { ...visible, loadMore, reload: invalidate, invalidate };
}
