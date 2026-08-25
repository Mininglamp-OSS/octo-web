import type { HTMLAttributes, ReactNode } from "react";

export type TabsSize = "md" | "sm";
export type TabsVariant = "line" | "segmented" | "segmented-plain";

export interface TabItem {
  key: string;
  label: ReactNode;
  children?: ReactNode;
  isDisabled?: boolean;
}

export interface TabsProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  items: readonly TabItem[];
  activeKey?: string;
  defaultActiveKey?: string;
  onChange?: (key: string) => void;
  size?: TabsSize;
  variant?: TabsVariant;
}
