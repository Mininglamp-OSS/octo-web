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
import { deleteDatabaseAwait } from '../../offline/cache.ts'

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
  /**
   * Pre-set terminal state for a session the caller already knows is DENIED (a 403/404 at collab-
   * token prime — access revoked / board deleted). Such a session builds NO local cache, tears down
   * any on-disk cache left from a prior authorized session, and does NOT open the socket — it exists
   * only to surface the terminal state so the host returns to the list WITHOUT hydrating a cached
   * scene for a user the backend just denied (P1-3, combined with the P1-1 teardown).
   */
  initialTerminal?: BoardTerminal
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

  // A session the caller already knows is denied (403/404) is terminal from birth: it must NOT
  // build a cache to hydrate, and it tears down any on-disk cache from a prior authorized session.
  const authDenied = !!opts.initialTerminal && opts.initialTerminal.kind !== 'none'

  // The board's canonical uid-scoped cache name is known regardless of whether a live persistence
  // handle is built — the revoke teardown must be able to DELETE a store even when this session
  // itself never opened one (high-confidentiality board, or an auth-denied session).
  const dbName = boardCacheName(opts.uid, documentName)
  const cacheEnabled = !opts.disableOfflineCache && !authDenied
  const persistence = cacheEnabled ? new IndexeddbPersistence(dbName, ydoc) : null

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
  // Latest terminal transition. Tracked (not just fanned out) so a subscriber that attaches AFTER
  // the transition — BoardShell always subscribes post-construction — still learns a session that
  // was born terminal (auth-denied) or went terminal before it subscribed (P1-3).
  let terminalState: BoardTerminal = opts.initialTerminal ?? { kind: 'none' }
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let destroyed = false

  const notifyRole = (role: Role): void => {
    for (const cb of roleListeners) cb(role)
  }
  const notifyTerminal = (t: BoardTerminal): void => {
    terminalState = t
    for (const cb of terminalListeners) cb(t)
  }

  /**
   * Ordered local cache teardown on a revoke (P1-1), mirroring the doc editor (offline/cache.ts
   * §6.3): CLOSE the y-indexeddb handle first, then DELETE the on-disk DB. In y-indexeddb@9 `destroy`
   * only closes the connection — the store survives until `deleteDatabase`, so a revoked user's
   * cached board scene would otherwise linger and replay on a later direct open. Closing before the
   * delete also prevents `deleteDatabase` from blocking on the open handle.
   */
  const clearLocalCache = async (): Promise<void> => {
    try {
      await persistence?.destroy()
    } finally {
      await deleteDatabaseAwait(dbName)
    }
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
    // Best-effort local cache teardown so a revoked board's cached scene does not linger. Ordered
    // (close handle → deleteDatabase) so the on-disk IndexedDB store is actually removed, not just
    // the handle closed (P1-1).
    clearDocCache: () => {
      void clearLocalCache()
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

  if (authDenied) {
    // Access is already denied by the backend: do NOT open the socket (it would only 4403). Tear
    // down any on-disk cache left from a previous authorized session so the denied user's scene
    // cannot replay, and leave `terminalState` at the pre-set terminal for subscribers to read.
    void clearLocalCache()
  } else {
    provider.connect()
  }

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
      // Replay a terminal that already happened (or a session born terminal) so a late subscriber
      // — BoardShell subscribes after construction — is not stuck thinking access is live (P1-3).
      if (terminalState.kind !== 'none') cb(terminalState)
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
      // Parity with the doc editor's destroyAll (createCollabEditor.ts:241): dispose the cached
      // collab token on a NORMAL session end too, so the editor's token cache stays consistent and
      // the JWT is dropped promptly instead of lingering until it expires. Hygiene only, not a
      // security fix — a true revoke already disposes via the 4403 close-code path and the
      // role-downgrade frame, and the backend flips the connection read-only to reject stale writes.
      opts.disposeToken?.(documentName)
    },
  }
}
