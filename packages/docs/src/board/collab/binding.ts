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
import { cloneElement, jsonEqual, readAllElements, readElement, upsertElement } from './yElement.ts'
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

/**
 * Host-injected adapter for Excalidraw's official collaboration contract
 * (restore → reconcile → updateScene). It is supplied by BoardShell once the
 * client-only `@excalidraw/excalidraw` chunk has loaded, so the binding never
 * imports Excalidraw and stays node-testable with Yjs alone.
 *
 * Why it exists (XIN-87 root cause): `applyRemote` used to hand the RAW Y.Doc
 * elements straight to `updateScene`. Raw cross-peer / persisted elements are
 * not the fully-hydrated shape Excalidraw renders from (missing computed fields,
 * un-migrated linear `points`, …), so they painted as bare points / handles, and
 * a reopened board replayed empty because `initialData.elements` were raw too.
 * `restoreElements(remote)` rehydrates them; `reconcileElements(local, remote)`
 * then merges by version against the live scene — the contract the upstream
 * y-excalidraw / excalidraw collab clients follow.
 *
 * When no adapter is set the binding keeps the default raw path, which is the
 * path the node unit tests exercise (Excalidraw cannot be imported there).
 */
export interface RenderAdapter {
  /** Rehydrate raw remote elements into renderable Excalidraw elements. */
  restore(remote: readonly ExcalidrawElement[]): ExcalidrawElement[]
  /** Merge restored remote elements with the live local scene by version. */
  reconcile(
    local: readonly ExcalidrawElement[],
    restoredRemote: readonly ExcalidrawElement[],
  ): ExcalidrawElement[]
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
  /** Host-injected restore/reconcile contract (null until BoardShell wires it). */
  private renderAdapter: RenderAdapter | null = null
  private readonly telemetry: BindingTelemetry = emptyTelemetry()
  /** Last element state this binding knows the canvas to hold, keyed by id, for the local diff. */
  private lastKnown = new Map<string, ExcalidrawElement>()
  /**
   * Ids the user has created or edited through a local onChange on THIS canvas. Only these may be
   * tombstoned when they later vanish from an onChange (XIN-96): a remote-rendered element that
   * disappears did so because the canvas reinitialised (cold reopen / reconnect / remount), not
   * because the user deleted it — real deletes arrive as present `isDeleted: true` elements.
   */
  private readonly locallyAuthored = new Set<string>()
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

  /**
   * Inject the Excalidraw restore/reconcile contract (XIN-87 fix). BoardShell calls this once the
   * client-only Excalidraw chunk has loaded; the binding itself never imports Excalidraw. Passing
   * an adapter switches `applyRemote` from the raw path to restore → reconcile → updateScene. If a
   * remote state was already applied raw before this wired up, re-apply it now through the contract
   * so the very first synced scene renders as real shapes rather than points/handles.
   */
  setRenderAdapter(adapter: RenderAdapter | null): void {
    this.renderAdapter = adapter
    if (adapter && this.api && !this.destroyed && this.elements.size > 0) this.applyRemote()
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
      // Snapshot BY VALUE: Excalidraw mutates element objects in place and re-emits the same
      // references, so holding the live `el` would make the next onChange diff the mutated object
      // against itself (jsonEqual short-circuits on `a === b`) and silently drop the geometry
      // update — the XIN-80 symptom where only the 0-size create reached the Y.Doc.
      nextSnapshot.set(el.id, cloneElement(el))
      const prev = this.lastKnown.get(el.id)
      if (!prev || !jsonEqual(prev, el)) {
        changed.push(el)
        // Mark this id as locally authored/edited by the user. A genuine onChange that creates or
        // mutates an element proves the user has this element on THEIR canvas — only such ids may
        // later be tombstoned by absence (see the vanished-element loop below).
        this.locallyAuthored.add(el.id)
      }
    }
    // Elements that vanished from the scene. CRUCIAL (XIN-96): Excalidraw's onChange always carries
    // `getElementsIncludingDeleted()`, so a real user delete arrives as a PRESENT element flagged
    // `isDeleted: true` (handled by the diff loop above) — it is never simply absent. An element is
    // only absent when the canvas was (re)initialised with a different scene: the stale initial
    // onChange a cold reopen fires (empty local-mirror initialData) right after setApi replayed the
    // synced doc, a remount, or a reconnect-driven reset. Tombstoning those wipes exactly the scene
    // that was just synced — the reopen-replays-empty / reconnect-loses-state symptom. So only
    // synthesise a tombstone for an element the user actually authored on this canvas; preserve a
    // remote-rendered element that merely vanished from a reinitialising onChange (the local-write
    // twin of the H1 empty-apply guard).
    for (const [id, prev] of this.lastKnown) {
      if (!nextSnapshot.has(id) && !prev.isDeleted) {
        if (this.locallyAuthored.has(id)) {
          const tomb: ExcalidrawElement = {
            ...prev,
            isDeleted: true,
            version: (typeof prev.version === 'number' ? prev.version : 0) + 1,
          }
          changed.push(tomb)
          nextSnapshot.set(id, tomb)
        } else {
          // Not the user's delete — a scene reinit dropped a remote element. Keep it so the next
          // diff still knows the canvas holds it and the synced scene survives.
          this.telemetry.skippedReinitDrop++
          nextSnapshot.set(id, prev)
        }
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
    // H1 (XIN-85 / reopen-empty): never push an empty scene. A non-local empty transaction — a
    // spurious clear, a foreign key-delete, or an observe firing before any element is present —
    // would otherwise reach updateScene([]) and wipe a canvas the local mirror just seeded, which
    // is the reopen-replays-empty symptom. Deletions in this binding are tombstones (the key, and
    // so `elements.size`, is retained), so a genuine "all deleted" state never hits size 0; size 0
    // means there is simply nothing authoritative to render. Mirrors the `size > 0` guard `setApi`
    // already applies before calling applyRemote (see above).
    if (this.elements.size === 0) {
      this.telemetry.skippedEmptyApply++
      return
    }

    const fileIds = new Set<string>(this.files.keys() as Iterable<string>)
    // Merge-time repair pass (selection B): normalize the rebuilt scene for local render only —
    // dangling boundElements / frameId pruned, unrenderable + dangling-image elements dropped.
    // The result is NEVER written back to the Y.Doc (server repair is authoritative, §4).
    const repaired = repairForRender(readAllElements(this.elements), fileIds)

    // XIN-87 root-cause fix: when the host has wired the restore/reconcile contract, run it before
    // updateScene. `restore` rehydrates the raw Y.Doc elements into renderable Excalidraw shapes
    // (the missing step that made them paint as points/handles); `reconcile` merges them with the
    // live local scene by version so a concurrent local edit is not clobbered. Without an adapter
    // (the node unit-test path, where Excalidraw cannot be imported) we keep the raw elements.
    let elements = repaired
    const adapter = this.renderAdapter
    if (adapter) {
      const restored = adapter.restore(repaired)
      const local = this.api?.getSceneElementsIncludingDeleted?.() ?? []
      elements = adapter.reconcile(local, restored)
    }

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
    // Clone by value (XIN-92): `elements` here are the live scene objects Excalidraw will mutate
    // in place on a later local edit; holding the live reference would blind the next diff to that
    // edit exactly as it does on the local-create path.
    const snap = new Map<string, ExcalidrawElement>()
    for (const el of elements) snap.set(el.id, cloneElement(el))
    this.lastKnown = snap
    this.telemetry.remoteApplies++
    this.telemetry.remoteElements += elements.length
  }

  /**
   * Current raw Y.Doc elements, by value. BoardShell seeds Excalidraw's `initialData` from this on
   * a cold reopen (XIN-96): a fresh client's local mirror is empty, but the provider has usually
   * synced the board into the Y.Doc before the heavy Excalidraw chunk loads. Mounting the canvas
   * WITH this state (restored) means Excalidraw initialises with the scene instead of empty — so it
   * neither clobbers the setApi replay nor fires a stale empty onChange that wipes the board.
   */
  snapshotElements(): ExcalidrawElement[] {
    return readAllElements(this.elements)
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
