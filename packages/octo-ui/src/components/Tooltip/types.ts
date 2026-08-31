import type { ReactElement, ReactNode } from "react";

export type TooltipLayout = "horizontal" | "vertical";

export type TooltipPlacement =
  | "top"
  | "top-start"
  | "top-end"
  | "right"
  | "right-start"
  | "right-end"
  | "bottom"
  | "bottom-start"
  | "bottom-end"
  | "left"
  | "left-start"
  | "left-end";

export interface TooltipContentConfig {
  body: ReactNode;
  title?: ReactNode;
  shortcut?: ReactNode;
  actions?: ReactNode;
  layout?: TooltipLayout;
}

export type TooltipContent = ReactNode | TooltipContentConfig;

export interface TooltipProps {
  content: TooltipContent;
  children: ReactElement;
  isDelayed?: boolean;
  isDisabled?: boolean;
  placement?: TooltipPlacement;
  className?: string;
  onVisibleChange?: (visible: boolean) => void;
}
