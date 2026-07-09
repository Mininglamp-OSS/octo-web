// Structural Excalidraw types for the Yjs binding (whiteboard v1 M2).
//
// The binding is a *fork* of the community y-excalidraw: that library merges each element as one
// opaque LWW blob, which the XIN-24 PoC showed cannot repair dangling bindings / orphan
// bound-text / one-sided boundElements (M-2 / M-5 / M-8). Our fork instead stores each element as
// a per-field `Y.Map` (see the XIN-16 contract §1), which lets a server-authoritative repair pass
// rewrite a single field and lets Yjs merge edits that touch different elements. NOTE: concurrent
// edits to the SAME element still resolve last-writer-wins — the binding CAS-gates each local write
// on the whole element's (version, versionNonce) — so this is NOT a lossless field-level merge; the
// per-field layout is a storage/repair convenience. See yElement.ts / binding.ts for the exact rule.
//
// We model only the slice of Excalidraw's public shape the binding touches and never import
// `@excalidraw/excalidraw` here: the library is loaded with a client-only dynamic import in
// BoardShell, and pulling its `.d.ts` graph into the binding (which must stay node-testable with
// just Yjs) would be dead weight. The host passes the real imperative API in; we type it
// structurally.

/** A JSON-serialisable scalar/array/object stored on an element field. */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

/**
 * The subset of an Excalidraw element the binding reasons about by name. Every *other* field
 * (including fields a newer client version invents) is carried through verbatim — see
 * `IndexableElement` and the unknown-field passthrough contract (XIN-16 §6, M-12).
 */
export interface ExcalidrawElement {
  /** Stable element id; the key under `Y.Map('elements')`. */
  id: string
  /** Element kind (`rectangle` | `arrow` | `text` | `image` | …). */
  type: string
  /** Monotonic per-element edit counter — the primary CAS arbiter (XIN-16 §1.1). */
  version: number
  /** Random tiebreaker when two versions collide (Excalidraw `reconcileElements` rule). */
  versionNonce: number
  /** Tombstone flag. Deleted elements are kept (not key-removed) so deletes converge by version. */
  isDeleted?: boolean
  /** Fractional index string expressing z-order (never array position — avoids reorder drift). */
  index?: string | null
  /** For `image` elements: the logical file id, a key into `Y.Map('files')`. */
  fileId?: string | null
  /** Group membership (subject of half-group repair M-7). */
  groupIds?: string[]
  /** Frame containment (subject of dangling-frame repair M-3). */
  frameId?: string | null
  /** For bound text: the container element id (subject of orphan bound-text repair M-5). */
  containerId?: string | null
  /** Outgoing bindings to other elements (subject of one-sided repair M-8). */
  boundElements?: { id: string; type: string }[] | null
  /** Arrow endpoint binding (subject of dangling-binding repair M-2). */
  startBinding?: { elementId: string } & Record<string, Json> | null
  endBinding?: { elementId: string } & Record<string, Json> | null
  /** Any further fields — known-to-Excalidraw or future/unknown — pass through untouched. */
  [field: string]: Json | undefined | { id: string; type: string }[] | { elementId: string } & Record<string, Json>
}

/** Excalidraw binary file descriptor as handed to `onChange`. Binary stays out of the Y.Doc. */
export interface BinaryFileData {
  id: string
  /** data URL or object-store url — NEVER persisted into the Y.Doc (XIN-16 §2.2). */
  dataURL?: string
  mimeType?: string
  created?: number
  /** Object-store handle returned by the upload endpoint; the ONE file field mirrored into the
   * Y.Doc so a peer can fetch the binary by it (XIN-702). */
  attachId?: string
  [k: string]: Json | undefined
}

/**
 * The imperative Excalidraw API surface the binding drives for remote application. Matches the
 * shape of `ExcalidrawImperativeAPI` (`updateScene` / `getSceneElementsIncludingDeleted`) so the
 * host can pass the real object straight through.
 */
export interface ExcalidrawBindingAPI {
  updateScene(scene: {
    elements?: readonly ExcalidrawElement[]
    /** Suppress capturing this programmatic apply onto Excalidraw's local undo stack (M-9). */
    captureUpdate?: unknown
  }): void
  getSceneElementsIncludingDeleted?(): readonly ExcalidrawElement[]
  /**
   * Push fetched image binaries into the canvas so image elements referencing them render (XIN-702).
   * Matches `ExcalidrawImperativeAPI.addFiles`; optional so the node-test fakes and the pre-mount
   * (null-api) path stay valid.
   */
  addFiles?(files: readonly BinaryFileData[]): void
}
