// React binding for the collaborative whiteboard session (board counterpart of useCollabEditor).
//
// A board-level registry keyed by `${uid}::${documentName}` makes account / board switches isolate
// naturally and survives StrictMode's double-invoked effects (idempotent create + refcount), the
// same shape useCollabEditor uses for the doc editor.
//
// Identity-first, mirroring CollabEditor.create: the collab token is PRIMED before the provider is
// built, so the authoritative WS origin (`collabWsUrl`) and the initial role/epoch are known up
// front (P1-3 / P1-4). This replaces the previous synchronous build that derived the WS origin from
// the page host and had no pre-connect role. If priming fails (offline / a backend that predates the
// contract) we fall back to the origin-derived `WS_ENDPOINT` and no pre-connect role — the board
// then fails closed (read-only) until an authoritative role arrives, and the provider's own token
// getter retries issuance on connect.
//
// Token contract: the board reuses the doc editor's collab-token flow — POST /docs/collab-token
// with the whiteboard documentName `octo:{space}:{folder}:wb:{board}`. The backend's unified WS
// router already recognises the 5-segment `:wb:` key (see @octo/whiteboard-schema name codec), so
// the same endpoint issues a token for a board. No board-specific endpoint is introduced here.

import { useEffect, useState } from 'react'
import { createWhiteboardSession, type WhiteboardSession, type BoardTerminal } from './connect.ts'
import { buildWhiteboardName } from './schema.ts'
import { resolveBoardWsUrl, WS_ENDPOINT } from '../../config.ts'
import { getCollabToken, getCollabTokenEntry, disposeToken } from '../../auth/collabToken.ts'
import type { Role } from '../../auth/roles.ts'

export interface UseWhiteboardSessionOptions {
  uid: string
  space: string
  folder: string
  board: string
  /** Disable the local IndexedDB cache for high-confidentiality boards (mirrors the editor). */
  disableOfflineCache?: boolean
}

interface RegistryEntry {
  refCount: number
  instance: WhiteboardSession | null
  promise: Promise<WhiteboardSession>
}

const registry = new Map<string, RegistryEntry>()

/**
 * Map a collab-token prime failure to a terminal state when — and only when — it is an
 * AUTHORIZATION/AUTHENTICATION denial (the backend answered 401/403/404), as opposed to a transport
 * or pre-contract failure (offline, network error, an old backend, an invalid-role payload). An
 * auth denial must NOT fall through to a cache-hydrating session (P1-3): a resolved reader satisfies
 * BoardShell's `accessConfirmed` gate and would paint the uid-scoped cached scene for a user the
 * backend just denied. Returns null for a non-auth failure so the caller keeps the offline fallback.
 */
function authTerminalFor(status: number | undefined): BoardTerminal | null {
  switch (status) {
    // 401 = not authenticated → send to login; keeps the board mounted read-only, no hydration.
    case 401:
      return { kind: 'login' }
    // 403 = access revoked / forbidden. The board has no distinct 'forbidden' kind; it uses
    // 'deleted' for an in-flight loss of access (the same mapping the 4403 close code uses).
    case 403:
      return { kind: 'deleted' }
    case 404:
      return { kind: 'not-found' }
    default:
      return null
  }
}

/**
 * Prime the collab token, then build the session with the authoritative WS origin + initial role.
 * Resilient: a TRANSPORT/COMPAT failure (offline, network, pre-contract, invalid payload) falls back
 * to the origin-derived endpoint and no pre-connect role (fail-closed to reader). An AUTHORIZATION
 * failure (401/403/404) is different: the backend explicitly denied this user, so we build a session
 * that is terminal from birth and hydrates NO cache, rather than a reader that would paint the
 * cached scene for a denied user (P1-3).
 */
async function buildSession(
  opts: UseWhiteboardSessionOptions,
  documentName: string,
): Promise<WhiteboardSession> {
  let url = WS_ENDPOINT
  let initialRole: Role | undefined
  let initialEpoch = 0
  try {
    const entry = await getCollabTokenEntry(documentName, opts.board)
    url = resolveBoardWsUrl(entry.collabWsUrl)
    initialRole = entry.role
    initialEpoch = entry.permission_epoch
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status
    const terminal = authTerminalFor(status)
    if (terminal) {
      // Authorization failure: fail terminal, no cache hydration (P1-1 teardown runs in connect).
      return createWhiteboardSession({
        uid: opts.uid,
        space: opts.space,
        folder: opts.folder,
        board: opts.board,
        url,
        token: () => getCollabToken(documentName, opts.board),
        initialTerminal: terminal,
        disableOfflineCache: true,
        disposeToken: () => disposeToken(documentName, { docId: opts.board }),
      })
    }
    // Prime failed for a NON-auth reason (offline / no backend / pre-contract): keep the origin-
    // derived fallback and start with no authoritative role. The board fails closed until a role
    // is known.
  }
  return createWhiteboardSession({
    uid: opts.uid,
    space: opts.space,
    folder: opts.folder,
    board: opts.board,
    url,
    token: () => getCollabToken(documentName, opts.board),
    initialRole,
    initialEpoch,
    disableOfflineCache: opts.disableOfflineCache,
    disposeToken: () => disposeToken(documentName, { docId: opts.board }),
  })
}

function acquire(key: string, create: () => Promise<WhiteboardSession>): RegistryEntry {
  let entry = registry.get(key)
  if (!entry) {
    const promise = create()
    entry = { refCount: 0, instance: null, promise }
    promise.then((session) => {
      const e = registry.get(key)
      if (e && e === entry) e.instance = session
      else {
        // Released or replaced before creation finished: clear this entry's local presence before
        // closing its provider. Never install the stale session into a newly re-acquired entry that
        // happens to reuse the same key.
        clearSessionLocalAwareness(session)
        session.destroy()
      }
    })
    registry.set(key, entry)
  }
  entry.refCount++
  return entry
}

function clearSessionLocalAwareness(session: WhiteboardSession): void {
  session.provider?.awareness?.setLocalState(null)
}

function release(key: string): void {
  const entry = registry.get(key)
  if (!entry) return
  entry.refCount--
  if (entry.refCount <= 0) {
    registry.delete(key)
    // Clear presence as soon as the final owner releases the shared session. Waiting for the async
    // destroy path leaves the old client id visible while a quick reopen publishes a new one,
    // producing two cursors for the same user. This lives at the registry ownership boundary (not
    // in BoardShell's presence effect cleanup), so ordinary dependency reruns never blink presence.
    if (entry.instance) clearSessionLocalAwareness(entry.instance)
    entry.promise.then((session) => {
      // A session that resolved while this entry was still current was installed into
      // `entry.instance`; release owns its teardown. If the entry was replaced before resolution,
      // acquire's resolve guard already cleared/destroyed that stale session — do not destroy twice.
      if (entry.instance === session) session.destroy()
    })
  }
}

/**
 * Acquire a live whiteboard collaboration session for the given board, refcounted by
 * `${uid}::${documentName}`. Returns the session once created (null on the first render, while the
 * collab token is being primed, and after teardown). The caller passes the session to
 * `<BoardShell collabSession={...}>`; this hook owns its create/destroy lifecycle.
 */
export function useWhiteboardSession(opts: UseWhiteboardSessionOptions): WhiteboardSession | null {
  const { uid, space, folder, board, disableOfflineCache } = opts
  const documentName = buildWhiteboardName(space, folder, board)
  const key = `${uid}::${documentName}`

  // Keep the session tagged with the key it belongs to. Effects clean up only after render, so a
  // plain `WhiteboardSession | null` state leaks the previous account's session for one render when
  // uid/documentName changes. Returning only a key-matching session closes that synchronous frame:
  // BoardSession can never combine user B with account A's provider/binding/cached scene.
  const [sessionState, setSessionState] = useState<{
    key: string
    session: WhiteboardSession
  } | null>(null)

  useEffect(() => {
    let active = true
    const entry = acquire(key, () =>
      buildSession({ uid, space, folder, board, disableOfflineCache }, documentName),
    )
    if (entry.instance) {
      setSessionState({ key, session: entry.instance })
    } else {
      entry.promise.then((session) => {
        if (active) setSessionState({ key, session })
      })
    }
    return () => {
      active = false
      setSessionState((current) => current?.key === key ? null : current)
      release(key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]) // ⚠️ keyed by uid + whiteboard documentName — switching either rebuilds.

  return sessionState?.key === key ? sessionState.session : null
}
