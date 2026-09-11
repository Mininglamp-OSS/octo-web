import { createContext } from "react";

export interface ImageGalleryActions {
  /** Returns false if this image is no longer eligible. */
  openImage: (key: string) => boolean;
}

export const ImageGalleryContext = createContext<ImageGalleryActions | null>(
  null
);
