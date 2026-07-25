import type { ReactNode } from "react";

export interface ResizableRightPanelSize {
  minWidth: number;
  defaultWidth: number;
  maxWidth: number;
  storageKey: string;
  /** 面板最多占父容器的比例，默认 0.5。 */
  maxContainerRatio?: number;
}

export interface ResizableRightPanelProps {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  size: ResizableRightPanelSize;
  closeLabel: string;
  className?: string;
}
