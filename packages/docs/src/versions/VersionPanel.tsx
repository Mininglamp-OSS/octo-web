import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import type { Role } from '../auth/roles.ts'
import { buildPreviewExtensions } from '../editor/extensions.ts'
import {
  getVersionState,
  VersionSchemaIncompatibleError,
  VersionSchemaNewerError,
} from './api.ts'
import { diffDocs, type DiffEntry, type PMNode } from './diff.ts'
import { VersionHistoryPanel } from './VersionHistoryPanel.tsx'
import { t } from '../octoweb/index.ts'

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

/** Block-level diff render: added / removed / changed / unchanged rows (feature #4 §1.4). */
function DiffView({ diff }: { diff: DiffEntry[] }) {
  if (diff.length === 1 && diff[0].type === 'too-large') {
    return <p className="octo-version-empty">{t('docs.version.tooLarge')}</p>
  }
  if (diff.every((d) => d.type === 'unchanged')) {
    return <p className="octo-version-empty">{t('docs.version.noChanges')}</p>
  }
  return (
    <div className="octo-version-diff">
      {diff.map((d, i) => {
        if (d.type === 'changed') {
          return (
            <div key={i} className="octo-diff-changed">
              <div className="octo-diff-line octo-diff-removed">- {d.before}</div>
              <div className="octo-diff-line octo-diff-added">+ {d.after}</div>
            </div>
          )
        }
        const sign = d.type === 'added' ? '+' : d.type === 'removed' ? '-' : ' '
        return (
          <div key={i} className={`octo-diff-line octo-diff-${d.type}`}>
            {sign} {d.text || ' '}
          </div>
        )
      })}
    </div>
  )
}

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
}: {
  docId: string
  role: Role
  /** Live editor — read-only here; used as the "current" side of a diff. */
  editor?: Editor
  /** uid → display-name map (feature #7) so the author shows a name, not a raw uid. */
  names?: Map<string, string>
  onClose?: () => void
}) {
  return (
    <VersionHistoryPanel<PMNode, PMNode>
      docId={docId}
      role={role}
      names={names}
      onClose={onClose}
      pageSize={PAGE_SIZE}
      loadPreviewState={(seq, signal) => getVersionState(docId, seq, signal).then((r) => r.doc)}
      renderPreview={(doc) => <VersionPreview docId={docId} content={doc} />}
      renderDiff={(version, current) => <DiffView diff={diffDocs(version, current)} />}
      getCurrent={() => (editor?.getJSON() as PMNode | undefined) ?? null}
      restoreErrorKey={(e) =>
        e instanceof VersionSchemaIncompatibleError || e instanceof VersionSchemaNewerError
          ? 'docs.version.errorRestoreIncompatible'
          : 'docs.version.errorRestore'
      }
    />
  )
}
