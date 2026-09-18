import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@octo/base";
import type { DocSearchItem } from "@octo/base";
import documentSourceService, {
  type DocumentSourceService,
  type DocumentListPage,
} from "../../Service/DocumentSourceService";
import type { DocumentSelectorSource } from "../../ui/DocumentSelector/types";

interface UseDocumentSearchOptions {
  visible: boolean;
  selected: DocSearchItem[];
  maxSelect: number;
  service?: Pick<DocumentSourceService, "listDocuments">;
}

export function useDocumentSearch({
  visible,
  selected,
  maxSelect,
  service = documentSourceService,
}: UseDocumentSearchOptions) {
  const { t } = useI18n();
  const [source, setSource] = useState<DocumentSelectorSource>("recent");
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<DocSearchItem[]>([]);
  const [nextPage, setNextPage] = useState<DocumentListPage | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [localSelected, setLocalSelected] = useState<DocSearchItem[]>(selected);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const requestSequence = useRef(0);
  const nextPageRef = useRef<DocumentListPage | null>(null);
  const loadingMoreSequence = useRef<number | null>(null);
  const wasVisible = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const resetPagination = useCallback(() => {
    nextPageRef.current = null;
    loadingMoreSequence.current = null;
    setNextPage(null);
    setIsLoadingMore(false);
    setLoadMoreError(null);
  }, []);

  useEffect(() => {
    if (!visible) {
      requestSequence.current += 1;
      wasVisible.current = false;
      setKeyword("");
      setItems([]);
      resetPagination();
      setError(null);
      setIsLoading(false);
      return;
    }
    if (visible && !wasVisible.current) {
      setSource("recent");
      setKeyword("");
      setItems([]);
      resetPagination();
      setLocalSelected(selectedRef.current);
      setError(null);
      setIsLoading(false);
    }
    wasVisible.current = visible;
  }, [visible, resetPagination]);

  useEffect(() => {
    if (!visible) {
      requestSequence.current += 1;
      return;
    }
    const sequence = ++requestSequence.current;
    resetPagination();
    setItems([]);
    setError(null);
    setIsLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await service.listDocuments(source, keyword);
        if (sequence !== requestSequence.current) return;
        setItems(
          Array.from(
            new Map(result.items.map((item) => [item.docId, item])).values()
          )
        );
        nextPageRef.current = result.nextPage;
        setNextPage(result.nextPage);
      } catch {
        if (sequence !== requestSequence.current) return;
        setItems([]);
        setError(t("summary.documentPicker.searchFailed"));
      } finally {
        if (sequence === requestSequence.current) setIsLoading(false);
      }
    }, 250);

    return () => {
      requestSequence.current += 1;
      nextPageRef.current = null;
      window.clearTimeout(timer);
    };
  }, [keyword, retryKey, service, source, t, visible, resetPagination]);

  const onLoadMore = useCallback(async () => {
    const page = nextPageRef.current;
    const sequence = requestSequence.current;
    if (
      !visible ||
      isLoading ||
      !page ||
      loadingMoreSequence.current === sequence
    )
      return;
    loadingMoreSequence.current = sequence;
    setIsLoadingMore(true);
    setLoadMoreError(null);
    try {
      const result = await service.listDocuments(source, keyword, page);
      if (sequence !== requestSequence.current) return;
      setItems((current) =>
        Array.from(
          new Map(
            [...current, ...result.items].map((item) => [item.docId, item])
          ).values()
        )
      );
      nextPageRef.current = result.nextPage;
      setNextPage(result.nextPage);
    } catch {
      if (sequence !== requestSequence.current) return;
      // Leave the failed page pointer and existing list intact so retry
      // requests the same page without losing the user's selection.
      setLoadMoreError(t("summary.documentPicker.loadMoreFailed"));
    } finally {
      if (sequence === requestSequence.current) {
        loadingMoreSequence.current = null;
        setIsLoadingMore(false);
      }
    }
  }, [visible, isLoading, service, source, keyword, t]);

  const onSourceChange = useCallback(
    (nextSource: DocumentSelectorSource) => {
      if (nextSource === source) return;
      requestSequence.current += 1;
      resetPagination();
      setSource(nextSource);
      setError(null);
      setIsLoading(true);
    },
    [source, resetPagination]
  );

  const onKeywordChange = useCallback(
    (nextKeyword: string) => {
      if (nextKeyword === keyword) return;
      requestSequence.current += 1;
      resetPagination();
      setKeyword(nextKeyword);
      setError(null);
      setIsLoading(true);
    },
    [keyword, resetPagination]
  );

  const onToggle = useCallback(
    (item: DocSearchItem) => {
      setLocalSelected((current) => {
        const exists = current.some(
          (candidate) => candidate.docId === item.docId
        );
        if (exists) {
          return current.filter((candidate) => candidate.docId !== item.docId);
        }
        if (current.length >= maxSelect) return current;
        return [...current, item];
      });
    },
    [maxSelect]
  );

  return {
    state: {
      source,
      keyword,
      items,
      selected: localSelected,
      isLoading,
      error,
      maxSelect,
      hasMore: nextPage !== null,
      isLoadingMore,
      loadMoreError,
    },
    actions: {
      onSourceChange,
      onKeywordChange,
      onToggle,
      onLoadMore,
      onRetry: () => setRetryKey((value) => value + 1),
    },
  };
}
