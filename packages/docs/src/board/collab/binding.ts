// Excalidraw ⇄ Yjs bidirectional binding (whiteboard v1 M2, forked from y-excalidraw).
//
// The loop, and the THREE anti-self-excitation guards the PoC (XIN-24) validated, plus the 4th
// guard the XIN-16 contract (§4.2) added for server-authoritative repair:
//
//   local edit ──onChange──▶ diff vs snapshot ──▶ Y.Doc transact(LOCAL_ORIGIN), CAS per element
//   remote/repair write ──observe──▶ (origin ≠ LOCAL) ──▶ updateScene ──▶ resync snapshot
//
//   Guard 1 (origin):     observe ignores transactions whose origin is LOCAL_ORIGIN — our own
//                         writes are already on the canvas, re-applying them would loop.
//   Guard 2 (empty diff):  a local onChange that differs in no field from the last-known snapshot
//                         produces no transaction (and per-element CAS still drops stale fields).
//   Guard 3 (applying):    while a remote apply is running, onChange is short-circuited so the
//                         updateScene-triggered callback cannot bounce straight back into a write.
//   Guard 4 (repair sync): after applying a remote/repair write we resync the snapshot to the
//                         APPLIED state (including a server-bumped version), so the onChange that
//                         updateScene triggers diffs empty instead of treating the server's repair
//                         as a fresh local edit and writing it back — the cross-peer repair loop
//                         XIN-16 §4.2 calls out.
//
// Files: image binaries never enter the Y.Doc. Only reference metadata (fileId → {mimeType,…},
// dataURL stripped) is mirrored into Y.Map('files') (XIN-16 §2.2). appState is not bound at all.

import * as Y from 'yjs'
import { ELEMENTS_FIELD, FILES_FIELD, REPAIR_ORIGIN } from './schema.ts'
import { shouldOverwrite } from './reconcile.ts'
import { jsonEqual, readAllElements, readElement, upsertElement } from './yElement.ts'
import { repairForRender } from './repair.ts'
import {
  AwarenessSurface,
  emptyTelemetry,
  type AwarenessState,
  type BindingTelemetry,
} from './telemetry.ts'
import type { BinaryFileData, ExcalidrawBindingAPI, ExcalidrawElement, Json } from './types.ts'

/** Transaction origin for genuine local user edits — the only origin the binding writes under. */
export const LOCAL_ORIGIN = Symbol('octo-wb-local')
/**
 * Origin tag for the server-authoritative repair pass (the shared `'wb-repair'` constant). The
 * FE never writes under it (repair is backend-authoritative, XIN-16 §4); it is re-exported so the
 * FE recognises a repair-origin transaction as remote (→ render), never as its own write.
 */
export { REPAIR_ORIGIN }

export interface WhiteboardBindingOptions {
  /** Imperative Excalidraw API; may be supplied later via `setApi` (the canvas mounts async). */
  api?: ExcalidrawBindingAPI | null
  /** Build an undo manager scoped to local edits only (M-9). Default true. */
  enableUndo?: boolean
}

/** Strip a BinaryFileData down to Y.Doc-safe reference metadata (no dataURL/base64). */
function toFileRef(file: BinaryFileData): Record<string, Json> {
  const ref: Record<string, Json> = { id: file.id }
  if (typeof file.mimeType === 'string') ref.mimeType = file.mimeType
  if (typeof file.created === 'number') ref.created = file.created
  // attachId is the object-store handle once the upload link is wired; mirror it when present.
  if (typeof (file as Record<string, unknown>).attachId === 'string') {
    ref.attachId = (file as Record<string, unknown>).attachId as string
  }
  if (typeof (file as Record<string, unknown>).status === 'string') {
    ref.status = (file as Record<string, unknown>).status as string
  }
  // dataURL / blob / base64 are deliberately NOT copied — binary stays in object storage.
  return ref
}

export class ExcalidrawYjsBinding {
  readonly ydoc: Y.Doc
  readonly elements: Y.Map<Y.Map<unknown>>
  readonly files: Y.Map<Y.Map<unknown>>
  readonly undoManager: Y.UndoManager | null
  readonly __awareness = new AwarenessSurface()

  private api: ExcalidrawBindingAPI | null
  private readonly telemetry: BindingTelemetry = emptyTelemetry()
  /** Last element state this binding knows the canvas to hold, keyed by id, for the local diff. */
  private lastKnown = new Map<string, ExcalidrawElement>()
  /** Guard 3 flag: a remote apply is in flight. */
  private applyingRemote = false
  private destroyed = false
  private readonly onElements: (events: Y.YEvent<Y.Map<unknown>>[], txn: Y.Transaction) => void

  constructor(ydoc: Y.Doc, opts: WhiteboardBindingOptions = {}) {
    this.ydoc = ydoc
    this.elements = ydoc.getMap<Y.Map<unknown>>(ELEMENTS_FIELD)
    this.files = ydoc.getMap<Y.Map<unknown>>(FILES_FIELD)
    this.api = opts.api ?? null

    // M-9: undo manager tracks ONLY local edits, so a remote peer's change or a server repair
    // never lands on this user's undo stack.
    this.undoManager =
      opts.enableUndo === false
        ? null
        : new Y.UndoManager(this.elements, { trackedOrigins: new Set([LOCAL_ORIGIN]) })

    // Seed the snapshot from whatever the doc already holds (reconnect / offline restore).
    for (const el of readAllElements(this.elements)) this.lastKnown.set(el.id, el)

    this.onElements = (_events, txn) => this.onRemote(txn)
    this.elements.observeDeep(this.onElements)
  }

  /** Read-only telemetry snapshot (frontend-design §5.7.4). */
  get __telemetry(): Readonly<BindingTelemetry> {
    return { ...this.telemetry }
  }

  /** Attach (or replace) the imperative Excalidraw API once the canvas has mounted. */
  setApi(api: ExcalidrawBindingAPI | null): void {
    this.api = api
    // The canvas mounts asynchronously (BoardShell dynamic-imports Excalidraw), so by the time the
    // api attaches the provider — and the IndexedDB cache — have very likely ALREADY synced remote
    // state into the Y.Doc. Every applyRemote() that ran while `this.api` was null was a silent
    // no-op (`this.api?.updateScene`), and guard 4 then resynced the snapshot to that state, so no
    // later observe event will re-push it. Replay the current doc onto the freshly-attached canvas
    // so B catches up the state it received before it had somewhere to draw it (XIN-85). Guarded on
    // a non-empty doc so a fresh board that only holds local `initialData` is not wiped to empty
    // before its first onChange seeds the doc.
    if (api && !this.destroyed && this.elements.size > 0) this.applyRemote()
  }

  /** Update local presence (selection/cursor). Never touches the Y.Doc (XIN-16 §7). */
  setAwareness(state: AwarenessState | null): void {
    this.__awareness.setLocalState(state)
  }

  // ── local → Y.Doc ──────────────────────────────────────────────────────────────────────────

  /**
   * Feed an Excalidraw `onChange` into the Y.Doc. Pass the elements (and optional files) exactly
   * as Excalidraw hands them. Wire this from BoardShell's `onChange`.
   */
  handleLocalChange(
    elements: readonly ExcalidrawElement[],
    files?: Record<string, BinaryFileData> | null,
  ): void {
    if (this.destroyed) return
    // Guard 3: ignore the onChange that our own updateScene just triggered.
    if (this.applyingRemote) {
      this.telemetry.skippedApplyingRemote++
      return
    }
    this.telemetry.localChanges++

    // Diff vs the last-known snapshot: which elements did the *user* actually change?
    const changed: ExcalidrawElement[] = []
    const nextSnapshot = new Map<string, ExcalidrawElement>()
    for (const el of elements) {
      nextSnapshot.set(el.id, el)
      const prev = this.lastKnown.get(el.id)
      if (!prev || !jsonEqual(prev, el)) changed.push(el)
    }
    // Elements that vanished from the scene are deleted via tombstone, not by removing the key.
    for (const [id, prev] of this.lastKnown) {
      if (!nextSnapshot.has(id) && !prev.isDeleted) {
        const tomb: ExcalidrawElement = {
          ...prev,
          isDeleted: true,
          version: (typeof prev.version === 'number' ? prev.version : 0) + 1,
        }
        changed.push(tomb)
        nextSnapshot.set(id, tomb)
      }
    }

    const fileEntries = files ? Object.values(files) : []
    // Guard 2: nothing changed → no transaction at all.
    if (changed.length === 0 && fileEntries.length === 0) {
      this.telemetry.skippedEmptyDiff++
      this.lastKnown = nextSnapshot
      return
    }

    let wrote = 0
    this.ydoc.transact(() => {
      for (const el of changed) {
        // CAS vs the current authoritative value: a concurrent remote write may already have
        // advanced this element past the local version — then the local edit is stale, drop it.
        const current = this.elements.get(el.id)
        const stamp = current ? readElement(current) : null
        if (!shouldOverwrite(stamp, el)) {
          this.telemetry.casRejected++
          continue
        }
        if (upsertElement(this.elements, el)) {
          this.telemetry.localWrites++
          wrote++
        }
      }
      // Files: mirror reference metadata only; binary never enters the Y.Doc.
      for (const file of fileEntries) {
        if (!file?.id) continue
        let yFile = this.files.get(file.id)
        if (!yFile) {
          yFile = new Y.Map<unknown>()
          this.files.set(file.id, yFile)
        }
        const ref = toFileRef(file)
        for (const [k, v] of Object.entries(ref)) {
          if (!yFile.has(k) || !jsonEqual(yFile.get(k), v)) yFile.set(k, v)
        }
      }
    }, LOCAL_ORIGIN)

    if (wrote === 0 && changed.length > 0 && fileEntries.length === 0) {
      // Everything was CAS-rejected: no element actually written.
      this.telemetry.skippedEmptyDiff++
    }
    this.lastKnown = nextSnapshot
  }

  // ── Y.Doc → canvas ─────────────────────────────────────────────────────────────────────────

  private onRemote(txn: Y.Transaction): void {
    if (this.destroyed) return
    // Guard 1: our own local write — already on the canvas, do not re-apply (would loop).
    if (txn.origin === LOCAL_ORIGIN) {
      this.telemetry.skippedOwnOrigin++
      return
    }
    this.applyRemote()
  }

  /** Rebuild the scene from the authoritative Y.Doc state and resync the snapshot (guard 4). */
  private applyRemote(): void {
    const fileIds = new Set<string>(this.files.keys() as Iterable<string>)
    // Merge-time repair pass (selection B): normalize the rebuilt scene for local render only —
    // dangling boundElements / frameId pruned, unrenderable + dangling-image elements dropped.
    // The result is NEVER written back to the Y.Doc (server repair is authoritative, §4).
    const elements = repairForRender(readAllElements(this.elements), fileIds)
    this.applyingRemote = true
    try {
      // `captureUpdate: 'NEVER'` mirrors Excalidraw's `CaptureUpdateAction.NEVER` (the value is the
      // literal "NEVER", uppercase) so a remote/repair apply does NOT land on this user's local undo
      // stack (M-9). A lowercase 'never' is not a recognised CaptureUpdateActionType and silently
      // falls back to capturing the apply into history.
      this.api?.updateScene({ elements, captureUpdate: 'NEVER' })
    } finally {
      this.applyingRemote = false
    }
    // Guard 4 (XIN-16 §4.2): snapshot the APPLIED (repaired) state so the onChange this
    // updateScene triggers diffs empty rather than writing the repaired scene straight back.
    const snap = new Map<string, ExcalidrawElement>()
    for (const el of elements) snap.set(el.id, el)
    this.lastKnown = snap
    this.telemetry.remoteApplies++
    this.telemetry.remoteElements += elements.length
  }

  /** For the Agent / external write path (XIN-16 §5): force a re-read into the canvas. */
  refreshFromDoc(): void {
    this.applyRemote()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.elements.unobserveDeep(this.onElements)
    this.undoManager?.destroy()
  }
}
