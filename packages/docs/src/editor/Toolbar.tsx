import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/core'
import { pickAndUploadImage } from './imageUpload.ts'
import { pickAndUploadFile } from './fileUpload.ts'
import { promptAndInsertBookmark } from './bookmarkInsert.ts'
import { getFindState, revealMatchInView } from './findReplace.ts'
import { pickerEmojis } from './emoji.ts'
import { promptAndInsertMath } from './mathInsert.ts'
import { sanitizeLinkHref } from './sanitize.ts'
import { CALLOUT_VARIANTS, type CalloutVariant } from './Callout.ts'
import { t } from '../octoweb/index.ts'

// Inline SVG toolbar icons (C2–C4): crisp, correct glyphs for underline / strikethrough /
// alignment, replacing the ambiguous text placeholders. 16×16, fill: currentColor (via .octo-tb-icon).
const IconUnderline = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 17c3.31 0 6-2.69 6-6V3h-2.5v8c0 1.93-1.57 3.5-3.5 3.5S8.5 12.93 8.5 11V3H6v8c0 3.31 2.69 6 6 6zM5 19v2h14v-2H5z" />
  </svg>
)
const IconStrike = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 12.2h18v1.6H3v-1.6zM10.7 9.5c-.3-.2-.6-.5-.8-.8-.2-.3-.3-.7-.3-1.1 0-.7.3-1.3.8-1.7.6-.4 1.3-.6 2.2-.6.9 0 1.7.2 2.2.7.5.4.8 1 .9 1.8h2.1c0-.8-.3-1.5-.7-2.2-.4-.6-1-1.1-1.8-1.5-.8-.3-1.6-.5-2.6-.5-1 0-1.9.2-2.7.5-.8.3-1.4.8-1.8 1.4-.4.6-.6 1.3-.6 2 0 .9.3 1.6.9 2.3h4zM13.9 15.2c.3.3.5.7.5 1.2 0 .7-.3 1.2-.8 1.6-.5.4-1.3.6-2.2.6-1 0-1.8-.2-2.4-.7-.6-.4-.9-1.1-.9-1.9H6c0 .9.2 1.6.7 2.3.5.7 1.1 1.2 2 1.5.8.4 1.8.5 2.8.5 1.5 0 2.7-.3 3.6-1 .9-.7 1.3-1.6 1.3-2.7 0-.6-.1-1.1-.4-1.6h-2.2c.1.1.1.2.1.3z" />
  </svg>
)
const IconAlignLeft = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 5h18v2H3V5zm0 4h12v2H3V9zm0 4h18v2H3v-2zm0 4h12v2H3v-2z" />
  </svg>
)
const IconAlignCenter = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 5h18v2H3V5zm3 4h12v2H6V9zm-3 4h18v2H3v-2zm3 4h12v2H6v-2z" />
  </svg>
)
const IconAlignRight = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 5h18v2H3V5zm6 4h12v2H9V9zm-6 4h18v2H3v-2zm6 4h12v2H9v-2z" />
  </svg>
)
const IconAlignJustify = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 5h18v2H3V5zm0 4h18v2H3V9zm0 4h18v2H3v-2zm0 4h18v2H3v-2z" />
  </svg>
)

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
  label: ReactNode
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
        <Btn label={<IconUnderline />} title={t('docs.toolbar.underline')} active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} />
        <Btn label={<IconStrike />} title={t('docs.toolbar.strike')} active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} />
        <Btn label="<>" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} />
      </div>
    </BubbleMenu>
  )
}

/**
 * Predicate kept (and unit-tested) for the block-insert affordance: an empty, non-code
 * text block at root depth with a collapsed selection. The old auto-popping FloatingMenu
 * that rendered on this predicate and trailed the caret was removed (boss: "too sticky,
 * blocks the view"); the insert menu is now triggered from the gutter "+" button
 * (BlockDragHandle, hover-only) or the `/` slash command — never auto-following the cursor.
 */
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

/** Font-size presets (px) offered by the toolbar dropdown (SCHEMA_VERSION 7). */
const FONT_SIZES = ['12', '14', '16', '18', '24', '32'] as const

/** Text-alignment options (SCHEMA_VERSION 5) — value passed to setTextAlign, icon per direction (C4). */
const ALIGNMENTS = [
  { value: 'left', icon: <IconAlignLeft />, key: 'alignLeft' },
  { value: 'center', icon: <IconAlignCenter />, key: 'alignCenter' },
  { value: 'right', icon: <IconAlignRight />, key: 'alignRight' },
  { value: 'justify', icon: <IconAlignJustify />, key: 'alignJustify' },
] as const

/** Curated emoji subset for the toolbar picker grid — real glyphs, regional-indicator letters excluded (D1). */
const EMOJI_PICKER = pickerEmojis(48)

/** Font-size dropdown (SCHEMA_VERSION 7): sets the textStyle `fontSize` attr (px), or clears it. */
function FontSizeSelect({ editor }: { editor: Editor }) {
  useEditorTick(editor)
  const current = ((editor.getAttributes('textStyle').fontSize as string) || '').replace('px', '')
  return (
    <select
      className="octo-font-size"
      title={t('docs.toolbar.fontSize')}
      value={current}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const v = e.target.value
        if (!v) editor.chain().focus().unsetFontSize().run()
        else editor.chain().focus().setFontSize(`${v}px`).run()
      }}
    >
      <option value="">{t('docs.toolbar.fontSizeDefault')}</option>
      {FONT_SIZES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  )
}

/** Block-type dropdown (C1): collapses H1–H6 + a "Body text" (paragraph) option into one selector
 * that reflects the current block. Selecting a heading sets it; "Body text" sets a paragraph. */
function BlockTypeSelect({ editor }: { editor: Editor }) {
  useEditorTick(editor)
  let current = 'p'
  for (let l = 1; l <= 6; l += 1) {
    if (editor.isActive('heading', { level: l })) {
      current = `h${l}`
      break
    }
  }
  return (
    <select
      className="octo-block-type"
      title={t('docs.toolbar.blockType')}
      value={current}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const v = e.target.value
        if (v === 'p') editor.chain().focus().setParagraph().run()
        else
          editor
            .chain()
            .focus()
            .setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6 })
            .run()
      }}
    >
      <option value="p">{t('docs.toolbar.bodyText')}</option>
      {[1, 2, 3, 4, 5, 6].map((l) => (
        <option key={l} value={`h${l}`}>
          {t(`docs.toolbar.heading${l}`)}
        </option>
      ))}
    </select>
  )
}

/** Text-alignment buttons (SCHEMA_VERSION 5): left/center/right/justify on heading + paragraph. */
function AlignControls({ editor }: { editor: Editor }) {
  return (
    <>
      {ALIGNMENTS.map((a) => (
        <Btn
          key={a.value}
          label={a.icon}
          title={t(`docs.toolbar.${a.key}`)}
          active={editor.isActive({ textAlign: a.value })}
          onClick={() => editor.chain().focus().setTextAlign(a.value).run()}
        />
      ))}
    </>
  )
}

/** Emoji picker (SCHEMA_VERSION 9): a small grid that inserts via the emoji node's setEmoji. */
function EmojiControl({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="octo-color-control">
      <Btn label="😀" title={t('docs.toolbar.emoji')} active={open} onClick={() => setOpen((v) => !v)} />
      {open && (
        <span className="octo-emoji-popover">
          {EMOJI_PICKER.map((e) => (
            <button
              key={e.name}
              type="button"
              className="octo-emoji-swatch"
              title={`:${e.shortcodes[0] ?? e.name}:`}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => {
                editor.chain().focus().setEmoji(e.shortcodes[0] ?? e.name).run()
                setOpen(false)
              }}
            >
              {e.emoji}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

/** Callout control (SCHEMA_VERSION 12): pick a variant (info/warn/tip/success) to wrap the block. */
function CalloutControl({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="octo-color-control">
      <Btn
        label="ⓘ"
        title={t('docs.toolbar.callout')}
        active={editor.isActive('callout')}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <span className="octo-color-popover">
          {CALLOUT_VARIANTS.map((v: CalloutVariant) => (
            <button
              key={v}
              type="button"
              className="octo-tb-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                editor.chain().focus().toggleCallout({ variant: v }).run()
                setOpen(false)
              }}
            >
              {t(`docs.callout.${v}`)}
            </button>
          ))}
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

/**
 * Find & replace bar (toolbar item ⑪). Drives the FindReplace extension: typing sets the search
 * term (live match highlight via decorations), prev/next walk matches, replace acts on the current
 * match, replace-all on all. Esc closes; the search is cleared on unmount so no stray highlights
 * linger.
 */
function FindBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  useEditorTick(editor)
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)

  // Push the term into the plugin whenever it / the case flag changes, then bring the first
  // match into view (revealMatchInView no-ops if it's already comfortably visible, so live typing
  // doesn't jerk-scroll when the first hit is already on screen).
  useEffect(() => {
    editor.commands.setFindQuery(query, caseSensitive)
    requestAnimationFrame(() => {
      const f = getFindState(editor.state)
      const m = f.matches[f.index]
      if (m) revealMatchInView(editor.view, m.from)
    })
  }, [editor, query, caseSensitive])

  // Clear the search (and its decorations) when the bar unmounts.
  useEffect(() => () => editor.commands.clearFind() as unknown as void, [editor])

  const fs = getFindState(editor.state)
  const total = fs.matches.length
  const current = fs.index >= 0 ? fs.index + 1 : 0

  /** Select + scroll the editor to the current match so prev/next visibly move the caret. */
  function revealCurrent() {
    const f = getFindState(editor.state)
    const m = f.matches[f.index]
    if (!m) return
    // Move the caret onto the match (so the active decoration + selection agree), but do the
    // actual scrolling ourselves: ProseMirror's native scrollIntoView only clips the match to the
    // viewport edge, where our sticky toolbar then hides it. revealMatchInView centers it in the
    // usable area below the sticky header. Run on the next frame so the selection/decoration from
    // this dispatch have committed and coordsAtPos is accurate.
    editor.chain().setTextSelection({ from: m.from, to: m.to }).run()
    requestAnimationFrame(() => {
      const cur = getFindState(editor.state)
      const target = cur.matches[cur.index]
      if (target) revealMatchInView(editor.view, target.from)
    })
  }

  return (
    <div className="octo-find-bar">
      <div className="octo-find-row">
        <input
          className="octo-find-input"
          placeholder={t('docs.find.placeholder')}
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            } else if (e.key === 'Enter') {
              e.preventDefault()
              if (e.shiftKey) editor.commands.findPrev()
              else editor.commands.findNext()
              revealCurrent()
            }
          }}
        />
        <span className="octo-find-count">
          {total > 0 ? t('docs.find.count', { values: { index: current, total } }) : t('docs.find.noResults')}
        </span>
        <Btn
          label="‹"
          title={t('docs.find.prev')}
          disabled={total === 0}
          onClick={() => {
            editor.commands.findPrev()
            revealCurrent()
          }}
        />
        <Btn
          label="›"
          title={t('docs.find.next')}
          disabled={total === 0}
          onClick={() => {
            editor.commands.findNext()
            revealCurrent()
          }}
        />
        <label className="octo-find-case" title={t('docs.find.caseSensitive')}>
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          Aa
        </label>
        <Btn label="✕" title={t('docs.find.close')} onClick={onClose} />
      </div>
      {editor.isEditable && (
        <div className="octo-find-row">
          <input
            className="octo-find-input"
            placeholder={t('docs.find.replacePlaceholder')}
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
          />
          <Btn
            label={t('docs.find.replace')}
            disabled={total === 0}
            onClick={() => editor.commands.replaceCurrent(replacement)}
          />
          <Btn
            label={t('docs.find.replaceAll')}
            disabled={total === 0}
            onClick={() => editor.commands.replaceAll(replacement)}
          />
        </div>
      )}
    </div>
  )
}

/** Math insert control (C5): a small input popover that prompts for the LaTeX, then inserts inline
 * or block math with the user's formula (no more hardcoded 'a^2 + b^2 = c^2'). Empty → no insert. */
function MathControl({ editor, kind }: { editor: Editor; kind: 'inline' | 'block' }) {
  const [open, setOpen] = useState(false)
  const [latex, setLatex] = useState('')
  function confirm() {
    const v = latex.trim()
    if (v) {
      if (kind === 'inline') editor.chain().focus().insertInlineMath({ latex: v }).run()
      else editor.chain().focus().insertBlockMath({ latex: v }).run()
    }
    setOpen(false)
    setLatex('')
  }
  return (
    <span className="octo-color-control">
      <Btn
        label={kind === 'inline' ? '∑' : '∑▤'}
        title={t(kind === 'inline' ? 'docs.toolbar.mathInline' : 'docs.toolbar.mathBlock')}
        active={open}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <span className="octo-color-popover octo-math-popover">
          <input
            className="octo-find-input"
            autoFocus
            value={latex}
            placeholder={t('docs.toolbar.mathPlaceholder')}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => setLatex(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                confirm()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setOpen(false)
                setLatex('')
              }
            }}
          />
          <Btn label={t('docs.toolbar.insert')} onClick={confirm} />
        </span>
      )}
    </span>
  )
}

/** Fixed top toolbar (frontend-design §3.1). */
export function Toolbar({ editor }: { editor: Editor }) {
  useEditorTick(editor)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkText, setLinkText] = useState('')
  const [linkValue, setLinkValue] = useState('')
  const [findOpen, setFindOpen] = useState(false)

  // C7: open the link popup, pre-filling the text from the current selection and the URL from any
  // link already under the cursor.
  function openLink() {
    setLinkOpen((v) => {
      const next = !v
      if (next) {
        const { from, to } = editor.state.selection
        setLinkText(from !== to ? editor.state.doc.textBetween(from, to, ' ') : '')
        setLinkValue((editor.getAttributes('link').href as string) || '')
      }
      return next
    })
  }

  function closeLink() {
    setLinkOpen(false)
    setLinkText('')
    setLinkValue('')
  }

  // C7: insert a link at the cursor (or apply it to the selection). With no selection a brand-new
  // linked label is inserted at the caret; with a selection whose text is unchanged the link is
  // applied to it (preserving any other marks); if the text was edited it replaces the selection.
  // sanitizeLinkHref enforces the scheme whitelist (§3.7) — an unsafe or empty URL inserts nothing.
  function confirmLink() {
    const href = sanitizeLinkHref(linkValue.trim())
    if (!href) {
      closeLink()
      return
    }
    const { from, to } = editor.state.selection
    const selText = from !== to ? editor.state.doc.textBetween(from, to, ' ') : ''
    const text = linkText.trim() || linkValue.trim()
    if (selText && text === selText.trim()) {
      // Unchanged selection → just apply the link mark, keeping bold/italic/etc.
      editor.chain().focus().setLink({ href }).run()
    } else {
      editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] })
        .run()
    }
    closeLink()
  }

  // Ctrl/Cmd+F opens the find bar (without triggering the browser's native find).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        setFindOpen(true)
      }
    }
    const dom = editor.view.dom
    dom.addEventListener('keydown', onKeyDown)
    return () => dom.removeEventListener('keydown', onKeyDown)
  }, [editor])

  return (
    <div className="octo-toolbar-wrap">
    <div className="octo-toolbar">
      <BlockTypeSelect editor={editor} />
      <span className="octo-tb-sep" />
      <Btn label="B" title={t('docs.toolbar.bold')} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
      <Btn label="I" title={t('docs.toolbar.italic')} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <Btn label={<IconUnderline />} title={t('docs.toolbar.underline')} active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} />
      <Btn label={<IconStrike />} title={t('docs.toolbar.strike')} active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} />
      <Btn label="x²" title={t('docs.toolbar.superscript')} active={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()} />
      <Btn label="x₂" title={t('docs.toolbar.subscript')} active={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()} />
      <FontSizeSelect editor={editor} />
      <span className="octo-tb-sep" />
      <AlignControls editor={editor} />
      <span className="octo-tb-sep" />
      <Btn label="• List" title={t('docs.toolbar.bulletList')} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <Btn label="1. List" title={t('docs.toolbar.orderedList')} active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
      <Btn label="Todo" title={t('docs.toolbar.taskList')} active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()} />
      <Btn label="Quote" title={t('docs.toolbar.quote')} active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
      <Btn label="Code" title={t('docs.toolbar.codeBlock')} active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
      <Btn label="—" title={t('docs.toolbar.divider')} onClick={() => editor.chain().focus().setHorizontalRule().run()} />
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
      <Btn label="File" title={t('docs.toolbar.file')} onClick={() => void pickAndUploadFile(editor)} />
      <Btn label="Bookmark" title={t('docs.toolbar.bookmark')} onClick={() => void promptAndInsertBookmark(editor)} />
      <span className="octo-tb-sep" />
      <EmojiControl editor={editor} />
      <Btn label="@" title={t('docs.toolbar.mention')} onClick={() => editor.chain().focus().insertContent('@').run()} />
      <Btn
        label="▸"
        title={t('docs.toolbar.details')}
        active={editor.isActive('details')}
        onClick={() => editor.chain().focus().setDetails().run()}
      />
      <CalloutControl editor={editor} />
      <MathControl editor={editor} kind="inline" />
      <MathControl editor={editor} kind="block" />
      <span className="octo-tb-sep" />
      <Btn label="Link" title={t('docs.toolbar.link')} active={editor.isActive('link')} onClick={openLink} />
      {linkOpen && (
        <span className="octo-link-input octo-link-popover">
          <input
            value={linkText}
            onChange={(e) => setLinkText(e.target.value)}
            placeholder={t('docs.toolbar.linkText')}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                confirmLink()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                closeLink()
              }
            }}
          />
          <input
            value={linkValue}
            autoFocus
            onChange={(e) => setLinkValue(e.target.value)}
            placeholder={t('docs.toolbar.linkPlaceholder')}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                confirmLink()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                closeLink()
              }
            }}
          />
          <Btn label={t('docs.toolbar.linkSet')} onClick={confirmLink} />
        </span>
      )}
      <span className="octo-tb-sep" />
      <Btn
        label="Tx"
        title={t('docs.toolbar.clearFormat')}
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
      />
      <Btn
        label="🔍"
        title={t('docs.toolbar.find')}
        active={findOpen}
        onClick={() => setFindOpen((v) => !v)}
      />
      <span className="octo-tb-spacer" />
      <Btn label="Undo" title={t('docs.toolbar.undo')} onClick={() => editor.chain().focus().undo().run()} />
      <Btn label="Redo" title={t('docs.toolbar.redo')} onClick={() => editor.chain().focus().redo().run()} />
    </div>
    {findOpen && <FindBar editor={editor} onClose={() => setFindOpen(false)} />}
    </div>
  )
}
