import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import type { Role } from '../auth/roles.ts'
import { buildPreviewExtensions } from '../editor/extensions.ts'
import {
  getVersionState,
  VersionSchemaIncompatibleError,
  VersionSchemaNewerError,
} from './api.ts'
import { docToBlockLocations, diffDocs, type PMNode } from './diff.ts'
import { DiffView } from './DiffView.tsx'
import type { BotDiffHint } from './botEditForThread.ts'
import { VersionHistoryPanel } from './VersionHistoryPanel.tsx'
import { BotEditDiffView } from './BotEditDiffView.tsx'

// Doc page size (kept from the pre-shell panel); the shell unifies the three ends at its own
// default but honors this per-end override.
const PAGE_SIZE = 25

/** Read-only render of a historical version, built on a THROWAWAY editor (never the live one). */
function VersionPreview({ docId, content }: { docId: string; content: PMNode }) {
  const editor = useEditor(
    {
      editable: false,
      extensions: buildPreviewExtensions(docId),
      content: content as unknown as Record<string, unknown>,
    },
    [docId, content],
  )
  return <EditorContent editor={editor} className="octo-prose octo-version-preview" />
}

/** Block-level diff render: moved to ./DiffView.tsx so the bot-edit diff view reuses it verbatim. */

/**
 * Doc version-history drawer — now a THIN ADAPTER over the unified <VersionHistoryPanel> (XIN-840).
 *
 * The shell owns everything shared across the doc / sheet / board ends: the single mixed list with
 * filter tabs (all / manual / auto) + counts + load-more, save / rename / delete / restore, the
 * in-panel restore confirm box, the unified race guard, and the centered preview / diff modal. This
 * adapter injects only the doc-specific pieces:
 *   - loadPreviewState → GET /versions/:seq/state, returning the decoded ProseMirror-JSON doc,
 *   - renderPreview    → a read-only throwaway editor (VersionPreview) — never the live one,
 *   - renderDiff       → the block-level DiffView over diffDocs(version, current),
 *   - getCurrent       → the live editor's JSON (read-only) as the "current" side of a diff.
 *   - renderBotDiff    → <BotEditDiffView> for rows that are a bot content edit's pre-edit snapshot,
 *                        which is also where "undo this bot edit" lives (admin-only restore).
 *
 * Restore stays forward / non-destructive (the live surface reconciles via Yjs); schema-mismatch
 * restore errors keep their dedicated message via restoreErrorKey. The live `editor` is read but
 * NEVER mutated.
 */
export function VersionPanel({
  docId,
  role,
  editor,
  names,
  onClose,
  botDiffHint,
}: {
  docId: string
  role: Role
  /** Live editor — read-only here; used as the "current" side of a diff. */
  editor?: Editor
  /** uid → display-name map (feature #7) so the author shows a name, not a raw uid. */
  names?: Map<string, string>
  onClose?: () => void
  /** 见 VersionHistoryPanel 的同名 prop:从评论卡片跳过来时用它直接打开对应 Diff。 */
  botDiffHint?: BotDiffHint | null
}) {
  return (
    <VersionHistoryPanel<PMNode, PMNode>
      botDiffHint={botDiffHint}
      docId={docId}
      role={role}
      names={names}
      onClose={onClose}
      pageSize={PAGE_SIZE}
      loadPreviewState={(seq, signal) => getVersionState(docId, seq, signal).then((r) => r.doc)}
      renderPreview={(doc) => <VersionPreview docId={docId} content={doc} />}
      renderDiff={(version, current) => (
        // locations 取**改前**文档:hunk 头说的是「改动落在原文哪一段」,读者拿着旧文档在找。
        <DiffView diff={diffDocs(version, current)} locations={docToBlockLocations(version)} />
      )}
      getCurrent={() => (editor?.getJSON() as PMNode | undefined) ?? null}
      // Bot-edit rows get a "what did the bot change?" entry point. The seq handed over is the row's
      // own — the PRE-edit safety snapshot — so BotEditDiffView diffs that snapshot against the live
      // body, i.e. "before the bot edited → now". `onRestored` only tells the shell to reload the
      // list; the undo itself (and its confirm / errors) lives in the view.
      renderBotDiff={(v, host) => (
        <BotEditDiffView
          docId={docId}
          safetyVersionSeq={v.docVersionSeq}
          editor={editor}
          role={role}
          onClose={host.close}
          onRestored={() => host.restored()}
        />
      )}
      restoreErrorKey={(e) =>
        e instanceof VersionSchemaIncompatibleError || e instanceof VersionSchemaNewerError
          ? 'docs.version.errorRestoreIncompatible'
          : 'docs.version.errorRestore'
      }
    />
  )
}
