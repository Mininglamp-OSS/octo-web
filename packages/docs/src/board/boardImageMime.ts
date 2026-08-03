/** Content-sniff an SVG root so upload routing never trusts Excalidraw MIME metadata alone. */
export async function blobIsSvg(blob: Blob): Promise<boolean> {
  try {
    const prefix = await blob.slice(0, Math.min(blob.size, 64 * 1024)).text()
    return /<svg(?:\s|>)/i.test(prefix)
  } catch {
    return false
  }
}

/**
 * Normalize untrusted Excalidraw MIME metadata and force SVG bytes onto the dedicated sanitizer
 * endpoint. Empty/mixed-case metadata and mislabeled SVG content are all handled fail-closed.
 */
export async function classifyBoardImage(blob: Blob, fileMime?: string): Promise<{
  mime: string
  isSvg: boolean
}> {
  const declaredMime = (fileMime || blob.type || '').trim().toLowerCase()
  const isSvg = declaredMime === 'image/svg+xml' || declaredMime === 'image/svg' || await blobIsSvg(blob)
  return {
    isSvg,
    mime: isSvg ? 'image/svg+xml' : (declaredMime || 'application/octet-stream'),
  }
}
