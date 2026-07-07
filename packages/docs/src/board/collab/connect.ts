// Whiteboard collaborative session assembler (binding skeleton, frontend-design §5 / XIN-16 §5).
//
// Owns one Y.Doc + one HocuspocusProvider + one ExcalidrawYjsBinding + optional offline cache per
// board — the board counterpart of CollabEditor. It does NOT mount Excalidraw; BoardShell mounts
// the canvas, then hands the imperative API to `binding.setApi(api)` and forwards `onChange` to
// `binding.handleLocalChange(elements, files)`.
//
// Runtime permission enforcement mirrors the doc editor (createCollabEditor): the same stateless
// role-change channel (`statelessRole.ts`) and WS close-code machine (`closeCode.ts`) are wired
// onto the provider so a member downgraded to reader while a board is open loses the editable
// canvas, and a 4403 (access revoked / doc deleted) tears the session down instead of leaving a
// stale editable canvas + cached token behind (P1-3).
//
// Network specifics that depend on the board collab-token contract are injected by the caller
// (`url`, `token`, `initialRole`, `initialEpoch`) rather than hard-wired here. The caller primes the
// collab token before construction so the authoritative WS origin (`collabWsUrl`) and the initial
// role/epoch are known up front (see useWhiteboardSession.ts). The doc name is built through the
// validated codec.

import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { IndexeddbPersistence } from 'y-indexeddb'

import { buildWhiteboardName } from './schema.ts'
import { ExcalidrawYjsBinding } from './binding.ts'
import { RoleController } from '../../collab/statelessRole.ts'
import { CloseCodeMachine, type CloseEvent } from '../../collab/closeCode.ts'
import { canEdit, type Role } from '../../auth/roles.ts'

/**
 * Terminal board states surfaced to the host so it can leave the editable canvas and return the
 * user to the list. Mirrors the doc editor's TerminalState (createCollabEditor.ts): `deleted` is an
 * in-flight loss of access (4403), distinct from a create-time forbidden.
 */
export type BoardTerminal =
  | { kind: 'none' }
  | { kind: 'deleted' }
  | { kind: 'not-found' }
  | { kind: 'locked' }
  | { kind: 'login' }

export interface WhiteboardSessionOptions {
  space: string
  folder: string
  board: string
  /** Authenticated uid — scopes the local IndexedDB cache so a shared browser never leaks a board. */
  uid: string
  /** Hocuspocus WebSocket endpoint (resolved from the collab-token `collabWsUrl`; see config.ts). */
  url: string
  /** Collab-token provider (board collab-token contract supplies this). Matches Hocuspocus. */
  token: string | (() => string) | (() => Promise<string>)
  /**
   * Initial role from the primed collab-token response (single source of truth, as in the doc
   * editor). Omitted when the token could not be primed — the session then fails closed to `reader`
   * until an authoritative role arrives (P1-2 / P1-3).
   */
  initialRole?: Role
  /** Initial permission epoch from the collab-token response (monotonic guard for stateless frames). */
  initialEpoch?: number
  /** Disable the local IndexedDB cache for high-confidentiality boards. */
  disableOfflineCache?: boolean
  /** Injectable token disposer (defaults to the real collab-token disposer via RoleController). */
  disposeToken?: (documentName: string) => void
}

export interface WhiteboardSession {
  readonly documentName: string
  readonly ydoc: Y.Doc
  readonly provider: HocuspocusProvider
  readonly persistence: IndexeddbPersistence | null
  readonly binding: ExcalidrawYjsBinding
  /** Current effective role (runtime, after any stateless downgrade). */
  getRole(): Role
  /** Whether local editing is currently allowed by the effective role (writer/admin). */
  canEdit(): boolean
  /** Subscribe to runtime role changes (downgrade/upgrade); returns an unsubscribe. */
  subscribeRole(cb: (role: Role) => void): () => void
  /** Subscribe to terminal transitions (4403 revoke / delete / lock); returns an unsubscribe. */
  subscribeTerminal(cb: (terminal: BoardTerminal) => void): () => void
  destroy(): void
}

/**
 * Build the uid-scoped IndexedDB cache name for a board (`octo-wb:{uid}:{documentName}`). Scoping by
 * the authenticated uid mirrors the doc editor's `cacheKey` (offline/cache.ts) so a previous user's
 * cached board is never hydrated for the next user on a shared browser (P1-1).
 */
function boardCacheName(uid: string, documentName: string): string {
  return `octo-wb:${uid}:${documentName}`
}

/**
 * Assemble a live whiteboard collaboration session. The returned `binding` is wired to the doc but
 * has no canvas yet — call `binding.setApi(excalidrawAPI)` once Excalidraw has mounted.
 */
export function createWhiteboardSession(opts: WhiteboardSessionOptions): WhiteboardSession {
  const documentName = buildWhiteboardName(opts.space, opts.folder, opts.board)
  const ydoc = new Y.Doc()

  const persistence = opts.disableOfflineCache
    ? null
    : new IndexeddbPersistence(boardCacheName(opts.uid, documentName), ydoc)

  const tokenOpt = opts.token
  // connect:false so the stateless / close listeners are registered before the socket opens and no
  // runtime frame is missed (mirrors createCollabEditor).
  const provider = new HocuspocusProvider({
    url: opts.url,
    name: documentName,
    document: ydoc,
    token: typeof tokenOpt === 'function' ? tokenOpt : () => tokenOpt,
    connect: false,
  })

  const binding = new ExcalidrawYjsBinding(ydoc)

  // ── runtime permission enforcement (P1-3) ────────────────────────────────────────────────────
  const roleListeners = new Set<(role: Role) => void>()
  const terminalListeners = new Set<(t: BoardTerminal) => void>()
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let destroyed = false

  const notifyRole = (role: Role): void => {
    for (const cb of roleListeners) cb(role)
  }
  const notifyTerminal = (t: BoardTerminal): void => {
    for (const cb of terminalListeners) cb(t)
  }

  // Fail closed: an unknown initial role (token not primed) starts as reader, so the board is
  // read-only until an authoritative role is known (P1-2). A primed token supplies the real role.
  const roleController = new RoleController({
    documentName,
    initialRole: opts.initialRole ?? 'reader',
    initialEpoch: opts.initialEpoch ?? 0,
    onRole: (role) => notifyRole(role),
    disposeToken: opts.disposeToken,
  })

  const closeMachine = new CloseCodeMachine({
    disposeToken: () => (opts.disposeToken ?? (() => {}))(documentName),
    connect: () => provider.connect(),
    disconnect: () => provider.disconnect(),
    goLogin: () => notifyTerminal({ kind: 'login' }),
    // 4403 while connected = the board was deleted / access revoked under us. Surface it as the
    // terminal 'deleted' state so the host returns to the list (not a static forbidden screen).
    showForbidden: () => notifyTerminal({ kind: 'deleted' }),
    exitDocument: () => notifyTerminal({ kind: 'not-found' }),
    showLockedOrArchived: () => notifyTerminal({ kind: 'locked' }),
    // Best-effort local cache teardown so a revoked board's cached scene does not linger.
    clearDocCache: () => {
      void persistence?.destroy()
    },
    // Stop accepting further local edits while access is being torn down (downgrade to read-only).
    rollbackPending: () => notifyRole('reader'),
    onTransientClose: () => {
      // Network blip: the provider's built-in backoff reconnect handles it; nothing extra to do.
    },
    deferReconnect: ({ delayMs }) => {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(() => {
        if (!destroyed && !closeMachine.isTerminated()) provider.connect()
      }, delayMs)
    },
    reportServerError: () => {
      // Hook for telemetry; side-effect free in this build.
    },
    backoffDelay: () => 5_000,
  })

  // Listeners registered BEFORE connect (mirrors createCollabEditor).
  provider.on('synced', () => closeMachine.onAuthStable())
  provider.on('authenticated', () => closeMachine.onAuthStable())
  provider.on('stateless', (e: { payload: string }) => {
    roleController.handleStatelessFrame(e.payload)
  })
  provider.on('close', (e: { event: CloseEvent }) => {
    closeMachine.handleClose(e.event)
  })

  provider.connect()

  return {
    documentName,
    ydoc,
    provider,
    persistence,
    binding,
    getRole: () => roleController.getRole(),
    canEdit: () => canEdit(roleController.getRole()),
    subscribeRole(cb: (role: Role) => void): () => void {
      roleListeners.add(cb)
      return () => roleListeners.delete(cb)
    },
    subscribeTerminal(cb: (t: BoardTerminal) => void): () => void {
      terminalListeners.add(cb)
      return () => terminalListeners.delete(cb)
    },
    destroy(): void {
      destroyed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      roleListeners.clear()
      terminalListeners.clear()
      binding.destroy()
      provider.destroy()
      persistence?.destroy()
      ydoc.destroy()
    },
  }
}
