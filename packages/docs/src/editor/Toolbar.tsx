import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode, UIEvent } from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import { CellSelection } from '@tiptap/pm/tables'
import { NodeSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
// Univer's own design-system components (@univerjs/design, Apache-2.0) so the docs toolbar uses the
// SAME controls as the sheet instead of bespoke ones. Its stylesheet is global but scoped to
// `univer-*` classes, so it doesn't bleed into docs' own styles.
import { Select, ConfigProvider, DropdownMenu, Tooltip, ColorPicker } from '@univerjs/design'
import '@univerjs/design/lib/index.css'
// The @univerjs/design locale bundles supply the ColorPicker's own button labels (更多 / 确定 /
// 取消). The docs toolbar mounts its own <ConfigProvider>, so we hand it the bundle matching the
// app's current language — otherwise those labels render blank (ConfigContext.locale is undefined).
import designZhCN from '@univerjs/design/locale/zh-CN'
import designEnUS from '@univerjs/design/locale/en-US'
// Univer's own icon set (@univerjs/icons, MIT) — the SAME icons the sheet uses, so identical
// functions read with identical glyphs across docs and sheet.
import {
  UndoIcon,
  RedoIcon,
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  StrikethroughIcon,
  LeftJustifyingIcon,
  HorizontallyIcon,
  RightJustifyingIcon,
  AlignTextBothIcon,
  CodeIcon,
  DividerIcon,
  LinkIcon as UniverLinkIcon,
  UnorderIcon,
  OrderIcon,
  TodoListDoubleIcon,
  UnlinkIcon,
  BrushIcon,
  ClearFormatDoubleIcon,
  AddImageIcon,
  FolderIcon,
  FlagIcon,
  SearchIcon,
  ArrowRightIcon,
  PaintBucketDoubleIcon as HighlightingIcon,
  FontColorDoubleIcon,
  SuperscriptIcon,
  SubscriptIcon,
  FontSizeIncreaseIcon,
  FontSizeReduceIcon,
  CopyIcon,
  WriteIcon,
  DeleteIcon,
} from '@univerjs/icons'
import { pickAndUploadImage } from './imageUpload.ts'
import { pickAndUploadFile } from './fileUpload.ts'
import { insertBookmarkFromUrl } from './bookmarkInsert.ts'
import { getFindState, revealMatchInView, expandAncestorDetails, type FindReplaceState } from './findReplace.ts'
import { pickerEmojis } from './emoji.ts'
import { sanitizeLinkHref } from './sanitize.ts'
import { CALLOUT_VARIANTS, type CalloutVariant } from './Callout.ts'
import { INDENT_MAX_LEVEL } from './ParagraphIndent.ts'
import { TableGridPicker } from './TableControls.tsx'
import { FormulaControl } from './FormulaControl.tsx'
import { capturePaintMarks, applyPaintMarks } from './formatPainter.ts'
import { HIGHLIGHT_COLORS, TEXT_COLORS } from './colorPalette.ts'
import { t, i18n } from '../octoweb/index.ts'
import { FONT_FAMILY_ENABLED, LINE_SPACING_ENABLED } from '../config.ts'
import { FONT_FAMILIES } from './fontFamilies.ts'
import type { Mark } from '@tiptap/pm/model'

// Inline SVG toolbar icons (C2–C4): crisp, correct glyphs for underline / strikethrough /
// alignment, replacing the ambiguous text placeholders. 16×16, fill: currentColor (via .octo-tb-icon).
const IconUnderline = () => <UnderlineIcon className="octo-tb-icon" />
const IconStrike = () => <StrikethroughIcon className="octo-tb-icon" />
const IconAlignLeft = () => <LeftJustifyingIcon className="octo-tb-icon" />
const IconAlignCenter = () => <HorizontallyIcon className="octo-tb-icon" />
const IconAlignRight = () => <RightJustifyingIcon className="octo-tb-icon" />
const IconAlignJustify = () => <AlignTextBothIcon className="octo-tb-icon" />
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
const IconList = () => <UnorderIcon className="octo-tb-icon" />
const IconBulletList = () => <UnorderIcon className="octo-tb-icon" />
const IconOrderedList = () => <OrderIcon className="octo-tb-icon" />
const IconTaskList = () => <TodoListDoubleIcon className="octo-tb-icon" />
const IconQuote = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7.2 7C5.4 7 4 8.4 4 10.2c0 1.7 1.3 3 3 3 .2 0 .4 0 .6-.1-.4 1.2-1.5 2.2-3 2.6l.6 1.3c2.7-.7 4.5-2.9 4.5-5.9V10.2C9.7 8.4 8.4 7 7.2 7zm9 0C14.4 7 13 8.4 13 10.2c0 1.7 1.3 3 3 3 .2 0 .4 0 .6-.1-.4 1.2-1.5 2.2-3 2.6l.6 1.3c2.7-.7 4.5-2.9 4.5-5.9V10.2C18.7 8.4 17.4 7 16.2 7z" />
  </svg>
)
// codeBlock: a literal `</>` — left chevron, a centered forward slash, right chevron
// (boss reference). Filled glyph via .octo-tb-icon to match the other toolbar icons.
const IconCode = () => <CodeIcon className="octo-tb-icon" />
// Link (XIN-1051): the standard chain-link glyph (lucide `link`) — two diagonal, interlocking
// hooked curves. Stroke line-art, not filled: uses .octo-tb-icon-stroke (fill:none;
// stroke:currentColor) with round caps/joins so it reads as a recognizable link icon at 16px
// rather than the old two-capsule filled blob. Aligned with IconUnlink below.
const IconLink = () => <UniverLinkIcon className="octo-tb-icon" />
// Unlink (XIN-1051): the same chain pulled apart (lucide `unlink`) — the two hooked curves with a
// break plus the four short "snap" ticks. Same stroke style as IconLink so the pair reads as a set.
const IconUnlink = () => <UnlinkIcon className="octo-tb-icon" />

// Clear-format: a tilted eraser/rubber sweeping over a baseline (boss reference). Filled glyph
// via .octo-tb-icon to match the other toolbar icons.
const IconEraser = () => <ClearFormatDoubleIcon className="octo-tb-icon" />

// Format painter (XIN-963): a paint-roller glyph — the classic "copy formatting" affordance used
// by Word / Feishu / Google Docs. Filled via .octo-tb-icon to match the other toolbar icons.
const IconFormatPainter = () => <BrushIcon className="octo-tb-icon" />

// Undo / redo: stroke-style curved-arrow glyphs (boss reference). NOT filled — they use
// .octo-tb-icon-stroke (fill:none; stroke:currentColor) so they inherit the light-grey
// #AAAAAA from the .octo-tb-undoredo wrapper. Redo is the horizontal mirror of Undo.
const IconUndo = () => <UndoIcon className="octo-tb-icon" />
const IconRedo = () => <RedoIcon className="octo-tb-icon" />

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
  const btn = (
    <button
      type="button"
      className={'octo-tb-btn' + (active ? ' is-active' : '')}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  )
  // Styled hover tooltip (matches the sheet's toolbar), instead of the plain native `title`.
  return title ? (
    <Tooltip title={title} asChild>
      {btn}
    </Tooltip>
  ) : (
    btn
  )
}

/**
 * Resolve a raw link input into a safe, absolute href — or null when it is not a usable link.
 *   - explicit scheme ("https://x", "mailto:a@b") / protocol-relative ("//cdn/x") → hand straight to
 *     sanitizeLinkHref so the §3.7 scheme whitelist still rejects javascript:/data:/ftp: etc.
 *   - scheme-less: a bare host/domain ("google.com") would resolve relative to the origin and become
 *     a same-origin path, so prepend https:// — but ONLY when it looks like a host (a dotted label,
 *     or "localhost"). A bare word like "abc" is NOT a URL and resolves to null.
 * Module-scoped so both the toolbar link popover and the link bubble (LinkBubbleMenu) share it.
 */
function resolveLinkHref(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  if (v.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(v)) return sanitizeLinkHref(v)
  const host = v.split(/[/?#]/, 1)[0]
  const looksLikeHost = host === 'localhost' || /[^.\s]\.[^.\s]/.test(host)
  return looksLikeHost ? sanitizeLinkHref(`https://${v}`) : null
}

/**
 * Link bubble (sheet-parity): when the caret sits in / a selection touches a link, a small card
 * floats by it — 🔗 + the URL (click opens it in a new tab) + copy + edit + unlink — mirroring the
 * sheet's link popup. The link is NOT edited inline: changing the href goes through this card's edit
 * field. openOnClick is off in the live editor (extensions.ts) so a click lands the caret in the
 * link and surfaces this card instead of navigating.
 */
export function LinkBubbleMenu({ editor }: { editor: Editor }) {
  useEditorTick(editor)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const href = (editor.getAttributes('link').href as string) || ''

  // Drop edit mode when the caret moves to a different link (or off links), so the card never
  // reopens in a stale editing state. Render-phase reset keyed off the current href.
  const seenHref = useRef(href)
  if (href !== seenHref.current) {
    seenHref.current = href
    if (editing) setEditing(false)
  }

  function applyEdit() {
    const resolved = resolveLinkHref(draft)
    if (!resolved) return
    editor.chain().focus().extendMarkRange('link').setLink({ href: resolved }).run()
    setEditing(false)
  }

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="linkBubbleMenu"
      shouldShow={({ editor: e }) =>
        e.isActive('link') && e.isEditable && !(e.state.selection instanceof CellSelection)
      }
    >
      <div className="octo-link-bubble">
        {editing ? (
          <>
            <input
              className="octo-link-bubble-input"
              autoFocus
              value={draft}
              placeholder={t('docs.toolbar.linkPlaceholder')}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  applyEdit()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setEditing(false)
                }
              }}
            />
            <Btn label={t('docs.toolbar.linkConfirm')} onClick={applyEdit} />
          </>
        ) : (
          <>
            <UniverLinkIcon className="octo-tb-icon octo-link-bubble-icon" />
            <a
              className="octo-link-bubble-url"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={href}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {href}
            </a>
            <Btn
              label={<CopyIcon className="octo-tb-icon" />}
              title={t('docs.toolbar.linkCopy')}
              onClick={() => {
                if (href && navigator.clipboard) void navigator.clipboard.writeText(href)
              }}
            />
            <Btn
              label={<WriteIcon className="octo-tb-icon" />}
              title={t('docs.toolbar.linkEdit')}
              onClick={() => {
                setDraft(href)
                setEditing(true)
              }}
            />
            <Btn
              label={<UnlinkIcon className="octo-tb-icon" />}
              title={t('docs.toolbar.linkRemove')}
              onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
            />
          </>
        )}
      </div>
    </BubbleMenu>
  )
}

/**
 * Formula bubble (sheet-parity): when a math node (inline or block) is selected, a floating toolbar
 * offers — like the sheet's — A⁻/A⁺ font size, a colour picker and Delete. Editing itself is IN-PLACE
 * (click the formula → it becomes an editable MathLive field, see mathExtended.ts), so there's no
 * edit button and the toolbar matches the sheet's (A⁻/A⁺ · colour · delete). Size/colour write the
 * node's fontSize/color attrs; re-selecting the node after each change keeps the bubble anchored.
 */
export function MathBubbleMenu({ editor }: { editor: Editor }) {
  useEditorTick(editor)
  const [colorOpen, setColorOpen] = useState(false)

  const mathNodeName = (): 'inlineMath' | 'blockMath' | null =>
    editor.isActive('inlineMath') ? 'inlineMath' : editor.isActive('blockMath') ? 'blockMath' : null

  // Update the selected formula's attrs WITHOUT touching editor focus or the DOM selection: a raw
  // setNodeMarkup transaction, re-pinning the NodeSelection so the bubble stays anchored. Crucially
  // it never calls editor.focus() / setNodeSelection-via-chain (which would blur the in-place MathLive
  // field and kick it out of edit mode) — so adjusting size/colour works whether the formula is just
  // selected OR being edited. The buttons' onMouseDown-preventDefault keeps the field focused.
  function updateMathAttrs(patch: Record<string, unknown>) {
    const pos = editor.state.selection.from
    const node = editor.state.doc.nodeAt(pos)
    if (!node || (node.type.name !== 'inlineMath' && node.type.name !== 'blockMath')) return
    const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch })
    tr.setSelection(NodeSelection.create(tr.doc, pos))
    editor.view.dispatch(tr)
  }

  // A⁻/A⁺: step the node's fontSize (base 20px when unset), clamped 8–72, mirroring the sheet.
  function stepSize(delta: number) {
    const nm = mathNodeName()
    if (!nm) return
    const cur = parseInt(String(editor.getAttributes(nm).fontSize || '20'), 10) || 20
    updateMathAttrs({ fontSize: `${Math.max(8, Math.min(72, cur + delta))}px` })
  }

  function setMathColor(color: string | null) {
    updateMathAttrs({ color })
    setColorOpen(false)
  }

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="mathBubbleMenu"
      shouldShow={({ editor: e }) => (e.isActive('inlineMath') || e.isActive('blockMath')) && e.isEditable}
    >
      <div className="octo-bubble-menu octo-math-bubble">
        <Btn label={<FontSizeReduceIcon className="octo-tb-icon" />} title={t('docs.toolbar.fontSizeReduce')} onClick={() => stepSize(-2)} />
        <Btn label={<FontSizeIncreaseIcon className="octo-tb-icon" />} title={t('docs.toolbar.fontSizeIncrease')} onClick={() => stepSize(2)} />
        <span className="octo-tb-sep" />
        <span className="octo-color-control">
          <Btn
            label={
              <span className="octo-math-color-label">
                <FontColorDoubleIcon className="octo-tb-icon" extend={{ colorChannel1: (editor.getAttributes(mathNodeName() ?? 'inlineMath').color as string) || TEXT_COLORS[0] }} />
                <span className="octo-tb-caret" aria-hidden="true">▾</span>
              </span>
            }
            title={t('docs.toolbar.textColor')}
            active={colorOpen}
            onClick={() => setColorOpen((v) => !v)}
          />
          {colorOpen && (
            <ConfigProvider mountContainer={getUniverPortal()} locale={designLocale()}>
              <span className="octo-color-popover octo-color-popover--picker octo-theme">
                <ColorPicker
                  format="hex"
                  value={(editor.getAttributes(mathNodeName() ?? 'inlineMath').color as string) || TEXT_COLORS[0]}
                  onChange={(c) => setMathColor(c)}
                />
                <button
                  type="button"
                  className="octo-colorpicker-clear"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setMathColor(null)}
                >
                  <IconResetColor />
                  {t('docs.toolbar.clearColor')}
                </button>
              </span>
            </ConfigProvider>
          )}
        </span>
        <span className="octo-tb-sep" />
        <Btn
          label={<DeleteIcon className="octo-tb-icon" />}
          title={t('docs.toolbar.mathDelete')}
          onClick={() => editor.chain().focus().deleteSelection().run()}
        />
      </div>
    </BubbleMenu>
  )
}

/** Selection bubble menu (frontend-design §3.3) — inline formatting. */
export function EditorBubbleMenu({ editor }: { editor: Editor }) {
  useEditorTick(editor)
  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e, from, to }) =>
        from !== to &&
        e.isEditable &&
        !e.isActive('link') &&
        !e.isActive('inlineMath') &&
        !e.isActive('blockMath') &&
        !(e.state.selection instanceof CellSelection)
      }
    >
      <div className="octo-bubble-menu">
        <Btn label={<BoldIcon className="octo-tb-icon" />} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
        <Btn label={<ItalicIcon className="octo-tb-icon" />} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <Btn label={<IconUnderline />} title={t('docs.toolbar.underline')} active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} />
        <Btn label={<IconStrike />} title={t('docs.toolbar.strike')} active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} />
        <Btn label={<CodeIcon className="octo-tb-icon" />} active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} />
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

/** The @univerjs/design locale bundle whose `design` sub-object drives the embedded ColorPicker's
 * button labels (更多 / 确定 / 取消), matched to the app's current language. Read at render so a
 * locale switch is reflected the next time the toolbar re-renders (it ticks on every selection). */
function designLocale() {
  const lang = (i18n.getLocale() || '').toLowerCase()
  return (lang.startsWith('zh') ? designZhCN : designEnUS).design
}

/** "Reset colour" glyph for the picker's clear row — a swatch square with a diagonal slash, the same
 * "no colour" affordance the sheet shows next to its 重置颜色 item. Stroke line-art (not filled), so
 * it reads at 14px without .octo-tb-icon's fill. */
const IconResetColor = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="octo-colorpicker-clear-icon">
    <rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <line x1="3.6" y1="12.4" x2="12.4" y2="3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
)

/**
 * Split colour control shared by the text-colour and highlight buttons: the main button applies the
 * last-used colour, the caret opens the sheet's own Univer ColorPicker (preset grid + custom spectrum
 * + hex). ColorPicker.onChange fires exactly once per committed colour (a preset click or the custom
 * panel's 确定 button); dragging the spectrum/hue only mutates the picker's internal state, so one
 * pick = one editor transaction = one undo record + one Yjs update, matching the sheet.
 *
 * The popover closes on outside-click like the sheet's (and the docs link/list menus) — but a click
 * inside the ColorPicker's own "更多颜色" dialog, which portals to #octo-univer-portal, must NOT count
 * as outside: closing there would unmount the ColorPicker and take the dialog down with it.
 */
function ColorSplitControl({
  title,
  initialColor,
  renderIcon,
  onMainClick,
  onPick,
  onClear,
}: {
  title: string
  initialColor: string
  renderIcon: (color: string) => ReactNode
  onMainClick: (color: string) => void
  onPick: (color: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const [lastColor, setLastColor] = useState<string>(initialColor)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      // The ColorPicker's "更多颜色" dialog mounts in the shared Univer portal, outside this control's
      // subtree — treat clicks there as inside so the popover (and thus the dialog) isn't torn down.
      const portal = document.getElementById('octo-univer-portal')
      if (portal?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  return (
    <span className="octo-color-control octo-color-split" ref={ref}>
      <Tooltip title={title}>
        <button
          type="button"
          className="octo-tb-btn octo-color-main"
          aria-label={title}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onMainClick(lastColor)}
        >
          {renderIcon(lastColor)}
        </button>
      </Tooltip>
      <button
        type="button"
        className={'octo-tb-btn octo-color-caret-btn' + (open ? ' is-active' : '')}
        aria-label={title}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="octo-tb-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <span className="octo-color-popover octo-color-popover--picker">
          <ColorPicker
            format="hex"
            value={lastColor}
            onChange={(c) => {
              setLastColor(c)
              onPick(c)
              setOpen(false)
            }}
          />
          <button
            type="button"
            className="octo-colorpicker-clear"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onClear()
              setOpen(false)
            }}
          >
            <IconResetColor />
            {t('docs.toolbar.clearColor')}
          </button>
        </span>
      )}
    </span>
  )
}

/** Text-highlight control (SCHEMA-SPEC §3): the shared {@link ColorSplitControl} driving highlight. */
function HighlightControl({ editor }: { editor: Editor }) {
  return (
    <ColorSplitControl
      title={t('docs.toolbar.highlight')}
      initialColor={HIGHLIGHT_COLORS[0]}
      renderIcon={(c) => <HighlightingIcon className="octo-tb-icon" extend={{ colorChannel1: c }} />}
      onMainClick={(c) => editor.chain().focus().toggleHighlight({ color: c }).run()}
      onPick={(c) => editor.chain().focus().setHighlight({ color: c }).run()}
      // Clear the highlight the caret sits in. unsetHighlight() alone only clears a non-empty range —
      // with a collapsed caret inside a highlight it clears stored marks only and leaves the <mark>.
      // extendMarkRange('highlight') first grows the selection to span the whole highlight under the
      // caret (a no-op when a range is already selected), so unsetHighlight() reliably removes it.
      onClear={() => editor.chain().focus().extendMarkRange('highlight').unsetHighlight().run()}
    />
  )
}

/** Text-colour control (SCHEMA-SPEC §3): the shared {@link ColorSplitControl} driving font colour. */
function TextColorControl({ editor }: { editor: Editor }) {
  return (
    <ColorSplitControl
      title={t('docs.toolbar.textColor')}
      initialColor={TEXT_COLORS[0]}
      renderIcon={(c) => <FontColorDoubleIcon className="octo-tb-icon" extend={{ colorChannel1: c }} />}
      onMainClick={(c) => editor.chain().focus().setColor(c).run()}
      onPick={(c) => editor.chain().focus().setColor(c).run()}
      onClear={() => editor.chain().focus().unsetColor().run()}
    />
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
  const options = [
    { label: '16', value: '' },
    ...FONT_SIZES.map((s) => ({ label: String(s), value: String(s) })),
  ]
  return (
    <Tooltip title={t('docs.toolbar.fontSize')}>
    <span className="octo-tb-sel octo-tb-sel--size">
      <Select
        value={current}
        options={options}
        onChange={(v) => {
          if (!v) editor.chain().focus().unsetFontSize().run()
          else editor.chain().focus().setFontSize(`${v}px`).run()
        }}
      />
    </span>
    </Tooltip>
  )
}

/** A+ / A- font-size step buttons (matches the sheet's increase/decrease-font-size controls). Steps
 * off the current size (default 16px when unset), clamped to 8–96px. */
function FontSizeStepButtons({ editor }: { editor: Editor }) {
  useEditorTick(editor)
  const cur = parseInt(((editor.getAttributes('textStyle').fontSize as string) || '16').replace('px', ''), 10) || 16
  const step = (delta: number) => {
    const n = Math.max(8, Math.min(96, cur + delta))
    editor.chain().focus().setFontSize(`${n}px`).run()
  }
  return (
    <>
      <Btn
        label={<FontSizeIncreaseIcon className="octo-tb-icon" />}
        title={t('docs.toolbar.fontSizeIncrease')}
        onClick={() => step(2)}
      />
      <Btn
        label={<FontSizeReduceIcon className="octo-tb-icon" />}
        title={t('docs.toolbar.fontSizeReduce')}
        onClick={() => step(-2)}
      />
    </>
  )
}
/**
 * Font-family dropdown (SCHEMA_VERSION 16): sets the textStyle `fontFamily` attr, or clears it.
 * Rendered only when FONT_FAMILY_ENABLED is on (feature flag); the caller gates it.
 */
function FontFamilySelect({ editor }: { editor: Editor }) {
  useEditorTick(editor)
  const current = (editor.getAttributes('textStyle').fontFamily as string) || ''
  // Univer's own Select (@univerjs/design) — same component family as the sheet, so docs matches it
  // natively. Each option's label is a ReactNode, so the font name renders in its own face (WYSIWYG),
  // like the sheet's picker.
  const options = [
    { label: t('docs.toolbar.font.arial'), value: '' },
    ...FONT_FAMILIES.map((f) => ({
      label: <span style={{ fontFamily: f.value }}>{t(f.labelKey)}</span>,
      value: f.value,
    })),
  ]
  return (
    <Tooltip title={t('docs.toolbar.fontFamily')}>
    <span className="octo-tb-sel octo-tb-sel--font">
      <Select
        value={current}
        options={options}
        onChange={(v: string) => {
          if (!v) editor.chain().focus().unsetFontFamily().run()
          else editor.chain().focus().setFontFamily(v).run()
        }}
      />
    </span>
    </Tooltip>
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
  const options = [
    { label: t('docs.toolbar.bodyText'), value: 'p' },
    ...[1, 2, 3, 4, 5, 6].map((l) => ({ label: t(`docs.toolbar.heading${l}`), value: `h${l}` })),
  ]
  return (
    <Tooltip title={t('docs.toolbar.blockType')}>
    <span className="octo-tb-sel octo-tb-sel--block">
      <Select
        value={current}
        options={options}
        onChange={(v) => {
          if (v === 'p') editor.chain().focus().setParagraph().run()
          else
            editor
              .chain()
              .focus()
              .setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6 })
              .run()
        }}
      />
    </span>
    </Tooltip>
  )
}

/** Text-alignment buttons (SCHEMA_VERSION 5): left/center/right/justify on heading + paragraph. */
function AlignControls({ editor }: { editor: Editor }) {
  useEditorTick(editor)
  // One compact icon dropdown (matches the sheet's single align control): the trigger shows the
  // current alignment's icon; the menu lists all four.
  const active = ALIGNMENTS.find((a) => editor.isActive({ textAlign: a.value })) ?? ALIGNMENTS[0]
  const options = ALIGNMENTS.map((a) => ({
    label: (
      <span className="octo-tb-align-opt">
        {a.icon}
        {t(`docs.toolbar.${a.key}`)}
      </span>
    ),
    value: a.value,
  }))
  return (
    <IconMenuSelect
      icon={active.icon}
      title={t(`docs.toolbar.${active.key}`)}
      value={active.value}
      options={options}
      onSelect={(v) => editor.chain().focus().setTextAlign(v).run()}
    />
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
// Compact line-spacing / paragraph-spacing glyphs (hand-drawn — @univerjs/icons 1.4 has no
// line-spacing icon). Lines + a direction cue so each reads as "line spacing / space before / after".
const IconLineSpacing = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 5h11v2H9V5zm0 6h11v2H9v-2zm0 6h11v2H9v-2zM5 4l3 3H6v10h2l-3 3-3-3h2V7H2l3-3z" />
  </svg>
)
const IconSpaceBefore = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 3h16v2H4V3zm2 6h12v2H6V9zm0 4h12v2H6v-2zm0 4h12v2H6v-2z" />
  </svg>
)
const IconSpaceAfter = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 3h12v2H6V3zm0 4h12v2H6V7zm0 4h12v2H6v-2zm-2 6h16v2H4v-2z" />
  </svg>
)

/**
 * Compact icon-triggered dropdown (matches the sheet's line-spacing / align controls): a fixed
 * icon + caret button that opens a single-select (radio) menu, instead of a wide <Select> that
 * shows the value as text — so it stays narrow and the ribbon doesn't overflow to a second row.
 */
function IconMenuSelect({
  icon,
  title,
  value,
  options,
  onSelect,
}: {
  icon: ReactNode
  title: string
  value: string
  options: { label: ReactNode; value: string }[]
  onSelect: (v: string) => void
}) {
  return (
    <Tooltip title={title}>
      <DropdownMenu items={[{ type: 'radio' as const, value, options, onSelect }]}>
        <button type="button" className="octo-tb-btn octo-tb-iconselect" aria-label={title}>
          {icon}
          <span className="octo-tb-caret" aria-hidden="true">▾</span>
        </button>
      </DropdownMenu>
    </Tooltip>
  )
}

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
      <IconMenuSelect
        icon={<IconLineSpacing />}
        title={t('docs.toolbar.lineHeight')}
        value={showCustom ? 'custom' : isPreset ? current : ''}
        options={[
          { label: t('docs.toolbar.lineHeightDefault'), value: '' },
          ...LINE_HEIGHTS.map((s) => ({ label: s, value: s })),
          { label: t('docs.toolbar.lineHeightCustom'), value: 'custom' },
        ]}
        onSelect={(v) => {
          if (v === 'custom') {
            setCustomPicked(true)
            return
          }
          setCustomPicked(false)
          if (!v) editor.chain().focus().unsetLineHeight().run()
          else editor.chain().focus().setLineHeight(v).run()
        }}
      />
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
  const value = isPreset ? current : current ? 'custom' : ''
  const options = [
    { label: t(titleKey), value: '' },
    ...PARAGRAPH_SPACINGS.map((s) => ({ label: s, value: s })),
    ...(!isPreset && current ? [{ label: t('docs.toolbar.spacingCustom'), value: 'custom' }] : []),
  ]
  return (
    <IconMenuSelect
      icon={edge === 'before' ? <IconSpaceBefore /> : <IconSpaceAfter />}
      title={t(titleKey)}
      value={value}
      options={options}
      onSelect={(v) => {
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
    />
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

/** Emoji toolbar glyph: a black-and-white outlined smiley (😊-style). Replaces @univerjs/icons'
 * SmileDoubleIcon, whose two-tone paths all fill with currentColor under .octo-tb-icon and collapse
 * into a solid black dot. Outline circle + two eyes + a smile arc, so it reads as a face at 16px. */
const IconSmile = () => (
  <svg className="octo-tb-icon" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7" />
    <circle cx="9" cy="10" r="1.15" fill="currentColor" />
    <circle cx="15" cy="10" r="1.15" fill="currentColor" />
    <path
      d="M8.2 14c.9 1.3 2.2 2 3.8 2s2.9-.7 3.8-2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
  </svg>
)

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
      <Btn label={<IconSmile />} title={t('docs.toolbar.emoji')} active={open} onClick={() => setOpen((v) => !v)} />
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

/**
 * Bookmark insert control: an inline URL popover (same anchored-popover pattern as the link
 * popover), replacing the former native window.prompt so the ribbon matches the sheet's
 * Univer dialogs. Enter or the insert button hands the raw URL to insertBookmarkFromUrl, which
 * validates → fetches the link card → inserts the node; an invalid URL keeps the popover open and
 * surfaces the shared error toast. Fetching disables the field so a double-submit can't fire twice.
 */
function BookmarkControl({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  async function confirm() {
    const v = url.trim()
    if (!v || busy) return
    setBusy(true)
    try {
      const ok = await insertBookmarkFromUrl(editor, v)
      if (ok) {
        setOpen(false)
        setUrl('')
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="octo-color-control" ref={ref}>
      <Btn
        label={<FlagIcon className="octo-tb-icon" />}
        title={t('docs.toolbar.bookmark')}
        active={open}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <span className="octo-color-popover octo-math-popover">
          <span className="octo-math-popover-title">{t('docs.toolbar.bookmark')}</span>
          <span className="octo-math-popover-row">
            <input
              className="octo-find-input"
              autoFocus
              value={url}
              disabled={busy}
              placeholder={t('docs.bookmark.prompt')}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void confirm()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setOpen(false)
                  setUrl('')
                }
              }}
            />
            <Btn label={t('docs.toolbar.insert')} disabled={busy} onClick={() => void confirm()} />
          </span>
        </span>
      )}
    </span>
  )
}

/** Fixed top toolbar (frontend-design §3.1). */
/**
 * Dedicated, docs-scoped portal host for @univerjs/design popups. They mount OUTSIDE the app tree,
 * where the Univer theme (which supplies their background color) isn't applied — so the popup surface
 * would render transparent. Hosting them under a known element lets styles.css give the popup a solid
 * background, scoped to `.octo-univer-portal` so the sheet's own Univer popups are untouched.
 */
function getUniverPortal(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  let el = document.getElementById('octo-univer-portal')
  if (!el) {
    el = document.createElement('div')
    el.id = 'octo-univer-portal'
    el.className = 'octo-univer-portal octo-theme'
    document.body.appendChild(el)
  }
  return el
}

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
  // Toolbar function tabs (开始/插入) — group the controls like the sheet's ribbon so the row isn't
  // one long undifferentiated strip. Utility controls (format painter / clear / find / undo-redo)
  // stay visible on both tabs.
  const [tab, setTab] = useState<'start' | 'insert'>('start')
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
    <ConfigProvider mountContainer={getUniverPortal()} locale={designLocale()}>
    {/* octo-theme defines the --octo-bg/-fg/-border tokens the inline popovers (colour picker,
        formula, bookmark, link) paint themselves with. Without it on an ancestor the tokens are
        undefined and `background: var(--octo-bg)` collapses to transparent — the toolbar bar still
        looks white over the white page, but a popover floating over body text shows straight through
        (the recurring "transparent popover" regression). Scoping it here covers every toolbar popup. */}
    <div className="octo-toolbar-wrap octo-theme">
    <div className="octo-tb-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'start'}
        className={'octo-tb-tab' + (tab === 'start' ? ' is-active' : '')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setTab('start')}
      >
        {t('docs.toolbar.tabStart')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'insert'}
        className={'octo-tb-tab' + (tab === 'insert' ? ' is-active' : '')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setTab('insert')}
      >
        {t('docs.toolbar.tabInsert')}
      </button>
    </div>
    <div className="octo-toolbar">
      {tab === 'start' && (
        <>
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
        label={<SearchIcon className="octo-tb-icon" />}
        title={t('docs.toolbar.find')}
        active={findOpen}
        onClick={() => setFindOpen((v) => !v)}
      />
      <span className="octo-tb-sep" />
      <BlockTypeSelect editor={editor} />
      {FONT_FAMILY_ENABLED && <FontFamilySelect editor={editor} />}
      <FontSizeSelect editor={editor} />
      <FontSizeStepButtons editor={editor} />
      <span className="octo-tb-sep" />
      <Btn label={<BoldIcon className="octo-tb-icon" />} title={t('docs.toolbar.bold')} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
      <Btn label={<ItalicIcon className="octo-tb-icon" />} title={t('docs.toolbar.italic')} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <Btn label={<IconUnderline />} title={t('docs.toolbar.underline')} active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} />
      <Btn label={<IconStrike />} title={t('docs.toolbar.strike')} active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} />
      <TextColorControl editor={editor} />
      <HighlightControl editor={editor} />
      <Btn label={<SuperscriptIcon className="octo-tb-icon" />} title={t('docs.toolbar.superscript')} active={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()} />
      <Btn label={<SubscriptIcon className="octo-tb-icon" />} title={t('docs.toolbar.subscript')} active={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()} />
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
      <Btn label={<DividerIcon className="octo-tb-icon" />} title={t('docs.toolbar.divider')} onClick={() => editor.chain().focus().setHorizontalRule().run()} />
      <CodeLanguageSelect editor={editor} />
        </>
      )}
      {tab === 'insert' && (
        <>
      <TableGridPicker editor={editor} />
      <Btn label={<AddImageIcon className="octo-tb-icon" />} title={t('docs.toolbar.image')} onClick={() => void pickAndUploadImage(editor)} />
      <Btn label={<FolderIcon className="octo-tb-icon" />} title={t('docs.toolbar.file')} onClick={() => void pickAndUploadFile(editor)} />
      <BookmarkControl editor={editor} />
      <span className="octo-tb-sep" />
      <EmojiControl editor={editor} />
      <Btn label="@" title={t('docs.toolbar.mention')} onClick={() => editor.chain().focus().insertContent('@').run()} />
      <Btn
        label={<ArrowRightIcon className="octo-tb-icon" />}
        title={t('docs.toolbar.details')}
        active={editor.isActive('details')}
        onClick={() => editor.chain().focus().setDetails().run()}
      />
      <CalloutControl editor={editor} />
      <FormulaControl editor={editor} kind="inline" />
      <FormulaControl editor={editor} kind="block" />
      <span className="octo-tb-sep" />
      <span className="octo-color-control octo-link-control" ref={linkRef}>
        <Btn label={<IconLink />} title={t('docs.toolbar.link')} active={editor.isActive('link') || linkOpen} onClick={openLink} />
        {linkOpen && (
          <span className="octo-color-popover octo-link-popover" role="dialog">
            <label className="octo-link-group">
              <span className="octo-link-label">{t('docs.toolbar.linkTextLabel')}</span>
              <input
                className="octo-link-field"
                ref={linkTextRef}
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
                placeholder={t('docs.toolbar.linkTextPlaceholder')}
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
            </label>
            {/* Type field: mirrors the sheet's 类型 row for visual parity. docs links are always web
                URLs (there is no cell/range target as in the sheet), so this is a static readout of
                the only type rather than a dropdown of one — honest, not a fake selector. */}
            <span className="octo-link-group">
              <span className="octo-link-label">{t('docs.toolbar.linkType')}</span>
              <span className="octo-link-type">{t('docs.toolbar.link')}</span>
            </span>
            <label className="octo-link-group">
              <span className="octo-link-label">{t('docs.toolbar.linkUrlLabel')}</span>
              <input
                className={'octo-link-field' + (linkError ? ' is-invalid' : '')}
                ref={linkUrlRef}
                value={linkValue}
                aria-invalid={linkError ? true : undefined}
                onChange={(e) => {
                  setLinkValue(e.target.value)
                  if (linkError) setLinkError(null)
                }}
                placeholder={t('docs.toolbar.linkUrlPlaceholder')}
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
            </label>
            {linkError && (
              <span className="octo-link-error" role="alert">
                {linkError}
              </span>
            )}
            <div className="octo-link-popover-actions">
              <button
                type="button"
                className="octo-link-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={closeLink}
              >
                {t('docs.toolbar.linkCancel')}
              </button>
              <button
                type="button"
                className="octo-link-btn octo-link-btn--primary"
                onMouseDown={(e) => e.preventDefault()}
                onClick={confirmLink}
              >
                {t('docs.toolbar.linkConfirm')}
              </button>
            </div>
          </span>
        )}
      </span>
        </>
      )}
    </div>
    {findOpen && <FindBar editor={editor} onClose={() => setFindOpen(false)} />}
    </div>
    </ConfigProvider>
  )
}
