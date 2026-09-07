import type { HTMLAttributes, ReactNode } from "react";

export type LoadingSize = "sm" | "md" | "lg";
export type LoadingLayout = "inline" | "vertical";

export interface LoadingProps extends HTMLAttributes<HTMLSpanElement> {
  size?: LoadingSize;
  text?: ReactNode;
  layout?: LoadingLayout;
}
