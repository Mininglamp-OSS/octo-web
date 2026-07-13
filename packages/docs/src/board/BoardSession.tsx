// Board collab host (frontend-design §5.1) — the board counterpart of how EditorShell owns
// useCollabEditor. It opens a live whiteboard session with useWhiteboardSession and renders
// BoardShell with it, so BoardShell stays a pure presentational shell that receives an
// already-built session (the shape the binding tests and the M1 standalone path rely on).
//
// Without this wrapper the board mounted BoardShell with no `collabSession`, so no
// HocuspocusProvider was ever constructed and no WebSocket to the collab backend was opened — the
// board silently ran the M1 local-only path. This is the missing connect step (XIN-55).

import { useMemo, type ReactElement } from 'react'
import { BoardShell } from './BoardShell.tsx'
import { useWhiteboardSession } from './collab/useWhiteboardSession.ts'
import type { BoardPresenceUser } from './collab/presence.ts'

export interface BoardSessionProps {
  docId: string
  title: string
  uid: string
  space: string
  folder: string
  /** Display name for presence (awareness user.name). Falls back to uid when unresolved. */
  userName?: string
  onBack?: () => void
  onExit?: () => void
  onTitleSaved?: (docId: string, title: string) => void
  onDeleted?: (docId: string) => void
  /**
   * Forwarded to BoardShell: when true the creator display name resolves nickname-only, never the
   * verified `real_name`. The standalone `/d/:docId` share surface sets this (privacy — mirrors the
   * doc editor's EditorShell gate, XIN-392 P2-1).
   */
  creatorNicknameOnly?: boolean
  /**
   * Forwarded to BoardShell: opens the current board as a standalone `/d/:docId` page. Wired on the
   * in-app path so the ≡ menu shows "Open in new page" (XIN-621 ②); omitted on the standalone page.
   */
  onOpenInNewPage?: () => void
}

export function BoardSession(props: BoardSessionProps): ReactElement {
  const { docId, title, uid, space, folder, userName, onBack, onExit, onTitleSaved, onDeleted, creatorNicknameOnly, onOpenInNewPage } = props
  // The board id is the whiteboard key's {board} segment: octo:{space}:{folder}:wb:{board}.
  const session = useWhiteboardSession({ uid, space, folder, board: docId })
  // Stabilise the presence user object (P2 #7). An inline `{ id, name }` is a fresh reference every
  // render, so the presence effect keyed on `user` in BoardShell would re-run (re-publish awareness)
  // on every unrelated re-render. Memoise on the primitive uid/name so it only changes when they do.
  const user = useMemo<BoardPresenceUser>(
    () => ({ id: uid, name: userName || uid }),
    [uid, userName],
  )
  return (
    <BoardShell
      docId={docId}
      title={title}
      space={space}
      folder={folder}
      onBack={onBack}
      onExit={onExit}
      onTitleSaved={onTitleSaved}
      onDeleted={onDeleted}
      collabSession={session}
      collab
      user={user}
      creatorNicknameOnly={creatorNicknameOnly}
      onOpenInNewPage={onOpenInNewPage}
    />
  )
}
