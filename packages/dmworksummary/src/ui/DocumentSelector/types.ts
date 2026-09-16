import type { DocSearchItem } from "@octo/base";

export interface DocumentSelectorState {
  keyword: string;
  items: DocSearchItem[];
  selected: DocSearchItem[];
  isLoading: boolean;
  error: string | null;
  maxSelect: number;
}

export interface DocumentSelectorActions {
  onKeywordChange: (keyword: string) => void;
  onToggle: (item: DocSearchItem) => void;
  onRetry: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface DocumentSelectorProps {
  visible: boolean;
  state: DocumentSelectorState;
  actions: DocumentSelectorActions;
}
