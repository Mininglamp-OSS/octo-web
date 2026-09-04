import type { HTMLAttributes, ReactNode } from "react";

export interface EmptyProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  illustration?: ReactNode | false;
  action?: ReactNode;
}
