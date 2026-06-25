import { EditorContent } from '@tiptap/react'
import { useCollabEditor } from '../collab/useCollabEditor.ts'
import type { CollabEditorOptions } from '../collab/createCollabEditor.ts'
import { canManage } from '../auth/roles.ts'
import { Toolbar, EditorBubbleMenu } from './Toolbar.tsx'
import { Outline } from './Outline.tsx'
import { StatusBar } from './StatusBar.tsx'
import { PresenceBar } from './PresenceBar.tsx'
import { MemberPanel } from '../members/MemberPanel.tsx'
import { VersionPanel } from '../versions/VersionPanel.tsx'
import { CommentPanel } from '../comments/CommentPanel.tsx'
import { CommentBubble } from '../comments/CommentBubble.tsx'
import { useDocComments } from '../comments/useDocComments.ts'
import { useCommentHighlights } from '../comments/useCommentHighlights.ts'
import { useDocDelete } from './useDocDelete.ts'
import { useMemberNames } from '../members/useMemberNames.ts'
import { exportDocToMarkdown, type MdNode } from '../export/markdown.ts'
import { emojiGlyph } from './emoji.ts'
import { colorFromId } from '../awareness/presence.ts'
import { useEffect, useState, useRef, useCallback } from 'react'
import { t } from '../octoweb/index.ts'
import { getDoc, updateDocTitle } from '../pages/docsApi.ts'
import './styles.css'

/** Which right-side drawer panel is open (mutually exclusive); null = drawer closed. */
type DrawerPanel = 'history' | 'comments' | 'members' | null

export interface EditorShellProps extends CollabEditorOptions {
  title: string
  /** Optional "back to the document list" handler — renders a header back control when provided. */
  onBack?: () => void
  /**
   * Return-to-list handler used on an in-flight terminal (doc deleted / access revoked, 4403).
   * Always wired by DocsHome (= backToList, which also clears the persisted target). Distinct
   * from `onBack`: `onExit` fires programmatically, `onBack` is the (optional) header button.
   */
  onExit?: () => void
  /** Called after a successful rename so the list can refresh its titles. */
  onTitleSaved?: (docId: string, title: string) => void
  /**
   * Called after a successful delete (Problem 4) so the list refreshes and the open doc returns
   * to the empty/list state. Wired by DocsHome to onDocDeleted; when absent, the shell falls back
   * to its own return-to-list handler (onExit ?? onBack).
   */
  onDeleted?: (docId: string) => void
}

/**
 * Base file name (no extension) for the Markdown export: the current document title, trimmed,
 * falling back to the localized "untitled" placeholder and finally a generic "document" so the
 * download always has a sensible name.
 */
export function exportDownloadName(title: string | null | undefined): string {
  return (title || t('docs.state.untitled')).trim() || 'document'
}

/**
 * Editable document title (BUG3). Renders the real document title (fetched via getDoc,
 * falling back to the passed-in title) instead of a hardcoded placeholder. For manage-role
 * users it is click-to-edit: Enter / blur commits via PATCH /docs/{docId}; Esc cancels.
 * Read-only users see a plain heading.
 */
function DocTitle({
  docId,
  initialTitle,
  canEdit,
  onSaved,
  onTitleLoaded,
}: {
  docId: string
  initialTitle: string
  canEdit: boolean
  onSaved?: (docId: string, title: string) => void
  /** Surfaces the real title fetched on mount so the parent can lift it (e.g. the export filename). */
  onTitleLoaded?: (title: string) => void
}) {
  const placeholder = t('docs.state.untitled')
  const [title, setTitle] = useState(initialTitle)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initialTitle)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // True while a commit is in flight; prevents the Enter-then-blur double commit and
  // any concurrent re-entry. Always reset in finally so it can never get stuck.
  const committingRef = useRef(false)
  // Set true when an edit session ends so the trailing blur (after a programmatic commit
  // or cancel) does not re-commit. Reset when a new edit session starts.
  const doneRef = useRef(false)

  // Fetch the real title once on mount (resilient: keep the fallback prop on failure). Surface the
  // fetched title to the parent so the live (current) title — not the initial prop — drives things
  // like the export filename.
  useEffect(() => {
    let cancelled = false
    getDoc(docId)
      .then((meta) => {
        if (!cancelled && typeof meta?.title === 'string') {
          setTitle(meta.title)
          onTitleLoaded?.(meta.title)
        }
      })
      .catch(() => {
        /* keep the passed-in fallback title */
      })
    return () => {
      cancelled = true
    }
  }, [docId])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const startEdit = useCallback(() => {
    if (!canEdit) return
    doneRef.current = false
    setDraft(title)
    setEditing(true)
  }, [canEdit, title])

  const commit = useCallback(async () => {
    // Read the freshest value straight from the DOM input to avoid any stale-closure
    // draft; fall back to state draft if the input is already gone.
    const raw = inputRef.current?.value ?? draft
    const next = raw.trim()
    // Re-entrancy / double-commit (Enter then blur) guard.
    if (committingRef.current || doneRef.current) return
    // No-op (empty or unchanged): just leave edit mode, no PATCH.
    if (!next || next === title) {
      doneRef.current = true
      setDraft(title)
      setEditing(false)
      return
    }
    committingRef.current = true
    setSaving(true)
    try {
      await updateDocTitle(docId, next)
      doneRef.current = true
      setTitle(next)
      setDraft(next)
      onSaved?.(docId, next)
      setEditing(false) // only leave edit mode AFTER a successful PATCH
    } catch {
      // Keep the input open with the user's draft so the edit isn't silently lost.
      setEditing(true)
      setTimeout(() => inputRef.current?.focus(), 0)
    } finally {
      setSaving(false)
      committingRef.current = false
    }
  }, [draft, title, docId, onSaved])

  const cancel = useCallback(() => {
    doneRef.current = true // suppress the blur-commit that follows programmatic blur
    setDraft(title)
    setEditing(false)
  }, [title])

  const hasTitle = !!title && title.trim().length > 0
  const display = hasTitle ? title : placeholder

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="octo-doc-title octo-doc-title-input"
        value={draft}
        disabled={saving}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          void commit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit() // commit directly; doneRef stops the trailing blur re-commit
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancel()
          }
        }}
      />
    )
  }

  return (
    <h1
      className={
        canEdit
          ? 'octo-doc-title octo-doc-title-editable'
          : 'octo-doc-title'
      }
      title={canEdit ? t('docs.title.editHint') : undefined}
      onClick={startEdit}
      role={canEdit ? 'button' : undefined}
      tabIndex={canEdit ? 0 : undefined}
      onKeyDown={
        canEdit
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                startEdit()
              }
            }
          : undefined
      }
    >
      {display}
    </h1>
  )
}

/** Page shell (frontend-design §3.1): title / toolbar / content / presence + right-side drawer. */
export function EditorShell(props: EditorShellProps) {
  const { title, onBack, onExit, onTitleSaved, onDeleted, ...collabOpts } = props
  const docId = props.docId
  const { instance, ready, role, connState, terminal } = useCollabEditor(collabOpts)
  // The live document title, lifted out of DocTitle so the export filename uses the current
  // (fetched / edited) title rather than the initial `title` prop. Seeded from the prop, then
  // updated when DocTitle fetches the real title on mount and when the user renames the doc.
  const [currentTitle, setCurrentTitle] = useState(title)
  // #4/#5: a single mutually-exclusive drawer panel (history | comments | members | null),
  // replacing the three independent show* booleans.
  const [activePanel, setActivePanel] = useState<DrawerPanel>(null)
  const [activeCommentId, setActiveCommentId] = useState<number | null>(null)
  // #A1: the document owner's uid, fetched from doc meta, so the member panel can mark the owner
  // row with an "Owner" badge even on a brand-new single-member (self-owned) document. Without
  // this the panel falls back to a role heuristic that never matches a fresh doc, so the badge
  // never shows. Resilient: stays null if the meta lacks ownerId.
  const [ownerId, setOwnerId] = useState<string | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    getDoc(docId)
      .then((meta) => {
        if (!cancelled && typeof meta?.ownerId === 'string' && meta.ownerId) setOwnerId(meta.ownerId)
      })
      .catch(() => {
        /* non-fatal: owner badge just won't show */
      })
    return () => {
      cancelled = true
    }
  }, [docId])

  // uid → display name for this space (#8): once resolved, push the real name into awareness so
  // the presence avatar initial and the collaboration caret label show the name, not the uid.
  // The editor is created with the best-known name; this updates it when the member list lands.
  const names = useMemberNames(props.space)

  // C4 (#5): reset the drawer whenever the document changes. The shell is keyed by docId in
  // DocsHome (so it already remounts), but this makes the reset explicit and robust if the key
  // strategy ever changes — open history on doc A, switch to doc B → drawer is closed, no stale A.
  useEffect(() => {
    setActivePanel(null)
    setActiveCommentId(null)
  }, [docId])

  // Push the resolved display name into the local awareness `user` field. Resilient: falls back
  // to the uid; never throws if the provider lacks the setter. Keeps the same id/color so the
  // presence dedupe + count (keyed by id) are unaffected — only the displayed name changes.
  useEffect(() => {
    const provider = instance?.provider as
      | { setAwarenessField?: (key: string, value: unknown) => void }
      | undefined
    if (!provider?.setAwarenessField) return
    const uid = props.uid
    const name = names.get(uid) || uid
    provider.setAwarenessField('user', { id: uid, name, color: colorFromId(uid) })
  }, [instance, names, props.uid])

  // Comment state is owned here (single source of truth) so the highlight layer and the panel
  // share it; highlights paint regardless of whether the panel is open.
  const comments = useDocComments(docId)
  useCommentHighlights(instance?.editor ?? null, comments.threads)

  // A click on a comment highlight (decoration layer) opens the comments drawer on that thread.
  useEffect(() => {
    const editor = instance?.editor
    if (!editor) return
    editor.storage.octoCommentHighlight.onActivate = (id: number) => {
      setActivePanel('comments')
      setActiveCommentId(id)
    }
    return () => {
      if (editor.storage.octoCommentHighlight) editor.storage.octoCommentHighlight.onActivate = null
    }
  }, [instance])

  // In-flight deletion / access revocation (4403): show "Document deleted" briefly, then return
  // to the list (onExit = backToList, which also clears the persisted target). onBack is the
  // fallback if onExit wasn't wired.
  const returnToList = onExit ?? onBack
  useEffect(() => {
    if (terminal.kind !== 'deleted' || !returnToList) return
    const id = setTimeout(returnToList, 1200)
    return () => clearTimeout(id)
  }, [terminal.kind, returnToList])

  // Delete entry (Problem 4): on success return to the list. Prefer the parent's onDeleted (it
  // also refreshes the resident list); fall back to the shell's own return-to-list handler.
  const handleDeleted = useCallback(
    (id: string) => {
      if (onDeleted) onDeleted(id)
      else returnToList?.()
    },
    [onDeleted, returnToList],
  )
  const del = useDocDelete(docId, handleDeleted)

  // Export-as-Markdown (batch 8, area C): serialize the live PM JSON to Markdown with freshly
  // resolved signed asset URLs and trigger a browser download. Display-only — never mutates
  // the doc; failures surface a small banner instead of crashing the editor.
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const onExportMarkdown = useCallback(async () => {
    const ed = instance?.editor
    if (!ed || exporting) return
    setExporting(true)
    setExportError(null)
    try {
      const md = await exportDocToMarkdown(docId, ed.getJSON() as unknown as MdNode, { emojiGlyph })
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${exportDownloadName(currentTitle)}.md`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setExportError(t('docs.toolbar.exportError'))
    } finally {
      setExporting(false)
    }
  }, [instance, docId, currentTitle, exporting])

  const togglePanel = useCallback(
    (panel: Exclude<DrawerPanel, null>) => setActivePanel((cur) => (cur === panel ? null : panel)),
    [],
  )
  const closePanel = useCallback(() => setActivePanel(null), [])

  if (terminal.kind !== 'none') {
    const messages: Record<string, string> = {
      forbidden: t('docs.error.permission.forbidden'),
      'not-found': t('docs.error.permission.notFound'),
      locked: t('docs.error.permission.locked'),
      login: t('docs.error.permission.login'),
      deleted: t('docs.error.permission.deleted'),
    }
    return (
      <div className="octo-doc octo-terminal">
        {onBack && (
          <button type="button" className="octo-doc-back" onClick={onBack}>
            ← {t('docs.list.back')}
          </button>
        )}
        <h2>{title}</h2>
        <p className="octo-terminal-msg">{messages[terminal.kind]}</p>
      </div>
    )
  }

  if (!instance) {
    return (
      <div className="octo-doc">
        <p className="octo-loading">{t('docs.state.loading')}</p>
      </div>
    )
  }

  const editor = instance.editor
  const manage = role ? canManage(role) : false

  return (
    <div className="octo-doc octo-doc--editor octo-theme">
      <header className="octo-doc-header">
        {onBack && (
          <button
            type="button"
            className="octo-doc-back"
            title={t('docs.list.back')}
            onClick={onBack}
          >
            ← {t('docs.list.back')}
          </button>
        )}
        <DocTitle
          docId={docId}
          initialTitle={title}
          canEdit={manage}
          onSaved={(id, t) => {
            setCurrentTitle(t)
            onTitleSaved?.(id, t)
          }}
          onTitleLoaded={setCurrentTitle}
        />
        <div className="octo-doc-header-right">
          <PresenceBar provider={instance.provider} connState={connState} synced={ready} />
          {/* History is reader+ (everyone with access), unlike admin-only Members. */}
          <button
            type="button"
            className={activePanel === 'history' ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
            title={t('docs.toolbar.history')}
            aria-pressed={activePanel === 'history'}
            onClick={() => togglePanel('history')}
          >
            🕐 {t('docs.toolbar.history')}
          </button>
          {/* Comments are reader+ (everyone with access — "can see → can comment"). */}
          <button
            type="button"
            className={activePanel === 'comments' ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
            title={t('docs.toolbar.comments')}
            aria-pressed={activePanel === 'comments'}
            onClick={() => togglePanel('comments')}
          >
            💬 {t('docs.toolbar.comments')}
          </button>
          {/* Export the document as a Markdown file (reader+ — anyone who can view can export). */}
          <button
            type="button"
            className="octo-tb-btn"
            title={t('docs.toolbar.exportMarkdown')}
            disabled={exporting}
            onClick={() => void onExportMarkdown()}
          >
            ⬇ {t('docs.toolbar.exportMarkdown')}
          </button>
          {manage && (
            <button
              type="button"
              className={activePanel === 'members' ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
              aria-pressed={activePanel === 'members'}
              onClick={() => togglePanel('members')}
            >
              {t('docs.toolbar.members')}
            </button>
          )}
          {/* Delete entry (Problem 4) — owner/admin only; moved here from the list row. */}
          {manage && (
            <button
              type="button"
              className="octo-tb-btn octo-doc-delete-btn"
              title={t('docs.doc.deleteEntry')}
              onClick={del.requestDelete}
            >
              🗑 {t('docs.doc.deleteEntry')}
            </button>
          )}
        </div>
      </header>

      {/* Delete confirm + error banner (reuses the list's confirm/error pattern). */}
      {del.confirming && (
        <div
          className="octo-docs-delete-confirm octo-doc-delete-confirm"
          role="alertdialog"
          aria-label={t('docs.doc.deleteConfirmTitle')}
        >
          <p className="octo-docs-delete-confirm-text">{t('docs.doc.deleteConfirm')}</p>
          <div className="octo-docs-delete-confirm-actions">
            <button
              type="button"
              className="octo-tb-btn"
              disabled={del.deleting}
              onClick={del.cancel}
            >
              {t('docs.doc.deleteCancel')}
            </button>
            <button
              type="button"
              className="octo-tb-btn octo-docs-delete-confirm-go"
              disabled={del.deleting}
              onClick={() => void del.confirm()}
            >
              {t('docs.doc.delete')}
            </button>
          </div>
        </div>
      )}
      {del.error && (
        <p className="octo-member-error" role="alert">
          {del.error}
        </p>
      )}
      {exportError && (
        <p className="octo-member-error" role="alert">
          {exportError}
        </p>
      )}

      <Toolbar editor={editor} />

      <div className="octo-editor-region">
        <EditorBubbleMenu editor={editor} />
        <CommentBubble editor={editor} onCreate={comments.createRoot} />
        <Outline editor={editor} />
        <div className="octo-editor-main">
          <EditorContent editor={editor} className="octo-prose" />
        </div>
      </div>

      <StatusBar editor={editor} provider={instance.provider} />

      {/* History + Comments live in the right-side drawer; Members opens a dedicated modal (#A4). */}
      {(activePanel === 'history' || activePanel === 'comments') && (
        <aside className="octo-doc-drawer" role="complementary">
          {activePanel === 'history' && role && (
            <VersionPanel docId={docId} role={role} editor={editor} names={names} onClose={closePanel} />
          )}
          {activePanel === 'comments' && role && (
            <CommentPanel
              role={role}
              editor={editor}
              comments={comments}
              activeCommentId={activeCommentId}
              onSelectComment={setActiveCommentId}
              names={names}
              onClose={closePanel}
            />
          )}
        </aside>
      )}

      {/* #A4: "Manage members" opens a dedicated modal dialog (overlay), not an inline drawer. */}
      {activePanel === 'members' && manage && (
        <div className="octo-modal-overlay" role="presentation" onMouseDown={closePanel}>
          <div
            className="octo-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t('docs.member.manage')}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <MemberPanel docId={docId} role={role!} space={props.space} ownerId={ownerId} onClose={closePanel} />
          </div>
        </div>
      )}
    </div>
  )
}
