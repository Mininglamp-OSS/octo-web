export interface RuntimeOption {
  id: string;
  name: string;
  provider: string;
  version: string;
  reason: string;
  available: boolean;
  selectable?: boolean;
  owned?: boolean;
  visibility?: string;
  cloud: boolean;
}

export interface RuntimeGroup {
  key: string;
  label: string;
  items: RuntimeOption[];
}

export interface LoopRuntimePickerProps {
  groups: RuntimeGroup[];
  scope?: "mine" | "all";
  onScopeChange?: (scope: "mine" | "all") => void;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  loading?: boolean;
  error?: string;
}
