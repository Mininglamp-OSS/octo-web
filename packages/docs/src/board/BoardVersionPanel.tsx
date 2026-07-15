// Board version-history panel — now a THIN ADAPTER over the unified <VersionHistoryPanel> shell
// (following the doc adapter XIN-840 and the sheet adapter XIN-842). The shell owns everything shared
// across the doc / sheet / board ends: the single mixed list with filter tabs (all / manual / auto) +
// counts + load-more, save / rename / delete / restore, the in-panel restore confirm box, the unified
// race guard, and the centered preview modal (Esc / overlay-close / focus). This adapter injects only
// the board-specific pieces:
//   - loadPreviewState → getBoardVersionState (GET /versions/:seq/state), decoding the version's
//     Excalidraw SCENE off the `board` payload instead of a ProseMirror doc / sheet cells,
//   - renderPreview    → a read-only Excalidraw canvas (BoardScenePreview) wrapped in the shared
//     BoardErrorBoundary and REMOUNTED per version via key={seq} — Excalidraw seeds from initialData
//     exactly once at mount (it does not reactively consume the prop; see the XIN-115 note in
//     BoardShell), so without a keyed remount switching versions would keep showing the previously
//     previewed scene while the header advanced. The seq is threaded through TState so the key is
//     available inside renderPreview without changing the shared shell contract,
//   - previewErrorKey / restoreErrorKey → the board's richer classifier (versionErrorKey), so the
//     wider board failure set (403 access-revoked/epoch, 409 conflict, 413 too-large, 404 gone, plus
//     the two 409 schema codes) surfaces a distinct localized message per case.
//
// The board deliberately passes NEITHER renderDiff NOR getCurrent (decision #4: the whiteboard offers
// only a centered read-only preview, no compare) — with those omitted the shell hides the compare
// entry entirely. Restore stays forward / non-destructive: the backend auto-snapshots current state
// then reconciles the board in place, and the live canvas updates via normal Yjs sync — this panel
// never mutates the live canvas. Role gating is the shell's (canSnapshot = writer+, canRestoreVersion
// = admin), which matches the board's prior canEdit / canManage gating.

import type { Role } from '../auth/roles.ts'
import { VersionHistoryPanel } from '../versions/VersionHistoryPanel.tsx'
import { getBoardVersionState, versionErrorKey, type BoardVersionScene } from './boardVersions.ts'
import { BoardScenePreview } from './BoardScenePreview.tsx'
import { BoardErrorBoundary } from './BoardErrorBoundary.tsx'

/** The pluggable state the board loads per version: the decoded scene plus its seq (for the key). */
type BoardPreview = { seq: number; scene: BoardVersionScene }

export function BoardVersionPanel({
  docId,
  role,
  dark,
  names,
  onClose,
  onRestored,
}: {
  docId: string
  role: Role
  dark?: boolean
  names?: Map<string, string>
  onClose?: () => void
  /** Called after a successful restore (the live board reconciles via Yjs; hosts may refresh chrome). */
  onRestored?: () => void
}) {
  return (
    <VersionHistoryPanel<BoardPreview, never>
      docId={docId}
      role={role}
      names={names}
      onClose={onClose}
      onRestored={onRestored}
      loadPreviewState={(seq, signal) =>
        getBoardVersionState(docId, seq, signal).then((s) => ({ seq, scene: s.scene }))
      }
      renderPreview={({ seq, scene }) => (
        // key={seq} remounts the preview per version: Excalidraw only eats initialData at mount, so a
        // stable position would otherwise keep the prior scene. The preview is a SECOND real Excalidraw
        // — wrap it in the same BoardErrorBoundary the live canvas uses so a render-time throw
        // (malformed historical initialData, a bad restore, a mount failure) degrades to a recoverable
        // message instead of unmounting the whole host.
        <BoardErrorBoundary key={seq}>
          <BoardScenePreview scene={scene} dark={dark} docId={docId} />
        </BoardErrorBoundary>
      )}
      previewErrorKey={(e) => versionErrorKey(e, 'docs.board.version.errPreview')}
      restoreErrorKey={(e) => versionErrorKey(e, 'docs.board.version.errRestore')}
    />
  )
}
