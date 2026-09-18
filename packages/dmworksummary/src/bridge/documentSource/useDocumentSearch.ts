import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@octo/base";
import type { DocSearchItem } from "@octo/base";
import documentSourceService, {
  type DocumentSourceService,
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
  const [total, setTotal] = useState(0);
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
      setTotal(0);
      setError(null);
      setIsLoading(false);
      return;
    }
    if (visible && !wasVisible.current) {
      setSource("recent");
      setKeyword("");
      setItems([]);
      setTotal(0);
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
    const sequence = ++requestSequence.current;
    setError(null);
    setIsLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await service.listDocuments(source, keyword);
        if (sequence !== requestSequence.current) return;
        setItems(result.items);
        setTotal(result.total);
      } catch {
        if (sequence !== requestSequence.current) return;
        setItems([]);
        setTotal(0);
        setError(t("summary.documentPicker.searchFailed"));
      } finally {
        if (sequence === requestSequence.current) setIsLoading(false);
      }
    }, 250);

    return () => {
      requestSequence.current += 1;
      window.clearTimeout(timer);
    };
  }, [keyword, retryKey, service, source, t, visible]);

  const onSourceChange = useCallback(
    (nextSource: DocumentSelectorSource) => {
      if (nextSource === source) return;
      setSource(nextSource);
      setError(null);
      setIsLoading(true);
    },
    [source]
  );

  const onKeywordChange = useCallback((nextKeyword: string) => {
    setKeyword(nextKeyword);
    setError(null);
    setIsLoading(true);
  }, []);

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
      source,
      keyword,
      items,
      selected: localSelected,
      isLoading,
      error,
      maxSelect,
      hasMore: total > items.length,
    },
    actions: {
      onSourceChange,
      onKeywordChange,
      onToggle,
      onRetry: () => setRetryKey((value) => value + 1),
    },
  };
}
