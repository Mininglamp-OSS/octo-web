import type { HTMLAttributes, ImgHTMLAttributes, ReactNode } from "react";

export type AvatarSize = 16 | 20 | 28 | 32 | 40;
export type AvatarKind = "person" | "group";
export type AvatarTone = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface AvatarProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "children" | "onError"> {
  src?: string;
  alt: string;
  size?: AvatarSize;
  kind?: AvatarKind;
  fallbackText?: string;
  fallbackIcon?: ReactNode;
  tone?: AvatarTone;
  imageLoading?: ImgHTMLAttributes<HTMLImageElement>["loading"];
  imageDecoding?: ImgHTMLAttributes<HTMLImageElement>["decoding"];
  onImageError?: ImgHTMLAttributes<HTMLImageElement>["onError"];
}
