export interface ObjectUrlComposeRecovery {
  editorObjectUrls?: Array<{ id: string; url: string }>;
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
  recovery.editorObjectUrls?.forEach(({ url }) => urls.add(url));
  urls.forEach((url) => revoke(url));
}
