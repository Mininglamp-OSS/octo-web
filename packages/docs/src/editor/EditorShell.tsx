import { EditorContent } from '@tiptap/react'
import { useCollabEditor } from '../collab/useCollabEditor.ts'
import type { CollabEditorOptions } from '../collab/createCollabEditor.ts'
import { canManage } from '../auth/roles.ts'
import { Toolbar, EditorBubbleMenu, EditorFloatingMenu } from './Toolbar.tsx'
import { Outline } from './Outline.tsx'
import { PresenceBar } from './PresenceBar.tsx'
import { MemberPanel } from '../members/MemberPanel.tsx'
import { VersionPanel } from '../versions/VersionPanel.tsx'
import { CommentPanel } from '../comments/CommentPanel.tsx'
import { CommentBubble } from '../comments/CommentBubble.tsx'
import { useDocComments } from '../comments/useDocComments.ts'
import { useCommentHighlights } from '../comments/useCommentHighlights.ts'
import { useEffect, useState } from 'react'
import './styles.css'

export interface EditorShellProps extends CollabEditorOptions {
  title: string
}

/** Page shell (frontend-design §3.1): title / toolbar / content / presence + member panel. */
export function EditorShell(props: EditorShellProps) {
  const { title, ...collabOpts } = props
  const docId = props.docId
  const { instance, ready, role, connState, terminal } = useCollabEditor(collabOpts)
  const [showMembers, setShowMembers] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [activeCommentId, setActiveCommentId] = useState<number | null>(null)

  // Comment state is owned here (single source of truth) so the highlight layer and the panel
  // share it; highlights paint regardless of whether the panel is open.
  const comments = useDocComments(docId)
  useCommentHighlights(instance?.editor ?? null, comments.threads)

  // A click on a comment highlight (decoration layer) opens the panel on that thread.
  useEffect(() => {
    const editor = instance?.editor
    if (!editor) return
    editor.storage.octoCommentHighlight.onActivate = (id: number) => {
      setShowComments(true)
      setActiveCommentId(id)
    }
    return () => {
      if (editor.storage.octoCommentHighlight) editor.storage.octoCommentHighlight.onActivate = null
    }
  }, [instance])

  if (terminal.kind !== 'none') {
    const messages: Record<string, string> = {
      forbidden: 'You no longer have access to this document.',
      'not-found': 'This document does not exist or was deleted.',
      locked: 'This document is locked or archived.',
      login: 'Your session expired. Please sign in again.',
    }
    return (
      <div className="octo-doc octo-terminal">
        <h2>{title}</h2>
        <p className="octo-terminal-msg">{messages[terminal.kind]}</p>
      </div>
    )
  }

  if (!instance) {
    return (
      <div className="octo-doc">
        <p className="octo-loading">Loading document…</p>
      </div>
    )
  }

  const editor = instance.editor
  const manage = role ? canManage(role) : false

  return (
    <div className="octo-doc octo-theme">
      <header className="octo-doc-header">
        <h1 className="octo-doc-title">{title}</h1>
        <div className="octo-doc-header-right">
          <PresenceBar provider={instance.provider} connState={connState} synced={ready} />
          {/* History is reader+ (everyone with access), unlike admin-only Members. */}
          <button
            type="button"
            className="octo-tb-btn"
            title="Version history"
            onClick={() => setShowHistory((v) => !v)}
          >
            🕐 History
          </button>
          {/* Comments are reader+ (everyone with access — "can see → can comment"). */}
          <button
            type="button"
            className="octo-tb-btn"
            title="Comments"
            onClick={() => setShowComments((v) => !v)}
          >
            💬 Comments
          </button>
          {manage && (
            <button type="button" className="octo-tb-btn" onClick={() => setShowMembers((v) => !v)}>
              Members
            </button>
          )}
        </div>
      </header>

      <Toolbar editor={editor} />

      <div className="octo-editor-region">
        <EditorBubbleMenu editor={editor} />
        <EditorFloatingMenu editor={editor} />
        <CommentBubble editor={editor} onCreate={comments.createRoot} />
        <div className="octo-editor-main">
          <EditorContent editor={editor} className="octo-prose" />
        </div>
        <Outline editor={editor} />
      </div>

      {manage && showMembers && (
        <MemberPanel docId={docId} role={role!} onClose={() => setShowMembers(false)} />
      )}

      {showHistory && role && (
        <VersionPanel
          docId={docId}
          role={role}
          editor={editor}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showComments && role && (
        <CommentPanel
          role={role}
          editor={editor}
          comments={comments}
          activeCommentId={activeCommentId}
          onSelectComment={setActiveCommentId}
          onClose={() => setShowComments(false)}
        />
      )}
    </div>
  )
}
