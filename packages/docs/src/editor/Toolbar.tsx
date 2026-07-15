import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode, UIEvent } from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import { CellSelection } from '@tiptap/pm/tables'
import type { Editor } from '@tiptap/core'
import { pickAndUploadImage } from './imageUpload.ts'
import { pickAndUploadFile } from './fileUpload.ts'
import { promptAndInsertBookmark } from './bookmarkInsert.ts'
import { getFindState, revealMatchInView, expandAncestorDetails, type FindReplaceState } from './findReplace.ts'
import { pickerEmojis } from './emoji.ts'
import { promptAndInsertMath } from './mathInsert.ts'
import { sanitizeLinkHref } from './sanitize.ts'
import { CALLOUT_VARIANTS, type CalloutVariant } from './Callout.ts'
import { INDENT_MAX_LEVEL } from './ParagraphIndent.ts'
import { TableGridPicker } from './TableControls.tsx'
import { capturePaintMarks, applyPaintMarks } from './formatPainter.ts'
import { HIGHLIGHT_COLORS, TEXT_COLORS, normalizeHexColor } from './colorPalette.ts'
import { t } from '../octoweb/index.ts'
import { FONT_FAMILY_ENABLED, LINE_SPACING_ENABLED } from '../config.ts'
import { FONT_FAMILIES } from './fontFamilies.ts'
import type { Mark } from '@tiptap/pm/model'

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
// Indent buttons (SCHEMA_VERSION 18): lines with a right/left chevron marking the indent direction.
const IconIndentIncrease = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 5h18v2H3V5zm8 4h10v2H11V9zm0 4h10v2H11v-2zm-8 4h18v2H3v-2zm.4-8.8L7 12l-3.6 2.8V6.2z" />
  </svg>
)
const IconIndentDecrease = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 5h18v2H3V5zm8 4h10v2H11V9zm0 4h10v2H11v-2zm-8 4h18v2H3v-2zM6.6 6.2v7.6L3 11l3.6-2.8z" />
  </svg>
)

// Toolbar item ⑧ (batch 7): list group + quote/code as icon buttons, link as a chain icon.
// 16×16, fill: currentColor via .octo-tb-icon.
const IconList = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 6.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zm0 5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zm0 5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zM9 7h11v2H9V7zm0 5h11v2H9v-2zm0 5h11v2H9v-2z" />
  </svg>
)
const IconBulletList = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 6.5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zm0 5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zm0 5a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zM9 7h11v2H9V7zm0 5h11v2H9v-2zm0 5h11v2H9v-2z" />
  </svg>
)
const IconOrderedList = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 7h11v2H9V7zm0 5h11v2H9v-2zm0 5h11v2H9v-2zM3.5 5.5h1.6v4.1h-1V6.4h-.6v-.9zm.1 6.2h1.9v.85L4.3 14.4h1.3v.9H3.4v-.85l1.2-1.85H3.6v-.9zm-.1 5.1h2v.85H4.6v.55h.9v.8h-.9v.55h.95v.85H3.5v-4.05z" />
  </svg>
)
const IconTaskList = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M10 7h10v2H10V7zm0 8h10v2H10v-2zM3.3 8.1l1.2 1.2 2.4-2.4-.85-.85L4.5 7.6l-.35-.35-.85.85zm0 8l1.2 1.2 2.4-2.4-.85-.85-1.55 1.55-.35-.35-.85.85z" />
  </svg>
)
const IconQuote = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7.2 7C5.4 7 4 8.4 4 10.2c0 1.7 1.3 3 3 3 .2 0 .4 0 .6-.1-.4 1.2-1.5 2.2-3 2.6l.6 1.3c2.7-.7 4.5-2.9 4.5-5.9V10.2C9.7 8.4 8.4 7 7.2 7zm9 0C14.4 7 13 8.4 13 10.2c0 1.7 1.3 3 3 3 .2 0 .4 0 .6-.1-.4 1.2-1.5 2.2-3 2.6l.6 1.3c2.7-.7 4.5-2.9 4.5-5.9V10.2C18.7 8.4 17.4 7 16.2 7z" />
  </svg>
)
// codeBlock: a literal `</>` — left chevron, a centered forward slash, right chevron
// (boss reference). Filled glyph via .octo-tb-icon to match the other toolbar icons.
const IconCode = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8.7 17.3 3.4 12l5.3-5.3 1.3 1.4L5.9 12l4.1 4.1-1.3 1.2zm6.6 0L14 16.1l4.1-4.1-4.1-4.1 1.3-1.4L20.6 12l-5.3 5.3zM13.9 5.2l1.9.5-3.9 13.1-1.9-.5 3.9-13.1z" />
  </svg>
)
// Link (XIN-1051): the standard chain-link glyph (lucide `link`) — two diagonal, interlocking
// hooked curves. Stroke line-art, not filled: uses .octo-tb-icon-stroke (fill:none;
// stroke:currentColor) with round caps/joins so it reads as a recognizable link icon at 16px
// rather than the old two-capsule filled blob. Aligned with IconUnlink below.
const IconLink = () => (
  <svg
    className="octo-tb-icon-stroke"
    viewBox="0 0 24 24"
    aria-hidden="true"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
)
// Unlink (XIN-1051): the same chain pulled apart (lucide `unlink`) — the two hooked curves with a
// break plus the four short "snap" ticks. Same stroke style as IconLink so the pair reads as a set.
const IconUnlink = () => (
  <svg
    className="octo-tb-icon-stroke"
    viewBox="0 0 24 24"
    aria-hidden="true"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" />
    <path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" />
    <line x1="8" x2="8" y1="2" y2="5" />
    <line x1="2" x2="5" y1="8" y2="8" />
    <line x1="16" x2="16" y1="19" y2="22" />
    <line x1="19" x2="22" y1="16" y2="16" />
  </svg>
)

// Clear-format: a tilted eraser/rubber sweeping over a baseline (boss reference). Filled glyph
// via .octo-tb-icon to match the other toolbar icons.
const IconEraser = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M15.1 3.7 21.4 10a2 2 0 0 1 0 2.8l-7 7H17v1.7h-7.4a2 2 0 0 1-1.4-.6L3.7 16.6a2 2 0 0 1 0-2.8l8.6-8.6a2 2 0 0 1 2.8 0zM8.3 14.2l-3.2 3.2 2.9 2.9h1.7l2.8-2.8-4.2-3.3z" />
  </svg>
)

// Format painter (XIN-963): a paint-roller glyph — the classic "copy formatting" affordance used
// by Word / Feishu / Google Docs. Filled via .octo-tb-icon to match the other toolbar icons.
const IconFormatPainter = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 4h13a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm14 3h1.5a1.5 1.5 0 0 1 1.5 1.5V12a1 1 0 0 1-1 1h-6a1 1 0 0 0-1 1v1.2a2 2 0 0 1 1 1.8v4a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-4a2 2 0 0 1 1-1.8V14a3 3 0 0 1 3-3h5V9h-1V7z" />
  </svg>
)

// Undo / redo: stroke-style curved-arrow glyphs (boss reference). NOT filled — they use
// .octo-tb-icon-stroke (fill:none; stroke:currentColor) so they inherit the light-grey
// #AAAAAA from the .octo-tb-undoredo wrapper. Redo is the horizontal mirror of Undo.
const IconUndo = () => (
  <svg className="octo-tb-icon-stroke" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-1"
    />
  </svg>
)
const IconRedo = () => (
  <svg className="octo-tb-icon-stroke" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h1"
    />
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

/**
 * Like useEditorTick but also re-renders when the value returned by `read(editor)` changes —
 * not only when the selection moves. A setLineHeight / setSpaceBefore transaction rewrites a
 * block attribute while leaving the caret put, so the selection-keyed snapshot of useEditorTick
 * does NOT change and React skips the re-render; a controlled <select> is then restored to its
 * stale `value` prop, so the dropdown kept showing the old label after a value was picked
 * (line-spacing display desync, XIN-1039 #1). Keying the snapshot off the displayed value itself
 * makes the control re-render exactly when that value changes — the same fix shape as useFindState
 * below. Returns the freshly read value so the caller renders from it directly.
 */
function useEditorValueTick(editor: Editor, read: (editor: Editor) => string): string {
  useSyncExternalStore(
    (cb) => {
      editor.on('transaction', cb)
      editor.on('selectionUpdate', cb)
      return () => {
        editor.off('transaction', cb)
        editor.off('selectionUpdate', cb)
      }
    },
    () => `${editor.state.selection.from}:${editor.state.selection.to}:${read(editor)}`,
  )
  return read(editor)
}

/**
 * Subscribe a component to the find/replace plugin state, returning the live FindReplaceState.
 *
 * The plain useEditorTick snapshot keys only off the selection (from:to), so a setFindQuery
 * transaction — which updates the find plugin's matches/index but leaves the caret put — does NOT
 * change that snapshot and React skips the re-render. That left the match counter (.octo-find-count)
 * stale: it showed "no results" with matches highlighted, or kept the previous search's "X / Y"
 * after the query changed (batch-7 regression). Keying the snapshot off the find state's identity
 * (query + case flag + match count + current index) makes the counter re-render exactly when the
 * matches/index actually change; the component then reads the fresh state via getFindState.
 */
function useFindState(editor: Editor): FindReplaceState {
  useSyncExternalStore(
    (cb) => {
      editor.on('transaction', cb)
      return () => {
        editor.off('transaction', cb)
      }
    },
    () => {
      const fs = getFindState(editor.state)
      return `${fs.query}\u0000${fs.caseSensitive ? 1 : 0}\u0000${fs.matches.length}\u0000${fs.index}`
    },
  )
  return getFindState(editor.state)
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
      shouldShow={({ editor: e, from, to }) =>
        from !== to && e.isEditable && !(e.state.selection instanceof CellSelection)
      }
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

// The highlight (text-background) and font-colour presets are DERIVED from one shared hue base
// (PALETTE_HUES) in ./colorPalette.ts: TEXT_COLORS are the saturated hues, HIGHLIGHT_COLORS are the
// same hues at the same index tinted light so dark text stays readable on top. Same count, same hue
// order, same column ↦ same colour family across both pickers. Values stay #rrggbb so they survive
// Yjs collaboration and the DOCX/Markdown exporters losslessly.

/**
 * Inline hex entry shared by the font-colour and highlight popovers. It complements the preset
 * swatches and the native OS wheel (<input type="color">) with an OS-independent way to type or paste
 * an arbitrary #rrggbb — the "hex 输入" path in #719 — so a user can enter a brand hex directly instead
 * of hunting for it in the platform colour dialog. It commits ONCE, on Enter, and only when the value
 * parses to a valid 3-/6-digit hex (normalizeHexColor): one entry is one ProseMirror transaction, i.e.
 * one undo record and one Yjs update, the same commit-once discipline the native picker uses. Invalid
 * input is flagged via aria-invalid and never reaches the document; an empty value is a no-op. Typing
 * into the field blurs the editor but ProseMirror keeps the last selection, and the parent's onCommit
 * re-focuses via editor.chain().focus() before applying — the same idiom the link popover relies on.
 */
function HexColorInput({ onCommit }: { onCommit: (hex: string) => void }) {
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)
  return (
    <input
      type="text"
      className={`octo-color-hex${invalid ? ' octo-color-hex-invalid' : ''}`}
      placeholder={t('docs.toolbar.hexPlaceholder')}
      aria-label={t('docs.toolbar.hexInput')}
      aria-invalid={invalid || undefined}
      value={value}
      spellCheck={false}
      // No maxLength on the raw input: normalizeHexColor trims and sanitises on Enter, so a paste
      // that carries leading/trailing whitespace (e.g. " #1971c2") must not be clipped to 7 chars
      // before it is trimmed — that would wrongly reject an otherwise valid hex. Bad input is still
      // caught (and flagged via aria-invalid) by the parse, never by a length cap on the raw value.
      onChange={(e) => {
        setValue(e.target.value)
        if (invalid) setInvalid(false)
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return
        e.preventDefault()
        const raw = value.trim()
        if (raw === '') return
        const hex = normalizeHexColor(raw)
        if (!hex) {
          setInvalid(true)
          return
        }
        onCommit(hex)
      }}
    />
  )
}

/** Text-highlight control (SCHEMA-SPEC §3): palette of background colours + clear. */
function HighlightControl({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  // Native <input type="color"> distinguishes drag from commit only at the DOM level: `input`
  // streams while the hue wheel moves, `change` fires once the pick is committed. React folds
  // both onto its synthetic onChange (native `input`), so we bind the raw `change` event via a ref.
  // RC1: commit the highlight once, on `change` only — never on the `input` stream. Applying per
  // `input` tick ran one ProseMirror transaction each, so a single pick piled up dozens of undo
  // records and flooded collaborators with a Yjs update per intermediate hue. The OS colour dialog
  // previews the hue live in its own UI while dragging, so committing on `change` keeps one pick =
  // one undo record + one Yjs update, and the popover collapses on commit like a preset swatch.
  const customRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const input = customRef.current
    if (!input) return
    const onCommit = () => {
      editor.chain().focus().setHighlight({ color: input.value }).run()
      setOpen(false)
    }
    input.addEventListener('change', onCommit)
    return () => {
      input.removeEventListener('change', onCommit)
    }
  }, [editor, open])
  return (
    <span className="octo-color-control">
      <Btn
        label="🖍"
        title={t('docs.toolbar.highlight')}
        active={open}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <span className="octo-color-popover octo-highlight-color-popover">
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
              // Clear the highlight the caret sits in. unsetHighlight() alone only clears a
              // non-empty selection range — with a collapsed caret inside a highlight (the common
              // "click into highlighted text, then hit ✕" flow) it clears stored marks only and
              // leaves the surrounding <mark> in the document. extendMarkRange('highlight') first
              // grows the selection to span the whole highlight under the caret (a no-op when a
              // range is already selected), so unsetHighlight() reliably removes the mark. Same
              // idiom TipTap uses for link clearing (extendMarkRange('link').unsetLink()).
              editor.chain().focus().extendMarkRange('highlight').unsetHighlight().run()
              setOpen(false)
            }}
          />
          {/* Custom highlight (same approach as the text-colour picker): native picker, zero new
              deps. It emits standard #rrggbb, so setHighlight stays lossless through Yjs and the
              DOCX/Markdown exporters. The picker stays open while dragging the hue wheel and
              commits once on `change`, collapsing the popover — see the ref-bound listener above. */}
          <label
            className="octo-swatch octo-color-custom"
            title={t('docs.toolbar.customColor')}
            onMouseDown={(e) => e.preventDefault()}
          >
            <input
              ref={customRef}
              type="color"
              className="octo-color-custom-input"
              aria-label={t('docs.toolbar.customColor')}
            />
          </label>
          <HexColorInput
            onCommit={(hex) => {
              // setHighlight (not toggleHighlight): the hex field is an explicit "apply this
              // colour" action like the native picker above (Toolbar's setHighlight at the custom
              // <input type="color"> commit). toggleHighlight would REMOVE the highlight when the
              // selection already carries the same colour, so re-entering an identical hex must
              // still leave it applied, not clear it.
              editor.chain().focus().setHighlight({ color: hex }).run()
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
  // Native <input type="color"> distinguishes drag from commit only at the DOM level: `input`
  // streams while the hue wheel moves, `change` fires once the pick is committed. React folds
  // both onto its synthetic onChange (native `input`), so we bind the raw `change` event via a ref.
  // RC1: commit the colour once, on `change` only — never on the `input` stream. Applying per
  // `input` tick ran one ProseMirror transaction each, so a single pick piled up dozens of undo
  // records and flooded collaborators with a Yjs update per intermediate hue. The OS colour dialog
  // previews the hue live in its own UI while dragging, so committing on `change` keeps one pick =
  // one undo record + one Yjs update, and the popover collapses on commit like a preset swatch.
  const customRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const input = customRef.current
    if (!input) return
    const onCommit = () => {
      editor.chain().focus().setColor(input.value).run()
      setOpen(false)
    }
    input.addEventListener('change', onCommit)
    return () => {
      input.removeEventListener('change', onCommit)
    }
  }, [editor, open])
  return (
    <span className="octo-color-control">
      <Btn label="A̲" title={t('docs.toolbar.textColor')} active={open} onClick={() => setOpen((v) => !v)} />
      {open && (
        <span className="octo-color-popover octo-text-color-popover">
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
          {/* Custom colour (plan A): native picker, zero new deps. It emits standard #rrggbb,
              so setColor stays lossless through Yjs and the DOCX/Markdown exporters. The picker
              stays open while dragging the hue wheel and commits once on `change`, collapsing the
              popover — see the ref-bound listener above. */}
          <label
            className="octo-swatch octo-color-custom"
            title={t('docs.toolbar.customColor')}
            onMouseDown={(e) => e.preventDefault()}
          >
            <input
              ref={customRef}
              type="color"
              className="octo-color-custom-input"
              aria-label={t('docs.toolbar.customColor')}
            />
          </label>
          <HexColorInput
            onCommit={(hex) => {
              editor.chain().focus().setColor(hex).run()
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

/** Full curated emoji set for the toolbar picker grid — real glyphs, regional indicators excluded
 * (D1). The picker windows + scrolls these rather than capping at a fixed count (item 5). */
const EMOJI_PICKER = pickerEmojis()
/** Emoji rendered on first open and grown by this much each time the grid is scrolled near the
 * bottom — keeps the initial DOM small (no ~1900-node eager render) while the full set stays
 * reachable by scrolling or the search box. */
const EMOJI_WINDOW = 120

/**
 * List dropdown (toolbar item ⑧, batch 7): a single list icon button that opens a menu with
 * Bullet / Ordered / Task list options (icon + label each). Replaces the three former standalone
 * list buttons. The trigger is active when the caret is in any list; each item toggles its list
 * type. Modeled on the highlight/colour popover (relative wrapper + absolute menu) so it floats
 * over content instead of widening the toolbar. Closes on outside-click / Escape / selection.
 */
const LIST_ITEMS = [
  { key: 'bulletList', icon: <IconBulletList />, isActive: 'bulletList' },
  { key: 'orderedList', icon: <IconOrderedList />, isActive: 'orderedList' },
  { key: 'taskList', icon: <IconTaskList />, isActive: 'taskList' },
] as const

/** Toggle the chosen list type on the editor (data-driven over the three fixed list kinds). */
function toggleList(editor: Editor, key: (typeof LIST_ITEMS)[number]['key']): void {
  const chain = editor.chain().focus()
  if (key === 'bulletList') chain.toggleBulletList().run()
  else if (key === 'orderedList') chain.toggleOrderedList().run()
  else chain.toggleTaskList().run()
}

function ListMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const anyListActive = LIST_ITEMS.some((it) => editor.isActive(it.isActive))

  // Close on outside-click / Escape so the floating menu doesn't linger.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span className="octo-color-control octo-list-control" ref={ref}>
      <Btn
        label={<IconList />}
        title={t('docs.toolbar.list')}
        active={anyListActive || open}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <span className="octo-color-popover octo-list-menu" role="menu">
          {LIST_ITEMS.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className={
                'octo-list-menu-item' + (editor.isActive(it.isActive) ? ' is-active' : '')
              }
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                toggleList(editor, it.key)
                setOpen(false)
              }}
            >
              <span className="octo-list-menu-icon">{it.icon}</span>
              <span className="octo-list-menu-label">{t(`docs.toolbar.${it.key}`)}</span>
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

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

/**
 * Font-family dropdown (SCHEMA_VERSION 16): sets the textStyle `fontFamily` attr, or clears it.
 * Mirrors FontSizeSelect. Rendered ONLY when FONT_FAMILY_ENABLED is on (feature flag, default
 * off) — the caller gates it, so when off the selector is absent from the DOM entirely and the
 * user cannot set a font (see config.ts for the phased-rollout rationale).
 */
function FontFamilySelect({ editor }: { editor: Editor }) {
  useEditorTick(editor)
  const current = (editor.getAttributes('textStyle').fontFamily as string) || ''
  return (
    <select
      className="octo-font-family"
      title={t('docs.toolbar.fontFamily')}
      value={current}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const v = e.target.value
        if (!v) editor.chain().focus().unsetFontFamily().run()
        else editor.chain().focus().setFontFamily(v).run()
      }}
    >
      <option value="">{t('docs.toolbar.fontFamilyDefault')}</option>
      {FONT_FAMILIES.map((f) => (
        <option key={f.labelKey} value={f.value} style={{ fontFamily: f.value }}>
          {t(f.labelKey)}
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

/** Line-height presets (unitless multiplier) offered by the toolbar dropdown (SCHEMA_VERSION 17). */
const LINE_HEIGHTS = ['1', '1.15', '1.5', '2'] as const

/** Read the active line-height off whichever of the two block types the caret sits in. */
function currentLineHeight(editor: Editor): string {
  return (
    (editor.getAttributes('paragraph').lineHeight as string | undefined) ??
    (editor.getAttributes('heading').lineHeight as string | undefined) ??
    ''
  )
}

/**
 * Custom line-height input (SCHEMA_VERSION 17).
 *
 * The field is a COMMIT-on-blur/Enter control, not a live-preview one — the earlier controlled
 * input re-`.focus()`-ed the editor on every keystroke (bouncing the caret out of this field so
 * only the first character landed) and, being bound to the sanitised committed value, snapped an
 * in-progress entry like "1." back to empty because a partial value fails sanitizeLineHeight. So
 * instead we keep a local draft: typing only updates the draft (no editor focus, no snap-back),
 * and the value is pushed to the editor once, on blur or Enter. An invalid draft on commit is
 * reverted to the last committed value rather than written.
 */
function LineHeightCustomInput({ editor, autoFocus = false }: { editor: Editor; autoFocus?: boolean }) {
  const committed = currentLineHeight(editor)
  const [draft, setDraft] = useState(committed)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the field the moment it is revealed by picking "custom" from the dropdown, so the user
  // can type a multiplier straight away. Only on mount, and only when the reveal was an explicit
  // pick — never when the field appears because the caret entered a block that already carries a
  // custom value (stealing focus there would yank the caret out of the document mid-navigation).
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Adopt the committed value into the draft when it changes underneath us (caret moved to
  // another block, a preset was picked, or our own commit landed) — done as a render-phase
  // adjustment keyed off the last-seen committed value rather than a useEffect, so it happens
  // synchronously and never clobbers a fresh keystroke that arrives in the same flush. Typing
  // does NOT change `committed`, so an in-progress value like "1." is free to sit in the field
  // without being reset (the old snap-back), and nothing commits until blur/Enter.
  const seenCommitted = useRef(committed)
  if (committed !== seenCommitted.current) {
    seenCommitted.current = committed
    setDraft(committed)
  }

  // Commit the draft to the editor. Runs on blur and Enter only — never per keystroke, so the
  // caret is never yanked back into the editor mid-type. A value rejected by sanitizeLineHeight
  // is reverted to the last committed value rather than written.
  function commit() {
    const v = draft.trim()
    if (v === committed) return
    if (!v) {
      editor.chain().focus().unsetLineHeight().run()
      seenCommitted.current = ''
      return
    }
    if (editor.chain().focus().setLineHeight(v).run()) {
      // We wrote this value ourselves — record it so the next render doesn't mistake our own
      // commit for an external change and reseed over a fresh keystroke. (The toolbar doesn't
      // re-render on attribute-only transactions, so the editor's new value is first observed on
      // the following render, which may already carry the user's next keystroke.)
      seenCommitted.current = v
    } else {
      setDraft(committed)
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      className="octo-line-height-custom"
      title={t('docs.toolbar.lineHeightCustom')}
      placeholder="1.5"
      value={draft}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
      }}
    />
  )
}

/**
 * Line-spacing dropdown (SCHEMA_VERSION 17): sets the `lineHeight` attr on the current
 * heading/paragraph block (or clears it). The presets cover the common multipliers; a custom
 * multiplier is entered in a number input that appears ONLY while "custom" is the active option —
 * either because the caret sits in a block already carrying a non-preset value, or because the
 * user just picked "custom" from the dropdown. Any preset/default selection hides the input, and
 * because it is conditionally rendered (not merely hidden) it takes up no layout space when absent.
 * Reads the current value from whichever of the two block types is active, so the control reflects
 * the caret's block.
 */
function LineHeightSelect({ editor }: { editor: Editor }) {
  const current = useEditorValueTick(editor, currentLineHeight)
  const isPreset = (LINE_HEIGHTS as readonly string[]).includes(current)
  // A non-preset, non-empty value (e.g. a pasted 1.3, or one typed via the input) already means
  // the block is on a custom multiplier — the input must show and seed from it (#1 display sync).
  const hasCustomValue = !isPreset && current !== ''

  // "Custom" is also a sticky UI mode: picking it from the dropdown reveals the input even before a
  // value is typed (nothing is written to the block until a multiplier is committed). The mode is
  // dropped as soon as the caret moves to another block, so the input never lingers over a
  // preset/default block after navigation.
  const [customPicked, setCustomPicked] = useState(false)
  const seenFrom = useRef(editor.state.selection.from)
  if (editor.state.selection.from !== seenFrom.current) {
    seenFrom.current = editor.state.selection.from
    if (customPicked) setCustomPicked(false)
  }

  const showCustom = hasCustomValue || customPicked
  return (
    <span className="octo-line-height-control">
      <select
        className="octo-line-height"
        title={t('docs.toolbar.lineHeight')}
        value={showCustom ? 'custom' : isPreset ? current : ''}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'custom') {
            // Reveal the custom input; the block value stays untouched until a multiplier is
            // committed via the input.
            setCustomPicked(true)
            return
          }
          setCustomPicked(false)
          if (!v) editor.chain().focus().unsetLineHeight().run()
          else editor.chain().focus().setLineHeight(v).run()
        }}
      >
        <option value="">{t('docs.toolbar.lineHeightDefault')}</option>
        {LINE_HEIGHTS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
        <option value="custom">{t('docs.toolbar.lineHeightCustom')}</option>
      </select>
      {showCustom && <LineHeightCustomInput editor={editor} autoFocus={customPicked} />}
    </span>
  )
}

/** Paragraph-spacing presets (px) offered by the space-before / space-after dropdowns (v17). */
const PARAGRAPH_SPACINGS = ['0px', '4px', '8px', '12px', '16px', '24px'] as const

/**
 * Paragraph space-before / space-after dropdown (SCHEMA_VERSION 17). The schema, commands
 * (setSpaceBefore/setSpaceAfter), docx export and i18n already carry these block-margin attrs;
 * this exposes them in the toolbar so a user can set them (previously they only round-tripped
 * from pasted content). One data-driven component per edge — `before` drives margin-top, `after`
 * margin-bottom — sitting in the same line-spacing control group. A value off the preset list
 * (e.g. an em length pasted in) still shows as "Custom" so it isn't silently reset.
 */
function ParagraphSpacingSelect({ editor, edge }: { editor: Editor; edge: 'before' | 'after' }) {
  const attr = edge === 'before' ? 'spaceBefore' : 'spaceAfter'
  const current = useEditorValueTick(
    editor,
    (e) =>
      (e.getAttributes('paragraph')[attr] as string | undefined) ??
      (e.getAttributes('heading')[attr] as string | undefined) ??
      '',
  )
  const isPreset = (PARAGRAPH_SPACINGS as readonly string[]).includes(current)
  const titleKey = edge === 'before' ? 'docs.toolbar.spaceBefore' : 'docs.toolbar.spaceAfter'
  return (
    <select
      className={edge === 'before' ? 'octo-space-before' : 'octo-space-after'}
      title={t(titleKey)}
      value={isPreset ? current : current ? 'custom' : ''}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const v = e.target.value
        if (v === 'custom') return // a non-preset pasted value stays as-is
        const chain = editor.chain().focus()
        if (edge === 'before') {
          if (!v) chain.unsetSpaceBefore().run()
          else chain.setSpaceBefore(v).run()
        } else {
          if (!v) chain.unsetSpaceAfter().run()
          else chain.setSpaceAfter(v).run()
        }
      }}
    >
      <option value="">{t(titleKey)}</option>
      {PARAGRAPH_SPACINGS.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
      {!isPreset && current ? <option value="custom">{t('docs.toolbar.spacingCustom')}</option> : null}
    </select>
  )
}

/** Current indent level at the selection (max of the active paragraph / heading), tracked so the
 * indent buttons re-render whenever it changes.
 *
 * useEditorTick keys its re-render snapshot only off the selection (from:to), but increaseIndent /
 * decreaseIndent rewrite a node ATTRIBUTE and leave the caret put — so a selection-only
 * subscription leaves the decrease button's disabled state stale: it stayed greyed after an
 * increase (the level went 0→1 but the button never re-enabled) and stayed lit after a
 * decrease-to-0. Keying the snapshot off the level itself — the same fix useFindState applies for
 * the find counter — re-renders the buttons exactly when the indent level actually changes. */
function useIndentLevel(editor: Editor): number {
  return useSyncExternalStore(
    (cb) => {
      editor.on('transaction', cb)
      editor.on('selectionUpdate', cb)
      return () => {
        editor.off('transaction', cb)
        editor.off('selectionUpdate', cb)
      }
    },
    () =>
      Math.max(
        Number(editor.getAttributes('paragraph').indent) || 0,
        Number(editor.getAttributes('heading').indent) || 0,
      ),
  )
}

/** Indent buttons (SCHEMA_VERSION 18): increase / decrease indent on the active heading + paragraph.
 * List items keep their own Tab/Shift-Tab sink/lift behavior (owned by the list extensions). Both
 * buttons key their disabled state off the current selection's indent level (useIndentLevel) so
 * they mirror the command boundaries and re-render as the level changes: decrease is disabled at 0
 * (nothing left to un-indent) and increase is disabled at INDENT_MAX_LEVEL (the clamp ceiling), so
 * each boundary is visible as well as a command no-op — symmetric in both directions. */
function IndentControls({ editor }: { editor: Editor }) {
  const current = useIndentLevel(editor)
  return (
    <>
      <Btn
        label={<IconIndentDecrease />}
        title={t('docs.toolbar.indentDecrease')}
        disabled={current <= 0}
        onClick={() => editor.chain().focus().decreaseIndent().run()}
      />
      <Btn
        label={<IconIndentIncrease />}
        title={t('docs.toolbar.indentIncrease')}
        disabled={current >= INDENT_MAX_LEVEL}
        onClick={() => editor.chain().focus().increaseIndent().run()}
      />
    </>
  )
}

/** Emoji picker (SCHEMA_VERSION 9): a scrollable grid that inserts via the emoji node's setEmoji.
 * Search filters the full curated set; the grid renders an initial window and grows on scroll so
 * the ~1900-glyph set never mounts eagerly. */
function EmojiControl({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(EMOJI_WINDOW)

  // Match name + shortcodes over the curated set (regional indicators already excluded).
  const list = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return EMOJI_PICKER
    return EMOJI_PICKER.filter((e) => e.name.includes(q) || e.shortcodes.some((s) => s.includes(q)))
  }, [query])

  // Reset the window whenever the panel opens or the query changes.
  useEffect(() => {
    setVisible(EMOJI_WINDOW)
  }, [open, query])

  const shown = list.slice(0, visible)

  function onScroll(e: UIEvent<HTMLSpanElement>) {
    const el = e.currentTarget
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
      setVisible((v) => (v < list.length ? v + EMOJI_WINDOW : v))
    }
  }

  return (
    <span className="octo-color-control">
      <Btn label="😀" title={t('docs.toolbar.emoji')} active={open} onClick={() => setOpen((v) => !v)} />
      {open && (
        <span className="octo-emoji-popover">
          <input
            className="octo-emoji-search"
            placeholder={t('docs.toolbar.emojiSearch')}
            value={query}
            autoFocus
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="octo-emoji-grid" onScroll={onScroll}>
            {shown.map((e) => (
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
 * Reveal a find match at document position `pos`: first expand any collapsed (possibly nested)
 * details that hide it, then scroll it into view centered below the sticky toolbar.
 *
 * Opening a fold changes document height/layout, so when it expands we wait an extra frame before
 * measuring coordsAtPos (stale pre-expand coords would scroll to the wrong place — the original
 * "counter moved but nothing on screen" symptom). When nothing was folded, a single frame is
 * enough for the just-dispatched selection/decoration to commit.
 */
function revealToMatch(editor: Editor, pos: number) {
  const opened = expandAncestorDetails(editor.state, editor.view?.dispatch, pos)
  const doScroll = () => {
    const cur = getFindState(editor.state)
    const target = cur.matches[cur.index]
    revealMatchInView(editor.view, target ? target.from : pos)
  }
  if (opened) {
    // Two frames: one for the open attr + NodeView to show the content, one for layout to settle
    // so coordsAtPos reflects the expanded height.
    requestAnimationFrame(() => requestAnimationFrame(doScroll))
  } else {
    requestAnimationFrame(doScroll)
  }
}

/**
 * Find & replace bar (toolbar item ⑪). Drives the FindReplace extension: typing sets the search
 * term (live match highlight via decorations), prev/next walk matches, replace acts on the current
 * match, replace-all on all. Esc closes; the search is cleared on unmount so no stray highlights
 * linger.
 */
function FindBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const fs = useFindState(editor)
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
      if (m) revealToMatch(editor, m.from)
    })
  }, [editor, query, caseSensitive])

  // Clear the search (and its decorations) when the bar unmounts.
  useEffect(() => () => editor.commands.clearFind() as unknown as void, [editor])

  const total = fs.matches.length
  const current = fs.index >= 0 ? fs.index + 1 : 0

  /** Select + scroll the editor to the current match so prev/next visibly move the caret. */
  function revealCurrent() {
    const f = getFindState(editor.state)
    const m = f.matches[f.index]
    if (!m) return
    // Move the caret onto the match (so the active decoration + selection agree), but do the
    // actual scrolling ourselves: ProseMirror's native scrollIntoView only clips the match to the
    // viewport edge, where our sticky toolbar then hides it.
    editor.chain().setTextSelection({ from: m.from, to: m.to }).run()
    revealToMatch(editor, m.from)
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
          <span className="octo-math-popover-title">
            {t(kind === 'inline' ? 'docs.toolbar.mathInline' : 'docs.toolbar.mathBlock')}
          </span>
          <span className="octo-math-popover-row">
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
  // Inline validation message for the URL field (empty / unsafe URL). `null` = no error.
  // XIN-1051: an empty or invalid URL must surface here instead of silently discarding the
  // popover (the old confirmLink closed on a falsy href, so a mistyped URL just vanished).
  const [linkError, setLinkError] = useState<string | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const linkRef = useRef<HTMLSpanElement>(null)
  // XIN-1051 focus isolation: refs to the two popover inputs so opening the popover can move
  // keyboard focus INTO the panel (URL field when a selection is being linked, text field for a
  // brand-new link). Without this the caret stays in the editor and Enter is handled by
  // ProseMirror — the link is lost and the keystroke lands as a newline in the body.
  const linkTextRef = useRef<HTMLInputElement>(null)
  const linkUrlRef = useRef<HTMLInputElement>(null)
  // Whether the popover was opened over a non-empty selection — decides the initial focus target.
  const linkHadSelectionRef = useRef(false)

  // Format painter (XIN-963): armed state holds the inline marks captured from the source
  // selection. `null` = disarmed. Clicking the button captures the current selection's marks and
  // arms; the next completed selection gesture in the editor paints them once, then disarms
  // (single-shot). A ref mirrors the state so the editor mouseup listener always reads the latest
  // value without re-subscribing on every arm/disarm.
  const [painterMarks, setPainterMarks] = useState<readonly Mark[] | null>(null)
  const painterMarksRef = useRef<readonly Mark[] | null>(null)
  painterMarksRef.current = painterMarks

  function toggleFormatPainter() {
    setPainterMarks((prev) => (prev ? null : capturePaintMarks(editor.state)))
  }

  // While armed, paint onto the target selection when the user finishes selecting it (mouseup).
  // Using mouseup — not selectionUpdate — avoids re-applying on every intermediate range during a
  // drag; the paint happens once, on the completed gesture, then the painter disarms.
  useEffect(() => {
    if (!painterMarks) return
    const dom = editor.view.dom
    // Coalescing window for multi-click gestures (XIN-1016). A double-click (select word) or
    // triple-click (select paragraph) fires 2–3 mouseups in quick succession; the FIRST beat lands
    // on a collapsed caret (empty selection) and only a later beat expands it to the word/paragraph.
    // Slightly larger than the platform double-click interval so the whole gesture is treated as
    // one target rather than acted on beat-by-beat.
    const MULTI_CLICK_MS = 300
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    const clearSettle = () => {
      if (settleTimer !== null) {
        clearTimeout(settleTimer)
        settleTimer = null
      }
    }
    // Act on the settled selection: paint a real target, disarm either way (single-shot).
    const settle = () => {
      settleTimer = null
      const marks = painterMarksRef.current
      if (!marks) return
      if (!editor.state.selection.empty) applyPaintMarks(editor, marks)
      setPainterMarks(null)
    }
    const onMouseUp = (detail: number) => {
      const marks = painterMarksRef.current
      if (!marks) return
      if (detail <= 1 && !editor.state.selection.empty) {
        // A drag-select: a single, deliberate gesture that already produced a range. No multi-click
        // beats are coming, so paint immediately and end the session.
        clearSettle()
        applyPaintMarks(editor, marks)
        setPainterMarks(null)
        return
      }
      // Otherwise the gesture is not yet settled: either an empty first beat / stray misclick
      // (detail 1, collapsed), or a multi-click beat (detail ≥ 2) whose selection a further beat may
      // still extend (double → triple). Debounce and act once on the final selection — a genuine
      // misclick settles empty and disarms without repainting (XIN-1000, XIN-981 unaffected), while
      // double/triple-click settles on the word/paragraph it selected and paints it (XIN-1016).
      clearSettle()
      settleTimer = setTimeout(settle, MULTI_CLICK_MS)
    }
    // Deferred to the next tick so ProseMirror has committed the selection for this mouseup. Read
    // `detail` (the running click count) synchronously — the event object is recycled after the
    // handler returns.
    const handler = (ev: MouseEvent) => {
      const { detail } = ev
      setTimeout(() => onMouseUp(detail), 0)
    }
    dom.addEventListener('mouseup', handler)
    return () => {
      clearSettle()
      dom.removeEventListener('mouseup', handler)
    }
  }, [editor, painterMarks])


  // C7: open the link popup, pre-filling the text from the current selection and the URL from any
  // link already under the cursor.
  function openLink() {
    setLinkOpen((v) => {
      const next = !v
      if (next) {
        const { from, to } = editor.state.selection
        const hasSelection = from !== to
        linkHadSelectionRef.current = hasSelection
        setLinkText(hasSelection ? editor.state.doc.textBetween(from, to, ' ') : '')
        setLinkValue((editor.getAttributes('link').href as string) || '')
        setLinkError(null)
      }
      return next
    })
  }

  function closeLink() {
    setLinkOpen(false)
    setLinkText('')
    setLinkValue('')
    setLinkError(null)
  }

  // XIN-1051 focus isolation: when the popover opens, pull keyboard focus into it so Enter/Escape
  // are handled by the input (see the per-input onKeyDown guards) and never fall through to the
  // editor's contenteditable. With a selection the text is already known, so focus the URL field;
  // for a brand-new link focus the text field first. Runs only on the open transition.
  useEffect(() => {
    if (!linkOpen) return
    const target = linkHadSelectionRef.current ? linkUrlRef.current : linkTextRef.current
    // Focus after paint so the input is mounted; select existing content for quick replace.
    const id = requestAnimationFrame(() => {
      target?.focus()
      target?.select()
    })
    return () => cancelAnimationFrame(id)
  }, [linkOpen])

  // XIN-1051 / XIN-1073: resolve the raw popover input into a safe, absolute href — or null when it
  // is not a usable link, so confirmLink can surface the inline error instead of inserting junk.
  //   - explicit scheme ("https://x", "mailto:a@b") / protocol-relative ("//cdn/x") → hand straight
  //     to sanitizeLinkHref so the §3.7 scheme whitelist still rejects javascript:/data:/ftp: etc.
  //   - scheme-less: a bare host/domain ("google.com") would resolve relative to the origin and
  //     become a same-origin path, so we prepend https:// — but ONLY when it actually looks like a
  //     host (a dotted label, or "localhost"). A bare word like "abc" is NOT a URL: without this
  //     guard https:// was blindly prepended and sanitizeLinkHref returned https://abc/, so the
  //     popover accepted the junk and closed with no error (the 4a real-machine defect). Such input
  //     now resolves to null → inline error, popover stays open, user's text is preserved.
  function resolveLinkHref(raw: string): string | null {
    const v = raw.trim()
    if (!v) return null
    if (v.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(v)) return sanitizeLinkHref(v)
    const host = v.split(/[/?#]/, 1)[0]
    const looksLikeHost = host === 'localhost' || /[^.\s]\.[^.\s]/.test(host)
    return looksLikeHost ? sanitizeLinkHref(`https://${v}`) : null
  }

  // C7: insert a link at the cursor (or apply it to the selection). With no selection a brand-new
  // linked label is inserted at the caret; with a selection whose text is unchanged the link is
  // applied to it (preserving any other marks); if the text was edited it replaces the selection.
  // sanitizeLinkHref enforces the scheme whitelist (§3.7). XIN-1051: an empty or unsafe URL no
  // longer silently closes the popover — it surfaces an inline error and keeps the user's input,
  // so a mistyped URL is never lost and a stray Enter can't discard the panel.
  function confirmLink() {
    const raw = linkValue.trim()
    if (!raw) {
      setLinkError(t('docs.toolbar.linkErrorEmpty'))
      linkUrlRef.current?.focus()
      return
    }
    const href = resolveLinkHref(raw)
    if (!href) {
      setLinkError(t('docs.toolbar.linkErrorInvalid'))
      linkUrlRef.current?.focus()
      return
    }
    setLinkError(null)
    const { from, to } = editor.state.selection
    const selText = from !== to ? editor.state.doc.textBetween(from, to, ' ') : ''
    const text = linkText.trim() || raw
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

  // Close the link popover on outside-click so the floating panel doesn't linger (Escape is
  // handled per-input). Mirrors the ListMenu close behaviour.
  useEffect(() => {
    if (!linkOpen) return
    const onDown = (e: MouseEvent) => {
      if (linkRef.current && !linkRef.current.contains(e.target as Node)) closeLink()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [linkOpen])

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
      {FONT_FAMILY_ENABLED && <FontFamilySelect editor={editor} />}
      <FontSizeSelect editor={editor} />
      <span className="octo-tb-sep" />
      <AlignControls editor={editor} />
      {LINE_SPACING_ENABLED && <LineHeightSelect editor={editor} />}
      {LINE_SPACING_ENABLED && <ParagraphSpacingSelect editor={editor} edge="before" />}
      {LINE_SPACING_ENABLED && <ParagraphSpacingSelect editor={editor} edge="after" />}
      <IndentControls editor={editor} />
      <span className="octo-tb-sep" />
      <ListMenu editor={editor} />
      <Btn label={<IconQuote />} title={t('docs.toolbar.quote')} active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
      <Btn label={<IconCode />} title={t('docs.toolbar.codeBlock')} active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
      <Btn label="—" title={t('docs.toolbar.divider')} onClick={() => editor.chain().focus().setHorizontalRule().run()} />
      <CodeLanguageSelect editor={editor} />
      <span className="octo-tb-sep" />
      <HighlightControl editor={editor} />
      <TextColorControl editor={editor} />
      <TableGridPicker editor={editor} />
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
      <span className="octo-color-control octo-link-control" ref={linkRef}>
        <Btn label={<IconLink />} title={t('docs.toolbar.link')} active={editor.isActive('link') || linkOpen} onClick={openLink} />
        {linkOpen && (
          <span className="octo-color-popover octo-link-popover" role="dialog">
            <input
              className="octo-link-field"
              ref={linkTextRef}
              value={linkText}
              onChange={(e) => setLinkText(e.target.value)}
              placeholder={t('docs.toolbar.linkText')}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.stopPropagation()
                  confirmLink()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  closeLink()
                }
              }}
            />
            <input
              className={'octo-link-field' + (linkError ? ' is-invalid' : '')}
              ref={linkUrlRef}
              value={linkValue}
              aria-invalid={linkError ? true : undefined}
              onChange={(e) => {
                setLinkValue(e.target.value)
                if (linkError) setLinkError(null)
              }}
              placeholder={t('docs.toolbar.linkPlaceholder')}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.stopPropagation()
                  confirmLink()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  e.stopPropagation()
                  closeLink()
                }
              }}
            />
            {linkError && (
              <span className="octo-link-error" role="alert">
                {linkError}
              </span>
            )}
            <div className="octo-link-popover-actions">
              <Btn label={t('docs.toolbar.linkSet')} onClick={confirmLink} />
            </div>
          </span>
        )}
      </span>
      <span className="octo-tb-sep" />
      <Btn
        label={<IconFormatPainter />}
        title={t('docs.toolbar.formatPainter')}
        active={painterMarks !== null}
        onClick={toggleFormatPainter}
      />
      <Btn
        label={<IconEraser />}
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
      <span className="octo-tb-undoredo">
        <Btn
          label={<IconUndo />}
          title={t('docs.toolbar.undo')}
          disabled={!editor.can().undo?.()}
          onClick={() => editor.chain().focus().undo().run()}
        />
        <Btn
          label={<IconRedo />}
          title={t('docs.toolbar.redo')}
          disabled={!editor.can().redo?.()}
          onClick={() => editor.chain().focus().redo().run()}
        />
      </span>
    </div>
    {findOpen && <FindBar editor={editor} onClose={() => setFindOpen(false)} />}
    </div>
  )
}
