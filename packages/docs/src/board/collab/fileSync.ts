// Whiteboard image binary sync helpers (XIN-702).
//
// Three concerns live here, all kept out of the Yjs binding so the binding stays node-testable and
// never imports DOM / Excalidraw:
//
//   1. A deterministic file-id hash that does NOT use `crypto.subtle` (P1 digest crash). Excalidraw
//      0.18.1's built-in `generateIdFromFile` calls `crypto.subtle.digest`, which is undefined in an
//      insecure context (plain http on a LAN IP) and throws — caught upstream into a nanoid fallback,
//      but it logs a red error and yields a NON-deterministic file id, so the same image inserted
//      twice (or on two peers) gets two ids. `makeGenerateIdForFile` is passed to Excalidraw's
//      `generateIdForFile` prop so the id is derived from the bytes with a plain FNV-1a hash that
//      works everywhere and is stable across peers.
//
//   2. `dataURLToBlob` — turn Excalidraw's in-memory `BinaryFileData.dataURL` into a Blob so the raw
//      bytes can be PUT to object storage on insert (base64 never enters the Y.Doc — XIN-16 §2.2).
//
//   3. `blobToDataURL` — turn a fetched object-storage Blob back into a data URL so a peer can
//      `addFiles()` it into Excalidraw and render the image instead of a grey placeholder.

/**
 * FNV-1a 64-bit hash of raw bytes → lowercase hex string. Deterministic, dependency-free, and — the
 * point of it — never touches `crypto.subtle`, so it produces a stable file id in an insecure
 * context (http on a LAN IP) where `crypto.subtle` is undefined and Excalidraw's own digest throws.
 */
export function hashBytesToId(bytes: Uint8Array): string {
  // 64-bit FNV-1a via two 32-bit halves (JS has no native 64-bit int arithmetic without BigInt; two
  // 32-bit lanes keep it fast and allocation-free while still spreading well across the byte stream).
  let h1 = 0x811c9dc5 // low 32 bits of the FNV offset basis
  let h2 = 0xcbf29ce4 // high 32 bits
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    h1 ^= b
    h2 ^= b
    // multiply by the FNV prime (0x100000001b3) across the two lanes, keeping each lane 32-bit.
    h1 = Math.imul(h1, 0x01000193) >>> 0
    h2 = (Math.imul(h2, 0x01000193) + (i & 0xff)) >>> 0
  }
  const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0')
  return hex(h2) + hex(h1)
}

/** Minimal structural view of the browser `File` the id generator needs — just the byte source. */
export interface FileLike {
  arrayBuffer(): Promise<ArrayBuffer>
}

/**
 * Build the function passed to Excalidraw's `generateIdForFile` prop. Reads the file bytes and hashes
 * them with `hashBytesToId`, so the id is content-addressed and identical across peers and reloads —
 * and, critically, derived WITHOUT `crypto.subtle`, so inserting an image on a plain-http LAN neither
 * throws nor logs the digest error (P1). Returns a Promise<string>, matching Excalidraw's contract.
 */
export function makeGenerateIdForFile(): (file: FileLike) => Promise<string> {
  return async (file: FileLike): Promise<string> => {
    const buf = await file.arrayBuffer()
    return hashBytesToId(new Uint8Array(buf))
  }
}

/**
 * Decode a `data:` URL into a Blob so the raw bytes can be uploaded to object storage. Returns null
 * for anything that is not a base64 data URL (e.g. an already-remote object-store URL, or malformed
 * input) so the caller can skip it rather than upload garbage.
 */
export function dataURLToBlob(dataURL: string): Blob | null {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataURL)
  if (!match) return null
  const mime = match[1] || 'application/octet-stream'
  const isBase64 = Boolean(match[2])
  const data = match[3]
  try {
    if (isBase64) {
      const binary = atob(data)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return new Blob([bytes], { type: mime })
    }
    return new Blob([decodeURIComponent(data)], { type: mime })
  } catch {
    return null
  }
}

/** Read a Blob (a freshly fetched object-storage binary) into a data URL for `addFiles()`. */
export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('failed to read blob'))
    reader.readAsDataURL(blob)
  })
}
