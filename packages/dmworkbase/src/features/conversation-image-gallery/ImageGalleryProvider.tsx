import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ImagePreviewLightbox } from "../../Messages/Image/ImagePreview";
import { ImageGalleryContext } from "./ImageGalleryContext";
import type { GalleryImage } from "./imageGallery";

interface GallerySession {
  scopeKey: string;
  images: readonly GalleryImage[];
  currentKey: string;
}

interface ImageGalleryProviderProps {
  scopeKey: string;
  images: readonly GalleryImage[];
  children: React.ReactNode;
}

/** Own one preview per scope, independently of the lifetime of message rows. */
export function ImageGalleryProvider({
  scopeKey,
  images,
  children,
}: ImageGalleryProviderProps) {
  const [session, setSession] = useState<GallerySession | null>(null);
  const snapshot = session?.images;
  const sessionScope = session?.scopeKey;
  const slides = useMemo(() => {
    if (!snapshot || sessionScope !== scopeKey) return [];
    const eligible = new Map(images.map((image) => [image.key, image.src]));
    return snapshot.filter((image) => eligible.get(image.key) === image.src);
  }, [snapshot, sessionScope, scopeKey, images]);
  const index = slides.findIndex((image) => image.key === session?.currentKey);
  const open = index >= 0;

  useEffect(() => {
    if (!open) setSession(null);
  }, [open, scopeKey]);

  const openImage = useCallback(
    (key: string) => {
      if (!images.some((image) => image.key === key)) return false;
      setSession({ scopeKey, images: [...images], currentKey: key });
      return true;
    },
    [scopeKey, images]
  );
  const actions = useMemo(() => ({ openImage }), [openImage]);

  return (
    <ImageGalleryContext.Provider value={actions}>
      {children}
      <ImagePreviewLightbox
        open={open}
        close={() => setSession(null)}
        slides={slides}
        index={Math.max(index, 0)}
        showCounter
        onView={(nextIndex) => {
          const nextKey = slides[nextIndex]?.key;
          if (!nextKey) return;
          setSession((current) =>
            current &&
            current.scopeKey === scopeKey &&
            current.currentKey !== nextKey
              ? { ...current, currentKey: nextKey }
              : current
          );
        }}
      />
    </ImageGalleryContext.Provider>
  );
}
