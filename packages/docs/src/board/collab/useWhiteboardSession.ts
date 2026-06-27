// React binding for the collaborative whiteboard session (board counterpart of useCollabEditor).
//
// A board-level registry keyed by `${uid}::${documentName}` makes account / board switches isolate
// naturally and survives StrictMode's double-invoked effects (idempotent create + refcount), the
// same shape useCollabEditor uses for the doc editor. Unlike CollabEditor.create — which awaits the
// collab-token exchange to learn the initial role BEFORE building the provider — the board does not
// gate editability on a pre-connect role (BoardShell resolves the caller's role separately via
// getDoc, and Excalidraw is view-mode-toggled from that). So the session is built synchronously and
// the collab token is fetched lazily by the provider's token getter on connect.
//
// Token contract: the board reuses the doc editor's collab-token flow — POST /docs/collab-token
// with the whiteboard documentName `octo:{space}:{folder}:wb:{board}`. The backend's unified WS
// router already recognises the 5-segment `:wb:` key (see @octo/whiteboard-schema name codec), so
// the same endpoint issues a token for a board. No board-specific endpoint is introduced here.

import { useEffect, useState } from 'react'
import { createWhiteboardSession, type WhiteboardSession } from './connect.ts'
import { buildWhiteboardName } from './schema.ts'
import { WS_ENDPOINT } from '../../config.ts'
import { getCollabToken } from '../../auth/collabToken.ts'

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
  session: WhiteboardSession
}

const registry = new Map<string, RegistryEntry>()

function acquire(key: string, create: () => WhiteboardSession): RegistryEntry {
  let entry = registry.get(key)
  if (!entry) {
    entry = { refCount: 0, session: create() }
    registry.set(key, entry)
  }
  entry.refCount++
  return entry
}

function release(key: string): void {
  const entry = registry.get(key)
  if (!entry) return
  entry.refCount--
  if (entry.refCount <= 0) {
    registry.delete(key)
    // Only destroy if no one re-acquired under the same key meanwhile.
    if (!registry.has(key)) entry.session.destroy()
  }
}

/**
 * Acquire a live whiteboard collaboration session for the given board, refcounted by
 * `${uid}::${documentName}`. Returns the session once the effect has run (null on the first render
 * and after teardown). The caller passes the session to `<BoardShell collabSession={...}>`; this
 * hook owns its create/destroy lifecycle.
 */
export function useWhiteboardSession(opts: UseWhiteboardSessionOptions): WhiteboardSession | null {
  const { uid, space, folder, board, disableOfflineCache } = opts
  const documentName = buildWhiteboardName(space, folder, board)
  const key = `${uid}::${documentName}`

  const [session, setSession] = useState<WhiteboardSession | null>(null)

  useEffect(() => {
    let active = true
    const entry = acquire(key, () =>
      createWhiteboardSession({
        space,
        folder,
        board,
        url: WS_ENDPOINT,
        token: () => getCollabToken(documentName),
        disableOfflineCache,
      }),
    )
    if (active) setSession(entry.session)
    return () => {
      active = false
      setSession(null)
      release(key)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]) // ⚠️ keyed by uid + whiteboard documentName — switching either rebuilds.

  return session
}
