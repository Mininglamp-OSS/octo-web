import type { DocSearchItem } from "@octo/base";

export type DocumentSelectorSource = "recent" | "mine";

export interface DocumentSelectorState {
  source: DocumentSelectorSource;
  keyword: string;
  items: DocSearchItem[];
  selected: DocSearchItem[];
  isLoading: boolean;
  error: string | null;
  maxSelect: number;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  loadMoreError?: string | null;
}

export interface DocumentSelectorActions {
  onSourceChange: (source: DocumentSelectorSource) => void;
  onKeywordChange: (keyword: string) => void;
  onToggle: (item: DocSearchItem) => void;
  onRetry: () => void;
  onLoadMore: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface DocumentSelectorProps {
  visible: boolean;
  state: DocumentSelectorState;
  actions: DocumentSelectorActions;
}
