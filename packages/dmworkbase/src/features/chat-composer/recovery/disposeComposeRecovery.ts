export interface ObjectUrlComposeRecovery {
  snapshot: unknown;
  topAttachments: Array<{ previewUrl?: string }>;
}

/** Release object URLs still owned by an evicted, unrestored compose. */
export function disposeComposeRecoveryObjectUrls(
  recovery: ObjectUrlComposeRecovery,
  revokeObjectURL?: (url: string) => void
): void {
  const revoke =
    revokeObjectURL ??
    (typeof URL !== "undefined" && URL.revokeObjectURL
      ? (url: string) => URL.revokeObjectURL(url)
      : undefined);
  if (!revoke) return;

  const urls = new Set<string>();
  recovery.topAttachments.forEach(({ previewUrl }) => {
    if (previewUrl) urls.add(previewUrl);
  });
  const collect = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const value = node as {
      attrs?: { previewUrl?: unknown };
      content?: unknown[];
    };
    if (typeof value.attrs?.previewUrl === "string") {
      urls.add(value.attrs.previewUrl);
    }
    value.content?.forEach(collect);
  };
  collect(recovery.snapshot);
  urls.forEach((url) => revoke(url));
}
