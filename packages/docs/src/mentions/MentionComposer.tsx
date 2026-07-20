// Rich comment composer — a minimal tiptap editor that renders @-mentions as real chips WHILE
// typing (unlike a <textarea>, which can only show the raw `@[…]` token). Typing `@` opens the
// SAME shared suggestion menu as the doc editor (buildMention). It reports its value to the parent
// as the usual token-string body (docToBody), so every submit/edit path and the stored/rendered
// format stay unchanged — MentionText still renders posted comments, octo-docs-backend still parses
// the tokens. The parent keeps owning the submit button + busy state; this only replaces the input.

import { useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { buildMention } from '../editor/mention.ts'
import { bodyToDoc, docToBody, type JSONNode } from './composerDoc.ts'

export function MentionComposer({
  initialBody = '',
  spaceId,
  placeholder,
  autoFocus,
  onChange,
  onSubmit,
  onCancel,
}: {
  /** Read ONCE for the initial content (edit mode passes the existing token body). */
  initialBody?: string
  spaceId?: string
  placeholder?: string
  autoFocus?: boolean
  /** Fires on every edit with the token-string body (same shape a textarea's value had). */
  onChange: (body: string) => void
  /** Cmd/Ctrl+Enter. */
  onSubmit?: () => void
  /** Escape. */
  onCancel?: () => void
}) {
  // tiptap v3's useEditor with a non-empty deps array ([spaceId]) does NOT re-apply editorProps on
  // re-render (only deps.length===0 reaches setOptions), so the handleKeyDown/onUpdate closures freeze
  // at creation time. Route every callback through a ref that we refresh each render, so Cmd/Ctrl+Enter
  // and onChange always see the latest parent state (otherwise keyboard-submit fires stale/empty body).
  const cb = useRef({ onChange, onSubmit, onCancel })
  cb.current = { onChange, onSubmit, onCancel }

  const editor = useEditor(
    {
      extensions: [
        // Keep comments plain (text + mentions): drop headings / lists / block marks / formatting
        // so the string body stays faithful (docToBody keeps text + mention tokens only).
        StarterKit.configure({
          heading: false,
          blockquote: false,
          codeBlock: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          horizontalRule: false,
          bold: false,
          italic: false,
          strike: false,
          code: false,
        }),
        Placeholder.configure({ placeholder: placeholder ?? '' }),
        buildMention({ spaceId }),
      ],
      content: bodyToDoc(initialBody),
      autofocus: autoFocus ? 'end' : false,
      editorProps: {
        attributes: { class: 'octo-mention-composer-content' },
        handleKeyDown: (_view, event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            cb.current.onSubmit?.()
            return true
          }
          if (event.key === 'Escape') {
            // Let the mention suggestion popup handle its own Escape first (it stops propagation
            // when open); if it reaches here, treat it as cancel — but only consume the event when
            // an onCancel is actually wired. Otherwise fall through so global handlers (close
            // sidebar / dismiss modal) still receive Escape.
            if (cb.current.onCancel) {
              cb.current.onCancel()
              return true
            }
            return false
          }
          return false
        },
      },
      onUpdate: ({ editor: ed }) => cb.current.onChange(docToBody(ed.getJSON() as JSONNode)),
    },
    [spaceId],
  )

  return (
    <div className="octo-comment-input octo-mention-composer">
      <EditorContent editor={editor} />
    </div>
  )
}
