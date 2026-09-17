import { useCallback, useEffect, useRef, useState } from "react";
import { WKApp, useI18n } from "@octo/base";
import type { DocSearchDocType, DocSearchItem } from "@octo/base";
import type { DocumentSelectorSource } from "../../ui/DocumentSelector/types";

interface UseDocumentSearchOptions {
  visible: boolean;
  selected: DocSearchItem[];
  maxSelect: number;
}

interface DocsListItem {
  docId?: string;
  title?: string;
  docType?: string;
  updatedAt?: string | number | null;
  spaceId?: string;
}

interface DocsListResponse {
  total?: number;
  items?: DocsListItem[];
}

const PAGE_SIZE = 50;
const SUPPORTED_DOC_TYPES = new Set<DocSearchDocType>(["doc", "html"]);

function toUpdatedAtMillis(updatedAt: DocsListItem["updatedAt"]): number | null {
  if (typeof updatedAt === "number") return Number.isFinite(updatedAt) ? updatedAt : null;
  if (typeof updatedAt !== "string" || !updatedAt.trim()) return null;
  const parsed = Date.parse(updatedAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDocSearchItem(item: DocsListItem): DocSearchItem | null {
  if (!item.docId) return null;
  const docType = item.docType || "doc";
  if (!SUPPORTED_DOC_TYPES.has(docType as DocSearchDocType)) return null;
  return {
    docId: item.docId,
    title: item.title || item.docId,
    docType: docType as DocSearchDocType,
    updatedAt: toUpdatedAtMillis(item.updatedAt),
    spaceId: item.spaceId,
  };
}

interface ListDocumentsResult {
  items: DocSearchItem[];
  total: number;
}

async function listDocuments(source: DocumentSelectorSource, keyword: string): Promise<ListDocumentsResult> {
  const query = keyword.trim();
  const param =
    source === "recent"
      ? { pageSize: PAGE_SIZE, ...(query ? { q: query } : {}) }
      : {
          owner: "me",
          page: 1,
          pageSize: PAGE_SIZE,
          sort: "updatedAt:desc",
          ...(query ? { q: query } : {}),
        };
  const response = await WKApp.apiClient.get<DocsListResponse>(
    source === "recent" ? "docs/recent" : "docs",
    { param }
  );
  return {
    items: (response?.items ?? []).map(toDocSearchItem).filter(Boolean) as DocSearchItem[],
    total: response?.total ?? 0,
  };
}

export function useDocumentSearch({
  visible,
  selected,
  maxSelect,
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
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      try {
        const result = await listDocuments(source, keyword);
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
  }, [keyword, retryKey, source, t, visible]);

  const onSourceChange = useCallback((nextSource: DocumentSelectorSource) => {
    setSource(nextSource);
    setError(null);
    setIsLoading(true);
  }, []);

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
