import { useCallback, useEffect, useRef, useState } from "react";
import {
  listExpertCategories,
  listExperts,
  listMyExperts,
  listMySquads,
  listSquads,
} from "../api/expertService";
import type {
  ExpertCategoryCount,
  ExpertKindParam,
  ListExpertParams,
} from "../api/expertService";
import { expertListErrorI18nKey } from "../api/expertListError";
import type { ExpertItem } from "../mock/expertMock";
import { useExpertTags } from "./useExpertTags";

const PAGE_SIZE = 100;
const SEARCH_DELAY_MS = 250;

interface CatalogOptions extends Omit<ListExpertParams, "page" | "pageSize"> {
  kind: ExpertKindParam;
  mine: boolean;
  enabled: boolean;
  /** Changes on Space switches, even if all filters are already empty. */
  scopeRevision: number;
  tagKeyword?: string;
}

interface CatalogState {
  key: string;
  items: ExpertItem[];
  total: number;
  page: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  errorKey: string | null;
  moreErrorKey: string | null;
}

function emptyState(key: string, loading: boolean): CatalogState {
  return {
    key,
    items: [],
    total: 0,
    page: 0,
    hasMore: false,
    loading,
    loadingMore: false,
    errorKey: null,
    moreErrorKey: null,
  };
}

function emptyMetadata(key: string, loading: boolean) {
  return {
    key,
    loading,
    categories: [] as ExpertCategoryCount[],
    errorKey: null as string | null,
  };
}

/** Server filtering precedes paging; no filtering of a loaded slice in the UI. */
export function useExpertCatalog(options: CatalogOptions) {
  const { kind, mine, enabled } = options;
  const [revision, setRevision] = useState(0);
  // A value key avoids restarting requests when callers create equivalent arrays.
  const paramsKey = JSON.stringify({
    keyword: options.keyword?.trim() || undefined,
    category: options.category,
    tags: [...(options.tags ?? [])].sort(),
    sort: options.sort,
  });
  const key = JSON.stringify([
    kind,
    mine,
    enabled,
    options.scopeRevision,
    revision,
    paramsKey,
  ]);
  const metadataKey = JSON.stringify([
    kind,
    mine,
    enabled,
    options.scopeRevision,
    revision,
  ]);
  const tags = useExpertTags({
    kind,
    mine,
    enabled,
    scopeKey: metadataKey,
    keyword: options.tagKeyword,
  });
  const [state, setState] = useState<CatalogState>(() =>
    emptyState(key, enabled)
  );
  const [metadata, setMetadata] = useState(() =>
    emptyMetadata(metadataKey, enabled)
  );
  const generation = useRef(0);
  const paging = useRef(false);
  const list = mine
    ? kind === "agent"
      ? listMyExperts
      : listMySquads
    : kind === "agent"
    ? listExperts
    : listSquads;

  // Facets describe the whole scoped catalog. Keep them stable while searching
  // or paging so category chips and tag choices do not jump to a partial list.
  useEffect(() => {
    let cancelled = false;
    setMetadata(emptyMetadata(metadataKey, enabled));
    if (enabled) {
      (mine ? Promise.resolve([]) : listExpertCategories(kind))
        .then((categories) => {
          if (!cancelled)
            setMetadata({
              key: metadataKey,
              categories,
              loading: false,
              errorKey: null,
            });
        })
        .catch((err) => {
          if (!cancelled)
            setMetadata({
              ...emptyMetadata(metadataKey, false),
              errorKey: expertListErrorI18nKey(err),
            });
        });
    }
    return () => {
      cancelled = true;
    };
  }, [metadataKey, enabled, mine, kind]);

  useEffect(() => {
    const version = ++generation.current;
    paging.current = false;
    setState(emptyState(key, enabled));
    const params: ListExpertParams = JSON.parse(paramsKey);
    const timer = enabled
      ? window.setTimeout(
          async () => {
            try {
              const result = await list({
                ...params,
                page: 1,
                pageSize: PAGE_SIZE,
              });
              if (version !== generation.current) return;
              setState({
                ...emptyState(key, false),
                items: result.items,
                total: result.total,
                page: 1,
                hasMore: result.items.length > 0 && PAGE_SIZE < result.total,
              });
            } catch (err) {
              if (version !== generation.current) return;
              setState({
                ...emptyState(key, false),
                errorKey: expertListErrorI18nKey(err),
              });
            }
          },
          params.keyword ? SEARCH_DELAY_MS : 0
        )
      : undefined;
    return () => {
      window.clearTimeout(timer);
      ++generation.current;
    };
  }, [key, paramsKey, enabled, list]);

  const loadMore = useCallback(async () => {
    if (
      !enabled ||
      state.key !== key ||
      state.loading ||
      !state.hasMore ||
      paging.current
    )
      return;
    paging.current = true;
    const version = generation.current;
    const page = state.page + 1;
    setState((previous) => ({
      ...previous,
      loadingMore: true,
      moreErrorKey: null,
    }));
    try {
      const result = await list({
        ...JSON.parse(paramsKey),
        page,
        pageSize: PAGE_SIZE,
      });
      if (version !== generation.current) return;
      setState((previous) => {
        // Offset pagination may overlap when the catalog changes between pages.
        const seen = new Set(previous.items.map((item) => item.id));
        const added = result.items.filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
        return {
          ...previous,
          items: [...previous.items, ...added],
          total: result.total,
          page,
          hasMore: result.items.length > 0 && page * PAGE_SIZE < result.total,
          loadingMore: false,
        };
      });
    } catch (err) {
      if (version !== generation.current) return;
      setState((previous) => ({
        ...previous,
        loadingMore: false,
        moreErrorKey: expertListErrorI18nKey(err),
      }));
    } finally {
      if (version === generation.current) paging.current = false;
    }
  }, [enabled, state, key, paramsKey, list]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);
  // Never render rows from an earlier Space/filter while the effect is pending.
  const current = state.key === key ? state : emptyState(key, enabled);
  const facets =
    metadata.key === metadataKey
      ? metadata
      : emptyMetadata(metadataKey, enabled);
  return {
    ...current,
    categories: facets.categories,
    tags: tags.items,
    tagsLoading: tags.loading,
    tagsErrorKey: tags.errorKey,
    reloadTags: tags.reload,
    loading: current.loading || facets.loading,
    errorKey: current.errorKey || facets.errorKey,
    loadMore,
    reload,
  };
}
