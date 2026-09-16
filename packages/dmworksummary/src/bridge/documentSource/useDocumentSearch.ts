import { useCallback, useEffect, useRef, useState } from "react";
import { SearchService, useI18n } from "@octo/base";
import type { DocSearchItem } from "@octo/base";

interface UseDocumentSearchOptions {
  visible: boolean;
  selected: DocSearchItem[];
  maxSelect: number;
}

export function useDocumentSearch({
  visible,
  selected,
  maxSelect,
}: UseDocumentSearchOptions) {
  const { t } = useI18n();
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<DocSearchItem[]>([]);
  const [localSelected, setLocalSelected] = useState<DocSearchItem[]>(selected);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const requestSequence = useRef(0);
  const wasVisible = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    if (!visible) {
      requestSequence.current += 1;
      wasVisible.current = false;
      setKeyword("");
      setItems([]);
      setError(null);
      setIsLoading(false);
      return;
    }
    if (visible && !wasVisible.current) {
      setKeyword("");
      setItems([]);
      setLocalSelected(selectedRef.current);
      setError(null);
      setIsLoading(false);
    }
    wasVisible.current = visible;
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      requestSequence.current += 1;
      return;
    }
    const query = keyword.trim();
    if (!query) {
      requestSequence.current += 1;
      setItems([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    const sequence = ++requestSequence.current;
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await SearchService.searchDocs({
          keyword: query,
          pageSize: 50,
        });
        if (sequence !== requestSequence.current) return;
        setItems(response.items);
      } catch {
        if (sequence !== requestSequence.current) return;
        setItems([]);
        setError(t("summary.documentPicker.searchFailed"));
      } finally {
        if (sequence === requestSequence.current) setIsLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [keyword, retryKey, t, visible]);

  const onToggle = useCallback(
    (item: DocSearchItem) => {
      setLocalSelected((current) => {
        const exists = current.some((candidate) => candidate.docId === item.docId);
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
      keyword,
      items,
      selected: localSelected,
      isLoading,
      error,
      maxSelect,
    },
    actions: {
      onKeywordChange: setKeyword,
      onToggle,
      onRetry: () => setRetryKey((value) => value + 1),
    },
  };
}
