import type React from "react";

/** Presentation only: callers own upload state and action permissions. */
export interface FileCardProps {
  name: string;
  size: string;
  extension?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  progress?: number;
  status?: React.ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
  onClick?: () => void;
  title?: string;
  active?: boolean;
  className?: string;
}
