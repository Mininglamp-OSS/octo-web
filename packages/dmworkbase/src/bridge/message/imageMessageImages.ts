export interface ImageMessageImage {
  imageIndex: number;
  url: string;
  width: number;
  height: number;
  filename?: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function dimension(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

/** Preserve attachment indices, including empty slots; URLs are not identities. */
export function getImageMessageImages(content: unknown): ImageMessageImage[] {
  const source = record(content);
  const attachments =
    Array.isArray(source.images) && source.images.length > 0
      ? source.images
      : [source];
  return attachments.map((attachment, imageIndex) => {
    const image = record(attachment);
    const url =
      typeof image.url === "string" && image.url.trim()
        ? image.url
        : typeof image.remoteUrl === "string"
        ? image.remoteUrl
        : "";
    return {
      imageIndex,
      url,
      width: dimension(image.width),
      height: dimension(image.height),
      filename: typeof image.name === "string" ? image.name : undefined,
    };
  });
}
