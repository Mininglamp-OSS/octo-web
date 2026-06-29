// Board collab host (frontend-design §5.1) — the board counterpart of how EditorShell owns
// useCollabEditor. It opens a live whiteboard session with useWhiteboardSession and renders
// BoardShell with it, so BoardShell stays a pure presentational shell that receives an
// already-built session (the shape the binding tests and the M1 standalone path rely on).
//
// Without this wrapper the board mounted BoardShell with no `collabSession`, so no
// HocuspocusProvider was ever constructed and no WebSocket to the collab backend was opened — the
// board silently ran the M1 local-only path. This is the missing connect step (XIN-55).

import type { ReactElement } from 'react'
import { BoardShell } from './BoardShell.tsx'
import { useWhiteboardSession } from './collab/useWhiteboardSession.ts'

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
}

export function BoardSession(props: BoardSessionProps): ReactElement {
  const { docId, title, uid, space, folder, userName, onBack, onExit, onTitleSaved, onDeleted } = props
  // The board id is the whiteboard key's {board} segment: octo:{space}:{folder}:wb:{board}.
  const session = useWhiteboardSession({ uid, space, folder, board: docId })
  return (
    <BoardShell
      docId={docId}
      title={title}
      space={space}
      onBack={onBack}
      onExit={onExit}
      onTitleSaved={onTitleSaved}
      onDeleted={onDeleted}
      collabSession={session}
      user={{ id: uid, name: userName || uid }}
    />
  )
}
