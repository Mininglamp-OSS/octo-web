import type { HTMLAttributes, ReactElement } from "react";
import type { AvatarProps } from "../Avatar/types";

export type AvatarGroupSize = 16 | 20;
export type AvatarGroupMax = 1 | 2 | 3;

export interface AvatarGroupProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  children: ReactElement<AvatarProps> | ReactElement<AvatarProps>[];
  size: AvatarGroupSize;
  max?: AvatarGroupMax;
  label?: string;
}
