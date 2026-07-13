// Whiteboard (Excalidraw) persistence + kind tracking — M1 standalone scope.
//
// M1 is the single-machine embed: no realtime collaboration (that binds to the collab
// backend in M2 / XIN-24). Until then a board scene persists LOCALLY (localStorage, keyed by
// docId) so it survives closing+reopening the board and a full page refresh — the M1
// acceptance bar ("draw a few shapes → close/reopen → refresh, nothing lost"). The backend
// save call slots into `persistBoardScene` in M2; today that function writes the local mirror
// only.
//
// Two concerns live here, both intentionally dependency-free (no Excalidraw import) so the
// module is cheap to load and unit-testable in jsdom:
//   1. Scene persistence: load/save the drawn elements (+ files + a minimal appState subset).
//   2. Board-kind registry: remember which docIds are boards, so a deep-link / refresh that
//      only carries `?doc=<id>` (the three-party-fixed single-param addressing) can still tell
//      a board from a rich-text doc even when the backend doesn't echo `docType` on the list.

/** Excalidraw scene we persist. `unknown[]` keeps this module free of the Excalidraw types. */
export interface BoardScene {
  elements: unknown[]
  /** Whitelisted, JSON-safe appState subset (see APP_STATE_KEYS) — never the full live state. */
  appState?: Record<string, unknown>
  /** Binary file store (images etc.), keyed by file id, as Excalidraw hands it to onChange. */
  files?: Record<string, unknown>
}

const SCENE_PREFIX = 'octo.board.scene.'
const REGISTRY_PREFIX = 'octo.board.ids.'

/**
 * Sentinel namespace for the local scene mirror when no authenticated uid is supplied (the M1
 * standalone / anonymous path). Real sessions pass the authenticated uid so a shared browser never
 * exposes one user's board to the next.
 */
const ANON_SCOPE = 'anon'

/**
 * Build the uid-scoped localStorage key for a board's scene mirror
 * (`octo.board.scene.{uid}.{docId}`). The mirror is scoped by the authenticated uid — mirroring the
 * doc editor's user-scoped IndexedDB cacheKey (`offline/cache.ts` `octo-doc:{uid}:…`) — so a
 * previous user's cached scene is never rendered to the next user on a shared browser (P1-1). A
 * missing uid falls back to a stable anonymous sentinel so the standalone local-only path still
 * persists.
 */
function sceneKey(docId: string, uid?: string): string {
  const scope = uid && uid.length > 0 ? uid : ANON_SCOPE
  return `${SCENE_PREFIX}${scope}.${docId}`
}

/**
 * Build the uid-scoped localStorage key for the board-kind registry (`octo.board.ids.{uid}`).
 * Scoped by the authenticated uid — like the scene mirror above — so a shared browser never leaks
 * which docIds are boards from one user to the next (P2). A missing uid falls back to the same
 * anonymous sentinel so the standalone local-only path still records boards.
 */
function registryKey(uid?: string): string {
  const scope = uid && uid.length > 0 ? uid : ANON_SCOPE
  return `${REGISTRY_PREFIX}${scope}`
}

/**
 * appState fields worth persisting. The live Excalidraw appState carries transient/non-JSON
 * data (a `collaborators` Map, selection, pointers, the open dialog…) that must NOT be fed back
 * via initialData. We keep only stable, JSON-safe view preferences so a reopened board looks the
 * same without dragging along volatile state.
 */
const APP_STATE_KEYS = [
  'viewBackgroundColor',
  'gridSize',
  'gridModeEnabled',
  'zoom',
  'scrollX',
  'scrollY',
] as const

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null // disabled / private mode — callers degrade gracefully
  }
}

function pickAppState(appState: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!appState) return undefined
  const out: Record<string, unknown> = {}
  for (const key of APP_STATE_KEYS) {
    if (appState[key] !== undefined) out[key] = appState[key]
  }
  return Object.keys(out).length ? out : undefined
}

/** Read the persisted scene for a board, or null when absent/unreadable/malformed. */
export function loadBoardScene(docId: string, uid?: string): BoardScene | null {
  const store = storage()
  if (!store || !docId) return null
  try {
    const raw = store.getItem(sceneKey(docId, uid))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<BoardScene> | null
    if (!parsed || !Array.isArray(parsed.elements)) return null
    return {
      elements: parsed.elements,
      appState: parsed.appState && typeof parsed.appState === 'object' ? parsed.appState : undefined,
      files: parsed.files && typeof parsed.files === 'object' ? parsed.files : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Persist a board scene. This is the M1↔M2 seam: today it writes the local mirror (the working
 * persistence path for the standalone embed). When the collab backend is wired in M2 the remote
 * save goes here too — local stays as the offline-first fallback. Returns true on a successful
 * local write so a caller can reflect a save indicator if it wants.
 */
export function persistBoardScene(docId: string, scene: BoardScene, uid?: string): boolean {
  const store = storage()
  if (!store || !docId) return false
  try {
    const payload: BoardScene = {
      elements: scene.elements ?? [],
      appState: pickAppState(scene.appState),
      files: scene.files,
    }
    store.setItem(sceneKey(docId, uid), JSON.stringify(payload))
    return true
  } catch {
    // Quota exceeded / storage disabled: the board still works in-memory this session; we just
    // can't guarantee it survives a refresh. Swallow so a save attempt never crashes the editor.
    return false
  }
}

/** Drop a board's persisted scene (e.g. after the doc is deleted). Best-effort. */
export function clearBoardScene(docId: string, uid?: string): void {
  const store = storage()
  if (!store || !docId) return
  try {
    store.removeItem(sceneKey(docId, uid))
  } catch {
    // ignore
  }
}

function readRegistry(store: Storage, uid?: string): Set<string> {
  try {
    const raw = store.getItem(registryKey(uid))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === 'string')) : new Set()
  } catch {
    return new Set()
  }
}

/**
 * Remember that `docId` is a board. Called right after a board is created so that a later
 * deep-link / refresh on `?doc=<id>` opens the whiteboard editor even if the backend's list
 * response doesn't carry `docType`. `docType` from the API still takes precedence (see
 * isBoardDoc); this registry is the resilient client-side fallback for the M1 standalone path.
 * uid-scoped (P2) — pass the authenticated uid so the record is not visible to other users.
 */
export function rememberBoard(docId: string, uid?: string): void {
  const store = storage()
  if (!store || !docId) return
  try {
    const ids = readRegistry(store, uid)
    if (ids.has(docId)) return
    ids.add(docId)
    store.setItem(registryKey(uid), JSON.stringify([...ids]))
  } catch {
    // ignore — falls back to docType-from-API only
  }
}

/** Forget a board id (e.g. on delete) so the registry doesn't grow unbounded. Best-effort. */
export function forgetBoard(docId: string, uid?: string): void {
  const store = storage()
  if (!store || !docId) return
  try {
    const ids = readRegistry(store, uid)
    if (!ids.delete(docId)) return
    store.setItem(registryKey(uid), JSON.stringify([...ids]))
  } catch {
    // ignore
  }
}

/** Whether `docId` is recorded locally as a board (for this uid's registry). */
export function isBoardIdLocally(docId: string, uid?: string): boolean {
  const store = storage()
  if (!store || !docId) return false
  return readRegistry(store, uid).has(docId)
}

/**
 * Resolve whether a doc is a board, authoritative-first: trust an explicit `docType` from the
 * backend (`'board'`/`'doc'`) when present, otherwise fall back to the (uid-scoped) local registry.
 * This is the single helper every call site uses so the precedence rule lives in one place.
 */
export function isBoardDoc(input: { docId: string; docType?: string }, uid?: string): boolean {
  if (input.docType === 'board') return true
  if (input.docType === 'doc') return false
  return isBoardIdLocally(input.docId, uid)
}
