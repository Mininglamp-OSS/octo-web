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
// dataURL stripped) is mirrored into Y.Map('files') (XIN-16 §2.2). Of appState, only the canvas
// background colour is bound — through its own flat Y.Map('appState') (PR #1161); all other appState
// (selection, scroll, zoom, dialogs, collaborators) stays local and unsynced.

import * as Y from 'yjs'
import {
  ELEMENTS_FIELD,
  FILES_FIELD,
  APPSTATE_FIELD,
  VIEW_BACKGROUND_COLOR_KEY,
  DEFAULT_VIEW_BACKGROUND_COLOR,
  REPAIR_ORIGIN,
  buildFileRef,
  normalizeFileRef,
  FILE_REF_STATUS,
  type FileRef,
} from './schema.ts'
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

/** Minimal file-ref shape handed to the fetcher: enough to fetch the binary by its object handle. */
export interface FileFetchRef {
  /** Excalidraw file id (the key under `Y.Map('files')` and the element's `fileId`). */
  id: string
  /** Object-store handle returned by the upload endpoint. */
  attachId: string
  mimeType?: string
}

/**
 * Upload a freshly inserted image binary to object storage and return its durable `attachId`
 * (or null if the upload was skipped / failed). Injected by the host (BoardShell) so the binding
 * never imports the REST client and stays node-testable — the tests pass a fake.
 */
export type FileUploader = (file: BinaryFileData) => Promise<string | null>

/**
 * Fetch one or more image binaries by their `attachId` and return the `BinaryFileData` entries (each
 * with a `dataURL`) ready to `addFiles()` into the canvas. Injected by the host. BATCH by design:
 * the binding hands every file ref that became fetchable in a single apply at once, so the host can
 * use the backend `POST /attachments/resolve` batch endpoint (one signed-URL round trip for N images)
 * instead of N single GETs. Refs that cannot be resolved are simply omitted from the result; the next
 * apply retries them. The returned order does not matter — each entry carries its own `id`.
 */
export type FileFetcher = (refs: readonly FileFetchRef[]) => Promise<readonly BinaryFileData[]>

/**
 * Host-injected object-storage bridge (XIN-702). `uploader` runs on local insert and writes the
 * returned `attachId` into the Y.Doc file ref so peers can fetch it; `fetcher` runs on remote apply
 * to pull the binary a peer authored and paint it. Either may be omitted (M1 standalone / no backend
 * → images stay local-only, no upload/fetch).
 */
export interface FileSync {
  uploader?: FileUploader | null
  fetcher?: FileFetcher | null
}

/**
 * Build the canonical `files[fileId]` reference the Y.Doc stores for an image (XIN-702). The binary
 * NEVER enters the Y.Doc — only the object-store `attachId` plus `mimeType` / `status` / `createdAt`
 * (the FILE_REF_FIELDS the backend and frontend share via `@octo/whiteboard-schema`). Excalidraw's
 * `BinaryFileData.created` maps to the ref's `createdAt`; `dataURL` / `blob` are deliberately never
 * copied. Returns null when the file has no usable `attachId` yet — a ref with no attachId is the
 * grey-placeholder bug in data form, so nothing is written until the upload confirms one.
 */
function toSavedFileRef(file: BinaryFileData): FileRef | null {
  const attachId = typeof file.attachId === 'string' ? file.attachId : ''
  if (attachId.length === 0) return null
  return buildFileRef({
    attachId,
    mimeType: typeof file.mimeType === 'string' ? file.mimeType : undefined,
    status: FILE_REF_STATUS.saved,
    createdAt: typeof file.created === 'number' ? file.created : undefined,
  })
}

/** Read a per-file `Y.Map` into a plain object so the shared `normalizeFileRef` rule can vet it. */
function readFileEntry(yFile: Y.Map<unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of yFile.entries()) out[k] = v
  return out
}

export class ExcalidrawYjsBinding {
  readonly ydoc: Y.Doc
  readonly elements: Y.Map<Y.Map<unknown>>
  readonly files: Y.Map<Y.Map<unknown>>
  /** Flat scene-level appState container (PR #1161). Today holds only `viewBackgroundColor`. */
  readonly appState: Y.Map<unknown>
  readonly undoManager: Y.UndoManager | null
  readonly __awareness = new AwarenessSurface()

  private api: ExcalidrawBindingAPI | null
  /** Host-injected restore/reconcile contract (null until BoardShell wires it). */
  private renderAdapter: RenderAdapter | null = null
  /** Host-injected object-storage bridge for image binaries (null until BoardShell wires it). */
  private fileSync: FileSync | null = null
  /** File ids whose upload is in flight, so a re-emitted onChange does not upload the same binary twice. */
  private readonly uploadingFileIds = new Set<string>()
  /** File ids this client already uploaded (attachId mirrored) — never re-upload, never re-fetch. */
  private readonly uploadedFileIds = new Set<string>()
  /** File ids this client holds the binary for locally (inserted here) — skip the rehydrate fetch. */
  private readonly localFileIds = new Set<string>()
  /** File ids whose rehydrate fetch is in flight, so overlapping applies do not double-fetch. */
  private readonly fetchingFileIds = new Set<string>()
  /** File ids already fetched + addFiles()'d into this canvas — fetch each remote binary once. */
  private readonly fetchedFileIds = new Set<string>()
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
  /**
   * Ids that have ever arrived from the authoritative Y.Doc through `applyRemote` — i.e. elements
   * that exist (or existed) on a peer, not born from a local create on this canvas. Kept alongside
   * `locallyAuthored` to close the XIN-96 hole: `locallyAuthored` grows the instant the user so much
   * as nudges a REMOTE element (move / recolour), which used to make that element permanently
   * tombstone-eligible. A later same-instance reinit onChange (reconnect / remount / reconnect-reset)
   * then reports it absent with `applyingRemote` false and — because it was in `locallyAuthored` —
   * synthesised a tombstone that deleted a live element for every collaborator. A remote-origin id is
   * therefore NEVER tombstoned by mere absence: its disappearance is a reinit, and a genuine delete
   * of it still arrives as a present `isDeleted: true` element (handled by the diff loop). Only a
   * purely-local element — authored here and never seen from the doc — may be tombstoned by absence.
   */
  private readonly remoteOrigin = new Set<string>()
  /** Guard 3 flag: a remote apply is in flight. */
  private applyingRemote = false
  /**
   * Provider sync state — the canvas-background authority gate (PR #1161, yujiawei P1-1). The
   * background is mirrored to the shared doc ONLY once this is true: a client whose canvas mounts
   * before its provider has synced fires an onChange on Excalidraw's `#ffffff` default, and writing
   * that pre-sync default could clobber an authoritative colour for every peer. BoardShell drives it
   * from the provider `synced` signal via {@link setSynced}. Defaults false → fail closed (never
   * write a background until sync has established the authoritative baseline).
   */
  private synced = false
  /**
   * Last canvas background colour this binding knows the canvas + doc to hold (PR #1161). The
   * appState twin of `lastKnown` for elements: a local onChange whose colour equals this produces no
   * write (guard 2), and a remote apply equal to this is skipped, so the two never ping-pong.
   */
  private lastKnownBg: string | null = null
  private destroyed = false
  private readonly onElements: (events: Y.YEvent<Y.Map<unknown>>[], txn: Y.Transaction) => void
  private readonly onFiles: (events: Y.YEvent<Y.Map<unknown>>[], txn: Y.Transaction) => void
  private readonly onAppState: (event: Y.YMapEvent<unknown>, txn: Y.Transaction) => void

  constructor(ydoc: Y.Doc, opts: WhiteboardBindingOptions = {}) {
    this.ydoc = ydoc
    this.elements = ydoc.getMap<Y.Map<unknown>>(ELEMENTS_FIELD)
    this.files = ydoc.getMap<Y.Map<unknown>>(FILES_FIELD)
    this.appState = ydoc.getMap<unknown>(APPSTATE_FIELD)
    this.api = opts.api ?? null

    // M-9: undo manager tracks ONLY local edits, so a remote peer's change or a server repair
    // never lands on this user's undo stack.
    this.undoManager =
      opts.enableUndo === false
        ? null
        : new Y.UndoManager(this.elements, { trackedOrigins: new Set([LOCAL_ORIGIN]) })

    // Seed the snapshot from whatever the doc already holds (reconnect / offline restore). Anything
    // already in the doc at construction pre-existed this canvas instance — it is remote-origin, so
    // record it as such and it can never be tombstoned by a later reinit-absence (P0 / XIN-96).
    for (const el of readAllElements(this.elements)) {
      this.lastKnown.set(el.id, el)
      this.remoteOrigin.add(el.id)
    }

    this.onElements = (_events, txn) => this.onRemote(txn)
    this.elements.observeDeep(this.onElements)

    // Files map observer (XIN-702): image binaries sync in two steps — a peer syncs the image
    // element first, then (asynchronously, after the upload resolves) writes the attachId onto the
    // file ref. The elements observer already fired for step 1, so without watching files too a
    // late attachId would never trigger a fetch and the image would stay a grey placeholder until an
    // unrelated element edit. Our OWN attachId write is LOCAL_ORIGIN (and its file is in
    // localFileIds), so skip it; any other file change rehydrates. rehydrateFiles is idempotent.
    this.onFiles = (_events, txn) => {
      if (this.destroyed || txn.origin === LOCAL_ORIGIN) return
      this.rehydrateFiles()
    }
    this.files.observeDeep(this.onFiles)

    // appState observer (PR #1161): a remote / repair write to the canvas background colour must
    // reach the canvas. Its own flat Y.Map is watched shallowly — our own writes are LOCAL_ORIGIN
    // (guard 1) and re-applying them would loop; any other change repaints the background.
    this.onAppState = (_events, txn) => {
      if (this.destroyed || txn.origin === LOCAL_ORIGIN) return
      this.applyRemoteAppState()
    }
    this.appState.observe(this.onAppState)
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
    // Replay the synced canvas background too (PR #1161): like elements, an appState value the
    // provider synced while `api` was null never reached a canvas. Independent of the element guard
    // above — a board may carry a background colour with no elements yet.
    if (api && !this.destroyed) this.applyRemoteAppState()
  }

  /**
   * Update the provider sync state — the canvas-background authority gate (PR #1161, yujiawei P1-1).
   * BoardShell drives this from the collab provider's `synced` signal. While false, the onChange
   * background mirror ({@link mirrorLocalBackgroundColor}) writes nothing, so a client whose canvas
   * mounted on Excalidraw's `#ffffff` default before its provider synced cannot push that default
   * into the shared doc and clobber an authoritative colour. On the false→true transition we replay
   * the doc's background onto the canvas ({@link applyRemoteAppState}) so `lastKnownBg` is seeded to
   * the AUTHORITATIVE value before the first synced onChange is allowed to mirror — otherwise that
   * first onChange, carrying the stale mount colour, could diff against a null baseline and overwrite
   * the synced colour. Remote-direction replay, so it is itself unaffected by the gate.
   */
  setSynced(synced: boolean): void {
    if (this.destroyed) return
    const was = this.synced
    this.synced = synced
    if (synced && !was) this.applyRemoteAppState()
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

  /**
   * Inject the object-storage bridge for image binaries (XIN-702). BoardShell wires this once the
   * board's docId + REST client are available; the binding itself never imports the client. Setting
   * a fetcher and re-running the apply lets an already-synced board rehydrate its images the moment
   * the bridge attaches (e.g. the canvas mounted before the fetcher was ready).
   */
  setFileSync(sync: FileSync | null): void {
    this.fileSync = sync
    if (sync?.fetcher && this.api && !this.destroyed && this.elements.size > 0) this.rehydrateFiles()
  }

  /** Update local presence (selection/cursor). Never touches the Y.Doc (XIN-16 §7). */
  setAwareness(state: AwarenessState | null): void {
    this.__awareness.setLocalState(state)
  }

  // ── local → Y.Doc ──────────────────────────────────────────────────────────────────────────

  /** Feed Excalidraw elements and optional files into the Y.Doc. Wire from BoardShell's `onChange`. */
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
    let reinitDropped = 0
    for (const [id, prev] of this.lastKnown) {
      if (!nextSnapshot.has(id) && !prev.isDeleted) {
        // Only a PURELY-LOCAL element (authored on this canvas and never seen from the doc) may be
        // tombstoned by absence. A remote-origin id — even one the user later nudged, which put it in
        // `locallyAuthored` — is preserved: its absence is a scene reinit, and a real delete of it
        // would arrive as a present `isDeleted: true` element (handled above), never as bare absence.
        // This is the XIN-96 hole closed: touching a remote element must not make it delete-on-reinit.
        if (this.locallyAuthored.has(id) && !this.remoteOrigin.has(id)) {
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
          reinitDropped++
          nextSnapshot.set(id, prev)
        }
      }
    }

    const fileEntries = files ? Object.values(files) : []
    // Guard 2: nothing changed → no transaction at all.
    if (changed.length === 0 && fileEntries.length === 0) {
      this.telemetry.skippedEmptyDiff++
      this.lastKnown = nextSnapshot
      // The render half (XIN-98): even with no write, if this reinit onChange dropped preserved
      // remote elements, the canvas was just repainted WITHOUT them — repaint from the doc so the
      // restored elements actually paint back.
      this.repaintAfterReinitDrop(reinitDropped)
      return
    }

    let wrote = 0
    const rejectedIds: string[] = []
    this.ydoc.transact(() => {
      for (const el of changed) {
        // CAS vs the current authoritative value: a concurrent remote write may already have
        // advanced this element past the local version — then the local edit is stale, drop it.
        //
        // ⚠️ This gate is WHOLE-ELEMENT (version, versionNonce), so merge is last-writer-wins per
        // element, NOT lossless field-level merge: when a concurrent peer edit wins the tie, the
        // whole local element is dropped here (and, symmetrically, a winning local write rewrites
        // every changed field, overwriting a peer's concurrent field edit on the same element). The
        // per-field Y.Map layout only helps edits to different elements / non-concurrent fields. See
        // the module note in yElement.ts (P1-5 / XIN-517).
        const current = this.elements.get(el.id)
        const stamp = current ? readElement(current) : null
        if (!shouldOverwrite(stamp, el)) {
          this.telemetry.casRejected++
          rejectedIds.push(el.id)
          continue
        }
        if (upsertElement(this.elements, el)) {
          this.telemetry.localWrites++
          wrote++
        }
      }
      // Files: mirror the canonical reference only; the binary never enters the Y.Doc. A freshly
      // inserted image has no attachId yet — startUpload (below) writes the saved ref once the
      // object store confirms one. A file that already carries an attachId (re-emit / round-trip) is
      // mirrored here immediately.
      for (const file of fileEntries) {
        if (!file?.id) continue
        // This client holds the binary for anything it just inserted — never fetch it back later.
        if (typeof file.dataURL === 'string' && file.dataURL.length > 0) this.localFileIds.add(file.id)
        const ref = toSavedFileRef(file)
        if (ref) this.writeFileRef(file.id, ref)
      }
    }, LOCAL_ORIGIN)

    // Upload-on-insert (XIN-702): after mirroring the refs, upload any freshly inserted image binary
    // to object storage and write the returned attachId back into the Y.Doc ref, so a peer can fetch
    // it. Runs OUTSIDE the transaction (it is async) and dedupes on the in-flight / done sets.
    for (const file of fileEntries) {
      if (file?.id) this.startUpload(file)
    }

    if (wrote === 0 && changed.length > 0 && fileEntries.length === 0) {
      // Everything was CAS-rejected: no element actually written.
      this.telemetry.skippedEmptyDiff++
    }
    // CAS-reject baseline resync (P2): a rejected local edit LOST the version race, so the
    // authoritative doc still holds the winning value — but nextSnapshot currently carries the
    // LOSING local element for that id (it was snapshotted by value before the CAS gate). Replace
    // each rejected id's baseline with the authoritative doc value so the next onChange diffs
    // against truth: without this the baseline disagreed with the doc until the next remote apply
    // re-snapshotted it (self-heals, but this closes the window and stops a re-emitted stale edit
    // from silently diffing empty against its own losing baseline).
    for (const id of rejectedIds) {
      const current = this.elements.get(id)
      if (current) nextSnapshot.set(id, readElement(current))
      else nextSnapshot.delete(id)
      this.telemetry.casResynced++
    }
    this.lastKnown = nextSnapshot
    // Render half (XIN-98): a reinit onChange may both carry genuine local edits AND drop preserved
    // remote elements. Repaint after the snapshot is set so the dropped-but-preserved elements come
    // back on the canvas (the write above already covers the user's own edits).
    this.repaintAfterReinitDrop(reinitDropped)
  }

  /**
   * Mirror canvas background state into the Y.Doc (PR #1161). BoardShell calls this from both the
   * generic Excalidraw onChange and the explicit picker after checking the live provider sync state.
   * Today only `viewBackgroundColor` is bound.
   *
   * Version-history capture is intentionally not claimed for this container until the backend
   * serializer adopts these names (see collab/schema.ts).
   */
  handleLocalAppState(appState: { viewBackgroundColor?: unknown } | null | undefined): void {
    this.mirrorLocalBackgroundColor(appState?.viewBackgroundColor)
  }

  /**
   * The single canvas-background write path into the Y.Doc (PR #1161, yujiawei P1-1). THE AUTHORITY
   * GATE: a write only happens once
   * the provider has synced (`this.synced`) AND the canvas is wired (`this.api`). Before either, a
   * client whose canvas mounted on Excalidraw's `#ffffff` default fires onChange carrying that
   * default; writing it could let a passive peer silently overwrite an authoritative background for
   * everyone (`Y.Map` resolves the concurrent key conflict by client id). `setSynced(true)` seeds
   * `lastKnownBg` from the doc before the gate opens, so the first synced onChange diffs against the
   * AUTHORITATIVE colour, not a null baseline.
   *
   * Guards mirror the element path: guard 3 (`applyingRemote`) drops a write during a remote apply;
   * guard 2 short-circuits when the colour already equals `lastKnownBg` or the effective
   * authoritative doc value (an unset key counts as {@link DEFAULT_VIEW_BACKGROUND_COLOR}, so a fresh
   * board's `#ffffff` default never writes a spurious explicit default, while a reset FROM a non-
   * default colour BACK to the default does write so peers converge). Written under LOCAL_ORIGIN so
   * our own observer ignores it.
   */
  private mirrorLocalBackgroundColor(color: unknown): void {
    if (this.destroyed || this.applyingRemote) return
    // Authority gate: never write a background until synced AND the canvas is attached.
    if (!this.synced || !this.api) return
    if (typeof color !== 'string' || color.length === 0) return
    if (color === this.lastKnownBg) return
    const docColor = this.appState.get(VIEW_BACKGROUND_COLOR_KEY)
    const effective =
      typeof docColor === 'string' && docColor.length > 0 ? docColor : DEFAULT_VIEW_BACKGROUND_COLOR
    // Already the effective authoritative value (the first onChange echoing a doc-seeded
    // initialData, or a fresh board's #ffffff against an unset key): record it and write nothing, so
    // we never emit an empty/no-op LOCAL transaction.
    if (color === effective) {
      this.lastKnownBg = color
      return
    }
    this.lastKnownBg = color
    this.ydoc.transact(() => this.appState.set(VIEW_BACKGROUND_COLOR_KEY, color), LOCAL_ORIGIN)
    this.telemetry.localWrites++
  }

  /**
   * Render half of the XIN-96 reinit-preserve (XIN-98). When a scene-reinit onChange — a reconnect,
   * a cold reopen, or a remount — drops remote-rendered elements we chose to PRESERVE rather than
   * tombstone, the Y.Doc still holds them but the canvas was just repainted WITHOUT them: the data
   * is intact yet the elements are visually gone. Nothing else fixes this, because the drop arrived
   * on a LOCAL onChange (not a Y.Doc change), so no observe→applyRemote follows. Push the
   * authoritative doc back through the render contract so the preserved elements actually paint
   * again. Guard 3 (`applyingRemote`) short-circuits the onChange this updateScene triggers, so the
   * repaint cannot loop back into a write.
   */
  private repaintAfterReinitDrop(count: number): void {
    if (count === 0 || !this.api || this.destroyed) return
    this.telemetry.reinitRepaints++
    this.applyRemote()
  }

  /**
   * Upload a freshly inserted image binary to object storage and write the canonical saved file ref
   * into the Y.Doc (XIN-702). Idempotent: skips files with no binary, files that already carry an
   * attachId, and files already uploading / uploaded. The ref write is a separate LOCAL_ORIGIN
   * transaction — guard 1 ignores it here, and peers see it as a remote ref update and fetch the
   * binary. The binary itself is NEVER written to the Y.Doc (XIN-16 §2.2).
   */
  private startUpload(file: BinaryFileData): void {
    const uploader = this.fileSync?.uploader
    if (!uploader || this.destroyed) return
    const id = file.id
    if (!id) return
    const hasBinary = typeof file.dataURL === 'string' && file.dataURL.length > 0
    const hasAttach = typeof file.attachId === 'string' && file.attachId.length > 0
    if (!hasBinary || hasAttach) return
    if (this.uploadingFileIds.has(id) || this.uploadedFileIds.has(id)) return
    this.uploadingFileIds.add(id)
    Promise.resolve(uploader(file))
      .then((attachId) => {
        this.uploadingFileIds.delete(id)
        if (this.destroyed || typeof attachId !== 'string' || attachId.length === 0) return
        this.uploadedFileIds.add(id)
        // Write the canonical saved ref ({attachId, mimeType, status:'saved', createdAt}) via the
        // shared `buildFileRef`, so peers see the same shape the backend authoritative repair reads.
        const ref = buildFileRef({
          attachId,
          mimeType: typeof file.mimeType === 'string' ? file.mimeType : undefined,
          status: FILE_REF_STATUS.saved,
          createdAt: typeof file.created === 'number' ? file.created : undefined,
        })
        this.ydoc.transact(() => this.writeFileRef(id, ref), LOCAL_ORIGIN)
        this.telemetry.fileUploads++
      })
      .catch(() => {
        this.uploadingFileIds.delete(id)
        this.telemetry.fileUploadErrors++
      })
  }

  /**
   * Upsert a canonical file ref into the per-file `Y.Map` under `files[fileId]`, creating the map if
   * absent and writing only fields whose value actually changed (idempotent). Must be called inside a
   * LOCAL_ORIGIN transaction by the caller so the write is attributed as our own.
   */
  private writeFileRef(fileId: string, ref: FileRef): void {
    let yFile = this.files.get(fileId)
    if (!yFile) {
      yFile = new Y.Map<unknown>()
      this.files.set(fileId, yFile)
    }
    for (const [k, v] of Object.entries(ref)) {
      if (v === undefined) continue
      if (!yFile.has(k) || !jsonEqual(yFile.get(k), v as Json)) yFile.set(k, v)
    }
  }

  /**
   * Rehydrate remote-authored image binaries (XIN-702). Collect every file ref in the Y.Doc that is
   * a USABLE ref (a non-empty attachId, per the shared `normalizeFileRef`/`isUsableFileRef` rule), is
   * NOT one this client inserted, and has not already been fetched, then fetch them in ONE batch and
   * `addFiles()` the result into the canvas so the images render instead of grey placeholders. The
   * batch lets the host use the backend `POST /attachments/resolve` endpoint (one signed-URL round
   * trip for N images) rather than N single GETs. Each id is fetched at most once (dedup sets); an id
   * the batch fails to return stays a placeholder and the next apply retries it. Fire-and-forget —
   * never blocks the updateScene path.
   */
  private rehydrateFiles(): void {
    const fetcher = this.fileSync?.fetcher
    if (!fetcher || !this.api?.addFiles || this.destroyed) return
    const pending: FileFetchRef[] = []
    for (const [id, yFile] of this.files) {
      if (this.localFileIds.has(id) || this.fetchedFileIds.has(id) || this.fetchingFileIds.has(id)) {
        continue
      }
      // One authoritative usability rule, shared FE/BE: a ref with no usable attachId can never
      // resolve to a binary, so skip it (it is the grey-placeholder failure mode in data form).
      const ref = normalizeFileRef(readFileEntry(yFile))
      if (!ref) continue
      pending.push({ id, attachId: ref.attachId, mimeType: ref.mimeType })
    }
    if (pending.length === 0) return
    for (const ref of pending) this.fetchingFileIds.add(ref.id)
    Promise.resolve(fetcher(pending))
      .then((files) => {
        for (const ref of pending) this.fetchingFileIds.delete(ref.id)
        if (this.destroyed) return
        const usable = (files ?? []).filter((f): f is BinaryFileData => Boolean(f?.id))
        for (const f of usable) this.fetchedFileIds.add(f.id)
        if (usable.length > 0) {
          this.api?.addFiles?.(usable)
          this.telemetry.fileRehydrates += usable.length
        }
      })
      .catch(() => {
        for (const ref of pending) this.fetchingFileIds.delete(ref.id)
        this.telemetry.fileFetchErrors++
      })
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
    //
    // The whole rebuild — raw read, repair, restore, reconcile — is wrapped so a malformed peer
    // entry that survives readAllElements' guard (or a repair/restore throw) cannot abort the apply
    // and blank the canvas: on error we keep the last good scene instead (P1-2). readAllElements
    // already drops non-Y.Map containers; this is the batch-level backstop for anything downstream.
    let elements: ExcalidrawElement[]
    try {
      const repaired = repairForRender(readAllElements(this.elements), fileIds)

      // XIN-87 root-cause fix: when the host has wired the restore/reconcile contract, run it before
      // updateScene. `restore` rehydrates the raw Y.Doc elements into renderable Excalidraw shapes
      // (the missing step that made them paint as points/handles); `reconcile` merges them with the
      // live local scene by version so a concurrent local edit is not clobbered. Without an adapter
      // (the node unit-test path, where Excalidraw cannot be imported) we keep the raw elements.
      elements = repaired
      const adapter = this.renderAdapter
      if (adapter) {
        const restored = adapter.restore(repaired)
        const local = this.api?.getSceneElementsIncludingDeleted?.() ?? []
        elements = adapter.reconcile(local, restored)
      }
    } catch {
      // A single malformed remote entry must not blank the canvas for everyone: skip this apply and
      // keep the last good scene. The next well-formed remote update repaints.
      this.telemetry.remoteApplyErrors++
      return
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
    for (const el of elements) {
      snap.set(el.id, cloneElement(el))
      // Remember every id that reached the canvas from the authoritative doc: it is remote-origin
      // and must never be tombstoned by a later reinit-absence, even after the user edits it (P0 /
      // XIN-96). Cheap and monotonic — the set only guards against deletion, never causes one.
      this.remoteOrigin.add(el.id)
    }
    this.lastKnown = snap
    this.telemetry.remoteApplies++
    this.telemetry.remoteElements += elements.length
    // Rehydrate any remote-authored image binaries this scene references (XIN-702): fetch by
    // attachId and addFiles() so the image renders instead of a grey placeholder.
    this.rehydrateFiles()
  }

  /**
   * Apply the authoritative canvas background colour from the Y.Doc onto the canvas (PR #1161).
   * Runs from the appState observer on a remote/repair write and from `setApi` replay. Skips when it
   * already matches `lastKnownBg` (nothing to repaint) and, like `applyRemote`, sets `applyingRemote`
   * so the onChange this updateScene triggers is dropped (guard 3) instead of written straight back.
   *
   * Key CLEAR handling: an authoritative transaction that deletes / empties the key (a remote peer
   * resetting the canvas back to the default background) must repaint the Excalidraw default, not
   * leave the stale colour painting. This makes NO claim about version-history restore — the backend
   * serializer does not yet model this appState container (collab/schema.ts), so a version restore
   * cannot clear the key today; this handles the live remote-clear path only. But a doc that simply
   * NEVER carried a colour is not a clear — a fresh mount must be left on whatever `initialData`
   * seeded — so we only reset-to-default when we were previously tracking an explicit, non-default
   * colour. A clear that arrives while the api is DETACHED (`this.api` null — access not yet
   * confirmed, or torn down) is not lost: the deletion lands in the Y.Doc regardless, and `setApi`
   * replays `applyRemoteAppState` on reattach, which then observes the unset key against the tracked
   * non-default `lastKnownBg` and repaints the default.
   */
  private applyRemoteAppState(): void {
    if (!this.api || this.destroyed) return
    const raw = this.appState.get(VIEW_BACKGROUND_COLOR_KEY)
    const hasColor = typeof raw === 'string' && raw.length > 0
    const next = hasColor
      ? (raw as string)
      : this.lastKnownBg !== null && this.lastKnownBg !== DEFAULT_VIEW_BACKGROUND_COLOR
        ? DEFAULT_VIEW_BACKGROUND_COLOR
        : null
    if (next === null || next === this.lastKnownBg) return
    this.lastKnownBg = next
    this.applyingRemote = true
    try {
      this.api.updateScene({ appState: { viewBackgroundColor: next }, captureUpdate: 'NEVER' })
    } finally {
      this.applyingRemote = false
    }
  }

  /**
   * Current authoritative canvas background colour from the Y.Doc, or null when none is set. BoardShell
   * seeds Excalidraw's `initialData.appState.viewBackgroundColor` from this on a cold reopen so the
   * canvas mounts with the synced colour rather than the Excalidraw default — the appState twin of
   * `snapshotElements` (PR #1161).
   */
  snapshotViewBackgroundColor(): string | null {
    const color = this.appState.get(VIEW_BACKGROUND_COLOR_KEY)
    return typeof color === 'string' && color.length > 0 ? color : null
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
    this.applyRemoteAppState()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.elements.unobserveDeep(this.onElements)
    this.files.unobserveDeep(this.onFiles)
    this.appState.unobserve(this.onAppState)
    this.undoManager?.destroy()
  }
}
