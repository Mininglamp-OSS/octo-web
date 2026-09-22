import { getImageMessageImages } from "./imageMessageImages";
import type { ImageMessageImage } from "./imageMessageImages";

/** Original block positions are shared with getRichTextBlocksUI, including gaps. */
export function getRichTextMessageImages(
  content: unknown
): ImageMessageImage[] {
  if (!content || typeof content !== "object" || !("content" in content))
    return [];
  const blocks = content.content;
  if (!Array.isArray(blocks)) return [];
  return blocks.flatMap((block: unknown, imageIndex) => {
    if (
      !block ||
      typeof block !== "object" ||
      !("type" in block) ||
      block.type !== "image"
    )
      return [];
    // Rich-text image blocks have one URL; do not interpret nested images arrays.
    if (!("url" in block) || typeof block.url !== "string" || !block.url.trim())
      return [];
    const image = getImageMessageImages({ ...block, images: undefined })[0];
    return [{ ...image, imageIndex }];
  });
}
