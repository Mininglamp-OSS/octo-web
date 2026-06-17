import { useState, useSyncExternalStore } from 'react'
import { BubbleMenu, FloatingMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/core'
import { pickAndUploadImage } from './imageUpload.ts'
import { t } from '../octoweb/index.ts'

// Languages offered in the code-block language selector. A curated subset of the
// highlight.js `common` set registered in extensions.ts; "auto" (empty value)
// lets lowlight detect the language.
const CODE_LANGUAGES = [
  'javascript',
  'typescript',
  'tsx',
  'json',
  'python',
  'go',
  'rust',
  'java',
  'c',
  'cpp',
  'csharp',
  'bash',
  'shell',
  'sql',
  'yaml',
  'markdown',
  'html',
  'css',
] as const

function useEditorTick(editor: Editor): void {
  // Re-render toolbar on selection/content changes so active states stay current.
  useSyncExternalStore(
    (cb) => {
      editor.on('transaction', cb)
      editor.on('selectionUpdate', cb)
      return () => {
        editor.off('transaction', cb)
        editor.off('selectionUpdate', cb)
      }
    },
    () => editor.state.selection.from + ':' + editor.state.selection.to,
  )
}

function Btn({
  onClick,
  active,
  label,
  disabled,
  title,
}: {
  onClick: () => void
  active?: boolean
  label: string
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      className={'octo-tb-btn' + (active ? ' is-active' : '')}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  )
}

/** Selection bubble menu (frontend-design §3.3) — inline formatting. */
export function EditorBubbleMenu({ editor }: { editor: Editor }) {
  useEditorTick(editor)
  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e, from, to }) => from !== to && e.isEditable}
    >
      <div className="octo-bubble-menu">
        <Btn label="B" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
        <Btn label="I" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <Btn label="S" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} />
        <Btn label="<>" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} />
      </div>
    </BubbleMenu>
  )
}

/** Predicate for the block-insert FloatingMenu: show only on an empty, non-code
 * text block at the root depth with an empty selection. Mirrors the default
 * @tiptap/extension-floating-menu guards (the previous bare `isEditable`
 * override showed the menu on every collapsed cursor, including inside code
 * blocks, where clicking H1 destroyed the block). Exported for unit testing. */
export function shouldShowFloatingMenu(args: {
  isEditable: boolean
  selection: { empty: boolean; $anchor: { depth: number; parent: { isTextblock: boolean; childCount: number; type: { spec: { code?: boolean } } } } }
}): boolean {
  const { isEditable, selection } = args
  if (!isEditable) return false
  const { $anchor, empty } = selection
  if (!empty) return false
  const parent = $anchor.parent
  const isRootDepth = $anchor.depth === 1
  const isEmptyTextBlock = parent.isTextblock && !parent.type.spec.code && parent.childCount === 0
  return isRootDepth && isEmptyTextBlock
}

/** Empty-line floating menu (frontend-design §3.3) — block insert entry. */
export function EditorFloatingMenu({ editor }: { editor: Editor }) {
  return (
    <FloatingMenu
      editor={editor}
      shouldShow={({ editor: e, state }) =>
        shouldShowFloatingMenu({ isEditable: e.isEditable, selection: state.selection })
      }
    >
      <div className="octo-floating-menu">
        <Btn label="H1" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
        <Btn label="• List" onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <Btn label="Todo" onClick={() => editor.chain().focus().toggleTaskList().run()} />
      </div>
    </FloatingMenu>
  )
}

const HIGHLIGHT_COLORS = ['#fff3a3', '#ffd6cc', '#cdeccd', '#cfe2ff', '#e7d6ff'] as const
const TEXT_COLORS = ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#9c36b5'] as const

/** Text-highlight control (SCHEMA-SPEC §3): palette of background colours + clear. */
function HighlightControl({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="octo-color-control">
      <Btn
        label="🖍"
        active={editor.isActive('highlight')}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <span className="octo-color-popover">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="octo-swatch"
              style={{ backgroundColor: c }}
              title={`Highlight ${c}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                editor.chain().focus().toggleHighlight({ color: c }).run()
                setOpen(false)
              }}
            />
          ))}
          <Btn
            label="✕"
            onClick={() => {
              editor.chain().focus().unsetHighlight().run()
              setOpen(false)
            }}
          />
        </span>
      )}
    </span>
  )
}

/** Text-colour control (SCHEMA-SPEC §3): palette of font colours + clear. */
function TextColorControl({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="octo-color-control">
      <Btn label="A̲" active={editor.isActive('textStyle')} onClick={() => setOpen((v) => !v)} />
      {open && (
        <span className="octo-color-popover">
          {TEXT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="octo-swatch"
              style={{ backgroundColor: c }}
              title={`Text ${c}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                editor.chain().focus().setColor(c).run()
                setOpen(false)
              }}
            />
          ))}
          <Btn
            label="✕"
            onClick={() => {
              editor.chain().focus().unsetColor().run()
              setOpen(false)
            }}
          />
        </span>
      )}
    </span>
  )
}

/** Code-block language selector — visible only when the cursor is inside a code
 * block. Sets the codeBlock node's `language` attr, which CodeBlockLowlight uses
 * to pick the highlight.js grammar (empty = auto-detect). */
function CodeLanguageSelect({ editor }: { editor: Editor }) {
  useEditorTick(editor)
  if (!editor.isActive('codeBlock')) return null
  const current = (editor.getAttributes('codeBlock').language as string) || ''
  return (
    <select
      className="octo-code-lang"
      value={current}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => editor.chain().focus().updateAttributes('codeBlock', { language: e.target.value }).run()}
    >
      <option value="">auto</option>
      {CODE_LANGUAGES.map((lang) => (
        <option key={lang} value={lang}>
          {lang}
        </option>
      ))}
    </select>
  )
}

/** Fixed top toolbar (frontend-design §3.1). */
export function Toolbar({ editor }: { editor: Editor }) {
  useEditorTick(editor)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkValue, setLinkValue] = useState('')

  return (
    <div className="octo-toolbar">
      <Btn label="H1" title={t('docs.toolbar.heading1')} active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
      <Btn label="H2" title={t('docs.toolbar.heading2')} active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
      <Btn label="H3" title={t('docs.toolbar.heading3')} active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
      <Btn label="H4" title={t('docs.toolbar.heading4')} active={editor.isActive('heading', { level: 4 })} onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()} />
      <Btn label="H5" title={t('docs.toolbar.heading5')} active={editor.isActive('heading', { level: 5 })} onClick={() => editor.chain().focus().toggleHeading({ level: 5 }).run()} />
      <Btn label="H6" title={t('docs.toolbar.heading6')} active={editor.isActive('heading', { level: 6 })} onClick={() => editor.chain().focus().toggleHeading({ level: 6 }).run()} />
      <span className="octo-tb-sep" />
      <Btn label="B" title={t('docs.toolbar.bold')} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
      <Btn label="I" title={t('docs.toolbar.italic')} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <Btn label="S" title={t('docs.toolbar.strike')} active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} />
      <span className="octo-tb-sep" />
      <Btn label="• List" title={t('docs.toolbar.bulletList')} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <Btn label="1. List" title={t('docs.toolbar.orderedList')} active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
      <Btn label="Todo" title={t('docs.toolbar.taskList')} active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()} />
      <Btn label="Quote" title={t('docs.toolbar.quote')} active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
      <Btn label="Code" title={t('docs.toolbar.codeBlock')} active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
      <CodeLanguageSelect editor={editor} />
      <span className="octo-tb-sep" />
      <HighlightControl editor={editor} />
      <TextColorControl editor={editor} />
      <Btn
        label="Table"
        title={t('docs.toolbar.table')}
        active={editor.isActive('table')}
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      />
      <Btn label="Image" title={t('docs.toolbar.image')} onClick={() => void pickAndUploadImage(editor)} />
      <span className="octo-tb-sep" />
      <Btn label="Link" title={t('docs.toolbar.link')} active={editor.isActive('link')} onClick={() => setLinkOpen((v) => !v)} />
      {linkOpen && (
        <span className="octo-link-input">
          <input
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            placeholder={t('docs.toolbar.linkPlaceholder')}
          />
          <Btn
            label={t('docs.toolbar.linkSet')}
            onClick={() => {
              // Link extension's validate() enforces the scheme whitelist (§3.7).
              editor.chain().focus().extendMarkRange('link').setLink({ href: linkValue }).run()
              setLinkOpen(false)
              setLinkValue('')
            }}
          />
        </span>
      )}
      <span className="octo-tb-spacer" />
      <Btn label="Undo" title={t('docs.toolbar.undo')} onClick={() => editor.chain().focus().undo().run()} />
      <Btn label="Redo" title={t('docs.toolbar.redo')} onClick={() => editor.chain().focus().redo().run()} />
    </div>
  )
}
