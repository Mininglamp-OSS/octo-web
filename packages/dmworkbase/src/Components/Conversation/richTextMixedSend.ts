export type RichTextMixedEditorBlock =
  | { type: "text"; text: string; mention?: unknown }
  | { type: "image"; id: string; file: File }
  | { type: "file"; id: string; file: File };

export interface RichTextMixedAttachment {
  id: string;
  file: File;
}

export interface RichTextMixedCandidate {
  blocks: RichTextMixedEditorBlock[];
  topImageIds: string[];
}

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "svg",
]);

export function isImageFileForRichTextMixed(file: Pick<File, "type" | "name">) {
  if (file.type?.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Decide whether the current compose payload should become one RichText(=14)
 * message. Upload-button images live in the top attachment area, while pasted
 * images live inside editorBlocks; both must count as image blocks.
 */
export function buildRichTextMixedCandidate(
  topFiles: RichTextMixedAttachment[],
  editorBlocks?: RichTextMixedEditorBlock[]
): RichTextMixedCandidate | null {
  const blocks = editorBlocks || [];
  if (blocks.length === 0) return null;

  const topImages = topFiles.filter(({ file }) =>
    isImageFileForRichTextMixed(file)
  );
  const hasTopNonImage = topImages.length !== topFiles.length;
  if (hasTopNonImage) return null;

  const hasText = blocks.some(
    (block) => block.type === "text" && block.text.trim() !== ""
  );
  const hasEditorImage = blocks.some((block) => block.type === "image");
  const hasEditorFile = blocks.some((block) => block.type === "file");
  if (
    !hasText ||
    hasEditorFile ||
    (!hasEditorImage && topImages.length === 0)
  ) {
    return null;
  }

  return {
    blocks: [
      ...topImages.map<RichTextMixedEditorBlock>(({ id, file }) => ({
        type: "image",
        id,
        file,
      })),
      ...blocks,
    ],
    topImageIds: topImages.map(({ id }) => id),
  };
}
