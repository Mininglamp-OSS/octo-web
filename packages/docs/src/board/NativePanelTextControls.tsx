/**
 * React controls injected into Excalidraw's native text-properties panel. Board owns its extended
 * font catalogue, palette, rich-text runs, alignment and pending creation defaults; document toolbar
 * catalogues remain separate. Character-level writes use UTF-16 `customData.textRuns`, while global
 * writes update the live element and clear only the affected run property. Every element mutation
 * reaches Excalidraw history immediately and advances the collaboration CAS stamp through either the
 * vendor runtime mutation path or `bumpElementStamp` in the run/default helpers.
 *
 * Observer/injection lifecycle lives in ./nativePanelInject.tsx.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import {
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  LeftJustifyingIcon,
  HorizontallyIcon,
  RightJustifyingIcon,
  FontColorDoubleIcon,
  InfoIcon,
  MoreDownIcon,
} from '@univerjs/icons'
import { ConfigProvider, Tooltip } from '@univerjs/design'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { FONT_SIZES } from '../editor/fontSizes.ts'
import { DEFAULT_TEXT_COLOR } from '../editor/colorPalette.ts'
import { isFontFamilySupported } from '../editor/fontFamilies.ts'
import {
  BOARD_FONT_FAMILIES,
  normalizeBoardFontFamily,
} from './boardFontFamilies.ts'
import { TEXT_ALIGNS, isExcalidrawNativeAlign, type TextAlign } from '../editor/textAligns.ts'
import { ColorSplitControl, getUniverPortal, designLocale } from '../editor/colorControl.tsx'
import {
  readPendingTextMarks,
  setPendingTextMark,
  type PendingTextMark,
  type BoardTextDefaultsKey,
} from './boardTextDefaults.ts'
import {
  applyTextStyle,
  clearTextStyleProperties,
  parseTextRuns,
  serializeTextRuns,
  type BoardTextRun,
  type BoardTextStyle,
  type BoardTextStylePatch,
} from './boardTextRuns.ts'
import { t } from '../octoweb/index.ts'
import './nativePanelInject.css'

/** Structural view of a text element — mirrors the fields we read and write. */
interface TextElementView {
  id: string
  type: string
  isDeleted?: boolean
  fontSize: number
  fontFamily: number
  strokeColor: string
  textAlign?: string
  lineHeight?: number
  customData?: Record<string, unknown> | null
  /** Wrapped text as painted on canvas (may contain soft-wrap `\n`). */
  text?: string
  /** Unwrapped source text. Rich-text runs and textarea selection offsets are addressed in THIS
   *  UTF-16 space, so every run-offset computation must use it — never the wrapped `text`. */
  originalText?: string
  /** Bound text points back to its shape/container. Selection expansion happens in the installer,
   *  but the control keeps this structural field for live reflow after typography changes. */
  containerId?: string | null
}

/** The UTF-16 source string that run offsets and the WYSIWYG textarea address, defaulting through
 *  the wrapped text so callers never fall back to a shorter/longer string that shifts offsets. */
function sourceText(el: Pick<TextElementView, 'originalText' | 'text'>): string {
  return el.originalText ?? el.text ?? ''
}

/** The font-size control shows and applies whole integers only. A bounding-box resize scale leaves
 *  a fractional `fontSize` on the element (e.g. 23.04 after a 1.44× scale), so the sidebar rounds the
 *  real scaled value to the nearest integer for display; typed decimals are rounded the same way before
 *  they are applied. Non-finite input collapses to 0 (a value `applySize` then rejects). */
function roundFontSize(px: number): number {
  return Number.isFinite(px) ? Math.round(px) : 0
}


interface Snapshot {
  elements: readonly TextElementView[]
  selectedIds: Readonly<Record<string, boolean>>
  editingTextElement: TextElementView | null
  currentItemFontSize?: number
  currentItemFontFamily?: number
  currentItemStrokeColor?: string
  currentItemTextAlign?: string
}

interface TextSelectionState {
  elementId: string
  value: string
  selectionStart: number
  selectionEnd: number
  textRuns: BoardTextRun[]
  activeStyle: BoardTextStyle
}

interface Props {
  excalidrawAPI: ExcalidrawImperativeAPI
  /** Seed snapshot passed by the installer — used only for the very first render before the
   *  external store's subscription fires. Everything after that reads through the store. */
  initialSelection?: { elements: readonly TextElementView[]; selectedIds: readonly string[] }
  /** Attribute-targeted text ids derived by the installer. Includes direct text selections and text
   *  bound to selected containers, matching Excalidraw's `includeBoundTextElement: true` semantics. */
  targetIds?: readonly string[]
  /** STATE B: the Text tool is active with nothing selected. The controls edit the `currentItem*`
   *  appState defaults (font size / stroke colour / align) + pending customData marks that the next
   *  created text element inherits, instead of mutating an existing element. */
  toolDefault?: boolean
  /** Isolates pending B/I/U defaults to the mounted board instance. */
  defaultsKey: BoardTextDefaultsKey
  /** Excalidraw element-mutation helpers handed off from BoardShell's dynamic import (see
   *  {@link NativePanelTextRuntime}) so this module never statically imports the vendor bundle. */
  runtime: NativePanelTextRuntime
}

const MIXED_VALUE = ''
const EMPTY_SNAPSHOT: Snapshot = { elements: [], selectedIds: {}, editingTextElement: null }

// Excalidraw's element-mutation primitives, handed off from BoardShell's client-only DYNAMIC import
// rather than pulled in through a static `import * as Excalidraw from '@excalidraw/excalidraw'` here.
// A static value import would drag the whole vendor bundle into BoardShell's chunk (it statically
// imports this module via nativePanelInject) and execute Excalidraw's window/DOM-touching module
// body at import time — defeating the lazy chunk-splitting and breaking SSR. The two functions are
// the same ones native Excalidraw actions use; the injector threads them in via props.
export interface NativePanelTextRuntime {
  /** Mutate a live Excalidraw element in place (same path as native actions), bumping its version. */
  mutateElement: (element: unknown, updates: unknown, informMutation?: boolean) => unknown
  /** Remeasure/reflow a text element (and its bound container) after a typography change. */
  redrawTextBoundingBox: (
    element: unknown,
    container: unknown,
    elementsMap: unknown,
    informMutation?: boolean,
  ) => void
}

const BOARD_TEXT_ALIGNS = TEXT_ALIGNS.filter(isExcalidrawNativeAlign)
const ALIGN_ICONS: Record<'left' | 'center' | 'right', React.ComponentType<{ className?: string }>> = {
  left: LeftJustifyingIcon,
  center: HorizontallyIcon,
  right: RightJustifyingIcon,
}

/** Read the effective alignment off an element: native `textAlign` when present, else the
 *  customData fallback for `'justify'`, else the Excalidraw default `'left'`. */
function readAlign(el: TextElementView): TextAlign {
  const cd = el.customData
  if (cd && typeof cd.textAlign === 'string') {
    const v = cd.textAlign
    if (v === 'left' || v === 'center' || v === 'right' || v === 'justify') return v
  }
  const native = el.textAlign
  if (native === 'left' || native === 'center' || native === 'right') return native
  return 'left'
}

/** Boolean read out of `customData` — undefined/missing => false. */
function readBool(el: TextElementView, key: 'bold' | 'italic' | 'underline'): boolean {
  const cd = el.customData
  return !!(cd && cd[key] === true)
}

/** Coerce an arbitrary align string to our TextAlign union, defaulting to 'left'. */
function normalizeAlign(v: string): TextAlign {
  return v === 'center' || v === 'right' || v === 'justify' ? v : 'left'
}

function styleAtOffset(
  runs: readonly BoardTextRun[],
  offset: number,
  inheritPrevious = false,
): BoardTextStyle {
  const run = runs.find((candidate) => candidate.start <= offset && offset < candidate.end)
  if (run) return run
  // Only a collapsed caret inherits the character immediately before it. Range aggregation must
  // not inherit across a run boundary: doing so made the unstyled suffix look locally styled and
  // prevented “局部改完 → 整框统一” from ever leaving the mixed state.
  if (inheritPrevious) {
    const previous = runs.find((candidate) => candidate.start < offset && candidate.end === offset)
    if (previous) return previous
  }
  return {}
}

function effectiveSelectionValues<K extends keyof BoardTextStyle>(
  selection: TextSelectionState | null,
  key: K,
  baseValue: NonNullable<BoardTextStyle[K]>,
): Set<NonNullable<BoardTextStyle[K]>> {
  if (!selection) return new Set([baseValue])
  const start = Math.min(selection.selectionStart, selection.selectionEnd)
  const end = Math.max(selection.selectionStart, selection.selectionEnd)
  if (start === end) {
    const local = { ...styleAtOffset(selection.textRuns, start, true), ...selection.activeStyle }[key]
    return new Set([local === undefined ? baseValue : local as NonNullable<BoardTextStyle[K]>])
  }
  const boundaries = [
    ...new Set([
      start,
      end,
      ...selection.textRuns.flatMap((run) => [
        Math.max(start, run.start),
        Math.min(end, run.end),
      ]),
    ]),
  ].filter((offset) => offset >= start && offset <= end).sort((a, b) => a - b)
  const values = new Set<NonNullable<BoardTextStyle[K]>>()
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const local = styleAtOffset(selection.textRuns, boundaries[index])[key]
    values.add(local === undefined ? baseValue : local as NonNullable<BoardTextStyle[K]>)
  }
  return values
}

function effectiveElementValues<K extends keyof BoardTextStyle>(
  element: TextElementView,
  key: K,
  baseValue: NonNullable<BoardTextStyle[K]>,
): Set<NonNullable<BoardTextStyle[K]>> {
  const source = sourceText(element)
  const textLength = source.length
  if (textLength === 0) return new Set([baseValue])
  return effectiveSelectionValues({
    elementId: element.id,
    value: source,
    selectionStart: 0,
    selectionEnd: textLength,
    textRuns: parseTextRuns(element.customData, textLength),
    activeStyle: {},
  }, key, baseValue)
}

function mergeEffectiveElementValues<K extends keyof BoardTextStyle>(
  elements: readonly TextElementView[],
  key: K,
  readBase: (element: TextElementView) => NonNullable<BoardTextStyle[K]>,
): Set<NonNullable<BoardTextStyle[K]>> {
  const values = new Set<NonNullable<BoardTextStyle[K]>>()
  for (const element of elements) {
    for (const value of effectiveElementValues(element, key, readBase(element))) values.add(value)
  }
  return values
}

/** Board delegates to the shared Doc/Board font-availability probe so both surfaces report
 * missing local faces with identical semantics. */
export function isBoardFontSupported(value: string): boolean {
  return isFontFamilySupported(value)
}

interface PopoverPosition { left: number; top: number; width: number }

function positionBelow(anchor: HTMLElement | null): PopoverPosition | null {
  if (!anchor) return null
  const rect = anchor.getBoundingClientRect()
  return { left: rect.left, top: rect.bottom + 8, width: rect.width }
}

export function NativePanelTextControls({ excalidrawAPI, initialSelection, targetIds, toolDefault = false, defaultsKey, runtime }: Props) {
  const { mutateElement, redrawTextBoundingBox } = runtime
  const cache = useRef<{ signature: string; snapshot: Snapshot } | null>(null)
  const seedRef = useRef(initialSelection ?? null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pendingMarks, setPendingMarks] = useState(() => readPendingTextMarks(defaultsKey))
  const [textSelection, setTextSelection] = useState<TextSelectionState | null>(null)
  const [fontSizeDraft, setFontSizeDraft] = useState('')
  const [fontSizeOpen, setFontSizeOpen] = useState(false)
  const [fontFamilyOpen, setFontFamilyOpen] = useState(false)
  const [fontFamilyPosition, setFontFamilyPosition] = useState<PopoverPosition | null>(null)
  const [fontSizePosition, setFontSizePosition] = useState<PopoverPosition | null>(null)
  const fontFamilyAnchorRef = useRef<HTMLButtonElement>(null)
  const fontSizeAnchorRef = useRef<HTMLSpanElement>(null)
  const fontSizeEditingRef = useRef(false)
  const fontSizeDraftRef = useRef('')
  const skipNextFontSizeBlurRef = useRef(false)

  // A property write can shorten/reflow the injected section while the native column retains a
  // larger scroll offset. Clamp after every committed render (not only selection changes), which
  // covers alignment/font actions without forcing a valid scroll position back to the top.
  useLayoutEffect(() => {
    const panelColumn = panelRef.current?.closest<HTMLElement>('.panelColumn')
    if (!panelColumn) return
    const maxScrollTop = Math.max(0, panelColumn.scrollHeight - panelColumn.clientHeight)
    if (panelColumn.scrollTop > maxScrollTop) panelColumn.scrollTop = maxScrollTop
  })
  // Keep a synchronous copy because a sidebar pointer press can collapse the textarea selection
  // before React commits the state update triggered by the preceding native `select` event.
  const textSelectionRef = useRef<TextSelectionState | null>(null)

  const apiIsUsable =
    typeof (excalidrawAPI as { onChange?: unknown } | null)?.onChange === 'function' &&
    typeof (excalidrawAPI as { getSceneElementsIncludingDeleted?: unknown } | null)
      ?.getSceneElementsIncludingDeleted === 'function'

  const subscribe = useCallback(
    (notify: () => void) => {
      if (!apiIsUsable) return () => {}
      const unsub = excalidrawAPI.onChange(notify)
      return () => {
        // Excalidraw returns a disposer for onChange; call it defensively.
        try { unsub() } catch { /* ignore */ }
      }
    },
    [apiIsUsable, excalidrawAPI],
  )

  const snapshot = useSyncExternalStore<Snapshot>(
    subscribe,
    () => {
      if (!apiIsUsable) {
        // Fall back to the seed passed by the installer so the very first render still shows the
        // right selection state (before onChange fires).
        if (seedRef.current) {
          const selectedIds = Object.fromEntries(
            seedRef.current.selectedIds.map((id) => [id, true]),
          ) as Record<string, boolean>
          return { elements: seedRef.current.elements, selectedIds, editingTextElement: null }
        }
        return EMPTY_SNAPSHOT
      }
      const elements = excalidrawAPI.getSceneElementsIncludingDeleted() as unknown as readonly TextElementView[]
      const app = excalidrawAPI.getAppState() as ReturnType<ExcalidrawImperativeAPI['getAppState']> & {
        currentItemFontSize?: number
        currentItemFontFamily?: number
        currentItemStrokeColor?: string
        currentItemTextAlign?: string
      }
      const selectedMap = (app.selectedElementIds ?? {}) as Readonly<Record<string, boolean>>
      // Fold the editing-state text element into the active set: double-clicking into text drives
      // Excalidraw's panel off `appState.editingTextElement`, which is usually absent from
      // `selectedElementIds` until the edit is submitted (verified against dist/prod/index.js
      // `getSelectedElements`). Cover both the selected and editing panels with one control set.
      const editing = (app as { editingTextElement?: { id: string; type: string } | null })
        .editingTextElement
      let selectedIds = selectedMap
      if (targetIds?.some((id) => selectedMap[id] !== true)) {
        const expandedIds = { ...selectedMap }
        for (const id of targetIds) expandedIds[id] = true
        selectedIds = expandedIds
      }
      if (editing && editing.type === 'text' && selectedIds[editing.id] !== true) {
        selectedIds = { ...selectedIds, [editing.id]: true }
      }
      // Stable signature so useSyncExternalStore does not trigger a tearing re-render on every read
      // when nothing meaningful changed.
      const selectionKey = Object.keys(selectedIds)
        .filter((k) => selectedIds[k])
        .sort()
        .join(',')
      let selectedSig = ''
      for (const id of selectionKey.split(',')) {
        if (!id) continue
        const el = elements.find((e) => e.id === id)
        if (el) {
          const cd = el.customData ?? {}
          selectedSig += `|${el.id}=${el.type}:${el.fontFamily}:${el.fontSize}:${el.strokeColor}:${el.textAlign ?? ''}:${el.lineHeight ?? ''}:${(cd as Record<string, unknown>).textAlign ?? ''}:${(cd as Record<string, unknown>).bold ? 'b' : ''}${(cd as Record<string, unknown>).italic ? 'i' : ''}${(cd as Record<string, unknown>).underline ? 'u' : ''}:${JSON.stringify((cd as Record<string, unknown>).textRuns ?? null)}:${el.isDeleted ? 'd' : ''}`
        }
      }
      const defaultsSig = toolDefault
        ? `|defaults:${app.currentItemFontFamily ?? ''}:${app.currentItemFontSize ?? ''}:${app.currentItemStrokeColor ?? ''}:${app.currentItemTextAlign ?? ''}:${JSON.stringify(readPendingTextMarks(defaultsKey))}`
        : ''
      const editingKey = editing && editing.type === 'text' ? editing.id : ''
      const signature = `${elements.length}:${selectionKey}|editing:${editingKey}${selectedSig}${defaultsSig}`
      if (cache.current && cache.current.signature === signature) return cache.current.snapshot
      const next: Snapshot = {
        elements,
        selectedIds,
        editingTextElement: editing && editing.type === 'text'
          ? elements.find((element) => element.id === editing.id) ?? null
          : null,
        currentItemFontSize: app.currentItemFontSize,
        currentItemFontFamily: app.currentItemFontFamily,
        currentItemStrokeColor: app.currentItemStrokeColor,
        currentItemTextAlign: app.currentItemTextAlign,
      }
      cache.current = { signature, snapshot: next }
      return next
    },
    () => EMPTY_SNAPSHOT,
  )

  const selectedTextEls = useMemo(
    () =>
      snapshot.elements.filter(
        (el) => !el.isDeleted && snapshot.selectedIds[el.id] === true && el.type === 'text',
      ),
    [snapshot],
  )

  // Editing state is part of the subscribed snapshot. Never read it independently here: entering
  // edit mode on an already-selected element must invalidate the store and replace all handlers,
  // otherwise their closure keeps routing character controls as whole-element changes.
  const editingTextElement = snapshot.editingTextElement

  useEffect(() => {
    if (!editingTextElement || typeof document === 'undefined') {
      textSelectionRef.current = null
      setTextSelection(null)
      return
    }
    const updateSelection = (event: Event) => {
      const detail = (event as CustomEvent<Partial<TextSelectionState>>).detail
      if (!detail || detail.elementId !== editingTextElement.id) return
      const nextSelection: TextSelectionState = {
        elementId: detail.elementId,
        value: detail.value ?? '',
        selectionStart: detail.selectionStart ?? 0,
        selectionEnd: detail.selectionEnd ?? 0,
        textRuns: Array.isArray(detail.textRuns) ? detail.textRuns : [],
        activeStyle: detail.activeStyle ?? {},
      }
      textSelectionRef.current = nextSelection
      setTextSelection(nextSelection)
    }
    document.addEventListener('octo-text-selection-change', updateSelection, true)
    // Also retain the native textarea selection synchronously. This closes the pointer/focus race
    // where the sidebar receives pointerdown before React commits the vendor custom event.
    const retainNativeSelection = (event: Event) => {
      const editable = event.target
      if (!(editable instanceof HTMLTextAreaElement) || !editable.matches('textarea.excalidraw-wysiwyg')) return
      const nextSelection: TextSelectionState = {
        elementId: editingTextElement.id,
        value: editable.value,
        selectionStart: editable.selectionStart,
        selectionEnd: editable.selectionEnd,
        textRuns: parseTextRuns(editingTextElement.customData, editable.value.length),
        activeStyle: textSelectionRef.current?.activeStyle ?? {},
      }
      textSelectionRef.current = nextSelection
      setTextSelection(nextSelection)
    }
    document.addEventListener('select', retainNativeSelection, true)
    // The editor may have emitted its initial event before this panel mounted, or append the live
    // textarea one frame after the panel. Seed both now and on the next frame so the first local
    // selection never renders one property from the range and the remaining controls from globals.
    const seedFromEditable = () => {
      const editable = document.querySelector<HTMLTextAreaElement>('textarea.excalidraw-wysiwyg')
      if (!editable) return
      const nextSelection: TextSelectionState = {
        elementId: editingTextElement.id,
        value: editable.value,
        selectionStart: editable.selectionStart,
        selectionEnd: editable.selectionEnd,
        textRuns: parseTextRuns(editingTextElement.customData, editable.value.length),
        activeStyle: {},
      }
      textSelectionRef.current = nextSelection
      setTextSelection(nextSelection)
    }
    seedFromEditable()
    const frame = requestAnimationFrame(seedFromEditable)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('select', retainNativeSelection, true)
      document.removeEventListener('octo-text-selection-change', updateSelection, true)
    }
  }, [editingTextElement?.id])

  const activeTextSelection =
    editingTextElement && textSelection?.elementId === editingTextElement.id ? textSelection : null

  const fontSupport = useMemo(
    () => new Map(BOARD_FONT_FAMILIES.map((font) => [font.id, isBoardFontSupported(font.value)])),
    [],
  )

  useEffect(() => {
    if (!fontFamilyOpen && !fontSizeOpen) return
    const reposition = () => {
      if (fontFamilyOpen) setFontFamilyPosition(positionBelow(fontFamilyAnchorRef.current))
      if (fontSizeOpen) setFontSizePosition(positionBelow(fontSizeAnchorRef.current))
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (fontFamilyAnchorRef.current?.contains(target)) return
      if (fontSizeAnchorRef.current?.contains(target)) return
      if (target.closest('.octo-board-native-inject__font-menu, .octo-board-native-inject__font-size-menu')) return
      setFontFamilyOpen(false)
      setFontSizeOpen(false)
    }
    reposition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
    }
  }, [fontFamilyOpen, fontSizeOpen])

  // Tool-default (STATE B): read the live current-item appState defaults so the panel reflects and
  // edits the values the NEXT created text element will inherit. Read every render so it tracks
  // native swatch/size clicks too.
  const toolDefaultState = toolDefault
    ? {
        fontSize: snapshot.currentItemFontSize,
        fontFamily: snapshot.currentItemFontFamily,
        strokeColor: snapshot.currentItemStrokeColor,
        textAlign: snapshot.currentItemTextAlign,
        marks: pendingMarks,
      }
    : null

  if (selectedTextEls.length === 0 && !editingTextElement && !toolDefault) return null

  // Detect shared values across the selection (STATE A) or the current-item defaults (STATE B).
  const singleEditingElement = editingTextElement ?? null
  const sizes = new Set(
    [
      ...(toolDefault
        ? toolDefaultState?.fontSize != null ? [toolDefaultState.fontSize] : []
        : singleEditingElement
          ? effectiveSelectionValues(activeTextSelection, 'fontSize', singleEditingElement.fontSize)
          : mergeEffectiveElementValues(selectedTextEls, 'fontSize', (element) => element.fontSize)),
    ].map(roundFontSize),
  )
  const families = new Set(
    toolDefault
      ? [normalizeBoardFontFamily(toolDefaultState?.fontFamily)]
      : singleEditingElement
        ? new Set(
            [...effectiveSelectionValues(
              activeTextSelection,
              'fontFamily',
              singleEditingElement.fontFamily,
            )].map(normalizeBoardFontFamily),
          )
        : mergeEffectiveElementValues(selectedTextEls, 'fontFamily', (element) => (
            normalizeBoardFontFamily(element.fontFamily)
          )),
  )
  const colors = new Set(
    toolDefault
      ? toolDefaultState?.strokeColor != null ? [toolDefaultState.strokeColor] : []
      : singleEditingElement
        ? effectiveSelectionValues(activeTextSelection, 'color', singleEditingElement.strokeColor)
        : mergeEffectiveElementValues(selectedTextEls, 'color', (element) => element.strokeColor),
  )
  const aligns = new Set<TextAlign>(
    toolDefault
      ? toolDefaultState?.textAlign != null ? [normalizeAlign(toolDefaultState.textAlign)] : []
      : selectedTextEls.map((e) => readAlign(e)),
  )
  const bolds = new Set(
    toolDefault
      ? [!!toolDefaultState?.marks.bold]
      : singleEditingElement
        ? effectiveSelectionValues(activeTextSelection, 'bold', readBool(singleEditingElement, 'bold'))
        : mergeEffectiveElementValues(selectedTextEls, 'bold', (element) => readBool(element, 'bold')),
  )
  const italics = new Set(
    toolDefault
      ? [!!toolDefaultState?.marks.italic]
      : singleEditingElement
        ? effectiveSelectionValues(activeTextSelection, 'italic', readBool(singleEditingElement, 'italic'))
        : mergeEffectiveElementValues(selectedTextEls, 'italic', (element) => readBool(element, 'italic')),
  )
  const underlines = new Set(
    toolDefault
      ? [!!toolDefaultState?.marks.underline]
      : singleEditingElement
        ? effectiveSelectionValues(activeTextSelection, 'underline', readBool(singleEditingElement, 'underline'))
        : mergeEffectiveElementValues(selectedTextEls, 'underline', (element) => readBool(element, 'underline')),
  )


  const currentSize = sizes.size === 1 ? String([...sizes][0]) : MIXED_VALUE
  const onlyFamily = families.size === 1 ? [...families][0] : null
  const currentFamily =
    onlyFamily != null && BOARD_FONT_FAMILIES.some((font) => font.id === onlyFamily)
      ? String(onlyFamily)
      : MIXED_VALUE
  const currentColor = colors.size === 1 ? String([...colors][0]) : ''
  const currentAlign: TextAlign | null = aligns.size === 1 ? ([...aligns][0] as TextAlign) : null
  const currentBold = bolds.size === 1 ? [...bolds][0] : false
  const currentItalic = italics.size === 1 ? [...italics][0] : false
  const currentUnderline = underlines.size === 1 ? [...underlines][0] : false


  /** Apply typography to Excalidraw's live element object, then run its own measurement/reflow.
   *  During WYSIWYG editing `appState.editingTextElement` retains that live object identity. Replacing
   *  it with a clone leaves the textarea holding the old element and its next scene update restores
   *  the old font size/line height. `mutateElement` is the same path used by native actions, so both
   *  the scene and editing textarea observe one versioned element. */
  function applyTypography(
    update: Partial<TextElementView> | ((element: TextElementView) => Partial<TextElementView>),
    clearRunProperties: readonly (keyof BoardTextStyle)[] = [],
  ): void {
    const ids = new Set(selectedTextEls.map((e) => e.id))
    const liveElements = excalidrawAPI.getSceneElementsIncludingDeleted() as unknown as readonly TextElementView[]
    const elementsMap = new Map(liveElements.map((item) => [item.id, item]))
    for (const el of liveElements) {
      if (!ids.has(el.id)) continue
      const resolved = { ...(typeof update === 'function' ? update(el) : update) }
      const customDataSource = Object.prototype.hasOwnProperty.call(resolved, 'customData')
        ? resolved.customData
        : el.customData
      const customData = { ...(customDataSource ?? {}) }
      if (clearRunProperties.length) {
        const textLength = sourceText(el).length
        const textRuns = clearTextStyleProperties(
          parseTextRuns(customData, textLength),
          clearRunProperties,
          textLength,
        )
        if (textRuns.length) customData.textRuns = textRuns
        else delete customData.textRuns
      }
      resolved.customData = Object.keys(customData).length ? customData : null
      mutateElement(el as never, resolved as never, false)
      const containerId = (el as TextElementView & { containerId?: string | null }).containerId
      const container = containerId ? elementsMap.get(containerId) ?? null : null
      redrawTextBoundingBox(el as never, container as never, elementsMap as never, false)
    }
    excalidrawAPI.updateScene({ elements: [...liveElements] as never, captureUpdate: 'IMMEDIATELY' })
    if (editingTextElement && typeof document !== 'undefined') {
      const editable = document.querySelector<HTMLTextAreaElement>('textarea.excalidraw-wysiwyg')
      editable?.dispatchEvent(new CustomEvent('octo-text-style-update', {
        detail: { mode: 'global', clearProperties: clearRunProperties },
      }))
      window.dispatchEvent(new Event('resize'))
    }
  }

  /** Character controls follow the Board two-level cascade while text is being edited:
   *  a range writes only local run properties, a caret updates the editor's insertion style, and
   *  all other contexts update every selected element's base while clearing only that property. */
  function applyCharacterStyle(
    style: BoardTextStylePatch,
    baseUpdate: Partial<TextElementView> | ((element: TextElementView) => Partial<TextElementView>),
    clearRunProperties: readonly (keyof BoardTextStyle)[],
  ): void {
    const editingElement = editingTextElement
    const editable = editingElement && typeof document !== 'undefined'
      ? document.querySelector<HTMLTextAreaElement>('textarea.excalidraw-wysiwyg[data-type="wysiwyg"], textarea.excalidraw-wysiwyg')
      : null
    if (editable && editingElement) {
      // Clicking a select/button/picker moves focus out of the textarea before React's change/click
      // handler runs. Browsers may collapse the live DOM selection at that point, so the textarea
      // is not the source of truth for this transaction. Use the last selection event captured
      // while the editor owned focus; fall back to the DOM only before the first event.
      const retainedSelection = textSelectionRef.current?.elementId === editingElement.id
        ? textSelectionRef.current
        : null
      const start = retainedSelection?.selectionStart ?? editable.selectionStart
      const end = retainedSelection?.selectionEnd ?? editable.selectionEnd
      if (end > start) {
        const el = (excalidrawAPI.getSceneElementsIncludingDeleted() as unknown as readonly TextElementView[])
          .find((candidate) => candidate.id === editingElement.id)
        if (el) {
          // Selection offsets come straight from the WYSIWYG textarea, whose value is the UNWRAPPED
          // source (`originalText`). Rich-text runs are addressed in the same UTF-16 space, so the
          // range math must use the source length — never the wrapped `el.text`, whose soft-wrap
          // `\n`s would shift every offset (heavily so for Chinese, which wraps per character).
          const textLength = editable.value.length
          // Selecting the complete text is the editor's whole-element/global context. Apply the
          // base value and remove only this property's range overrides, so global wins while all
          // unrelated local properties survive. A strict sub-range remains a local override.
          if (start === 0 && end === textLength) {
            applyTypography(baseUpdate, clearRunProperties)
            return
          }
          const customData = { ...(el.customData ?? {}) }
          const textRuns = applyTextStyle(
            parseTextRuns(customData, textLength),
            start,
            end,
            style,
            textLength,
          )
          Object.assign(customData, serializeTextRuns(textRuns, textLength))
          mutateElement(el as never, { customData } as never, false)
          const liveElements = excalidrawAPI.getSceneElementsIncludingDeleted()
          const elementsMap = new Map(liveElements.map((candidate) => [candidate.id, candidate]))
          const containerId = (el as TextElementView & { containerId?: string | null }).containerId
          const container = containerId ? elementsMap.get(containerId) ?? null : null
          redrawTextBoundingBox(el as never, container as never, elementsMap as never, false)
          excalidrawAPI.updateScene({ elements: [...liveElements] as never, captureUpdate: 'IMMEDIATELY' })
          // Excalidraw's WYSIWYG handler synchronously remeasures the editor geometry before it
          // redraws the rich-text overlay and restores the retained range.
          editable.dispatchEvent(new CustomEvent('octo-text-style-update', {
            detail: { start, end, style, committed: true },
          }))
        }
        return
      }
      editable.dispatchEvent(new CustomEvent('octo-text-style-update', {
        detail: { start, end, style, mode: 'caret' },
      }))
      return
    }
    applyTypography(baseUpdate, clearRunProperties)
  }

  function updateToolDefaults(appState: Record<string, unknown>): void {
    excalidrawAPI.updateScene({ appState: appState as never })
  }

  const captureEditingSelection = () => {
    if (!editingTextElement || typeof document === 'undefined') return
    const editable = document.querySelector<HTMLTextAreaElement>(
      `textarea.excalidraw-wysiwyg[data-element-id="${editingTextElement.id}"], textarea.excalidraw-wysiwyg`,
    )
    if (!editable) return
    const liveElement = (excalidrawAPI.getSceneElementsIncludingDeleted() as unknown as readonly TextElementView[])
      .find((element) => element.id === editingTextElement.id) ?? editingTextElement
    const nextSelection: TextSelectionState = {
      elementId: editingTextElement.id,
      value: editable.value,
      selectionStart: editable.selectionStart,
      selectionEnd: editable.selectionEnd,
      textRuns: parseTextRuns(liveElement.customData, editable.value.length),
      activeStyle: textSelectionRef.current?.activeStyle ?? {},
    }
    textSelectionRef.current = nextSelection
    setTextSelection(nextSelection)
  }

  const applySize = (value: string) => {
    if (value === MIXED_VALUE) return
    // Integers only: a typed value (e.g. "17.63") is rounded to the nearest whole number before it
    // reaches the element, matching what the sidebar displays.
    const px = roundFontSize(Number(value))
    if (!Number.isFinite(px) || px <= 0) return
    if (toolDefault) {
      updateToolDefaults({ currentItemFontSize: px })
      return
    }
    // Excalidraw 0.18 has no native arbitrary-size action/button. Mutate the live text element and
    // run its measurement path directly; querying a made-up fontSize-octo-* button silently no-ops.
    applyCharacterStyle({ fontSize: px }, { fontSize: px }, ['fontSize'])
  }
  const applyFamily = (value: string) => {
    if (value === MIXED_VALUE) return
    const fontFamily = Number(value)
    if (!BOARD_FONT_FAMILIES.some((font) => font.id === fontFamily)) return

    if (toolDefault) {
      updateToolDefaults({ currentItemFontFamily: fontFamily })
      setFontFamilyOpen(false)
      return
    }
    // Always mutate the same live element used by the other typography controls. Routing family
    // through a hidden native button made behavior depend on whether that private button happened
    // to be mounted, so the same dropdown sometimes changed the element and sometimes no-op'd.
    applyCharacterStyle({ fontFamily }, { fontFamily }, ['fontFamily'])
    setFontFamilyOpen(false)
  }
  const restoreEditingSelection = (suppressFontSizeBlur = false) => {
    const retainedSelection = textSelectionRef.current
    if (!editingTextElement || retainedSelection?.elementId !== editingTextElement.id) return
    const editable = document.querySelector<HTMLTextAreaElement>(
      'textarea.excalidraw-wysiwyg[data-type="wysiwyg"], textarea.excalidraw-wysiwyg',
    )
    if (!editable) return
    requestAnimationFrame(() => {
      // Focus transfer from the size input causes one real blur. Arm suppression only immediately
      // before that transfer; preset pointerdown itself prevents focus movement and must not leave a
      // stale flag behind for a later custom-size blur.
      if (suppressFontSizeBlur) skipNextFontSizeBlurRef.current = true
      editable.focus({ preventScroll: true })
      editable.setSelectionRange(retainedSelection.selectionStart, retainedSelection.selectionEnd)
    })
  }
  const restoreEditingSelectionOnEscape = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return
    setFontFamilyOpen(false)
    setFontSizeOpen(false)
    restoreEditingSelection()
  }
  const commitFontSize = (value: string) => {
    // Keep the synchronous draft authoritative before applying. In edit mode the vendor's
    // `octo-text-style-update` handler focuses the WYSIWYG textarea synchronously, which blurs this
    // input and re-enters `commitFontSize` before React can paint. The blur path must therefore see
    // the value being committed, not the previous controlled input value.
    fontSizeDraftRef.current = value
    setFontSizeDraft(value)
    // Mark the input committed before the vendor mutation can synchronously focus the WYSIWYG and
    // blur us. The re-entrant blur then observes a completed edit and cannot reapply the old value.
    fontSizeEditingRef.current = false
    applySize(value)
    skipNextFontSizeBlurRef.current = false
    setFontSizeOpen(false)
  }
  const applyColor = (color: string) => {
    if (!color) return
    if (toolDefault) {
      updateToolDefaults({ currentItemStrokeColor: color })
      return
    }
    applyCharacterStyle({ color }, { strokeColor: color }, ['color'])
  }
  const applyAlign = (align: TextAlign) => {
    if (toolDefault) {
      updateToolDefaults({ currentItemTextAlign: isExcalidrawNativeAlign(align) ? align : 'left' })
      return
    }
    // Alignment is element-wide. Use the same live-object + remeasurement path as typography
    // so an active WYSIWYG editor cannot restore a stale cloned element.
    applyTypography((el) => {
      if (isExcalidrawNativeAlign(align)) {
        let cd: Record<string, unknown> | null | undefined = el.customData
        if (cd && cd.textAlign !== undefined) {
          const { textAlign: _drop, ...rest } = cd
          cd = Object.keys(rest).length ? rest : null
        }
        return { textAlign: align, customData: cd }
      }
      return {
        textAlign: 'left',
        customData: { ...(el.customData ?? {}), textAlign: 'justify' },
      }
    })
  }
  const toggleMark = (key: PendingTextMark) => {
    const selectedMarkIsOn = key === 'bold'
      ? currentBold
      : key === 'italic'
        ? currentItalic
        : currentUnderline
    const next = toolDefault
      ? !readPendingTextMarks(defaultsKey)[key]
      : !selectedMarkIsOn
    if (toolDefault) {
      setPendingTextMark(defaultsKey, key, next, snapshot.elements)
      setPendingMarks(readPendingTextMarks(defaultsKey))
      return
    }
    applyCharacterStyle({ [key]: next }, (el) => {
      const cd = { ...(el.customData ?? {}), [key]: next }
      if (!next) delete cd[key]
      return { customData: Object.keys(cd).length ? cd : null }
    }, [key])
  }

  return (
    // Wrap the whole panel in the same <ConfigProvider mountContainer={getUniverPortal()}> the docs
    // table toolbar uses, so the Univer Select / Dropdown overlays portal INTO `#octo-univer-portal`
    // (class `.octo-univer-portal`) instead of bare document.body. Excalidraw's WYSIWYG outside-click
    // guard exempts `.octo-univer-portal`, so picking a font family / size from the portalled menu no
    // longer blurs the text editor mid-edit before the value applies (the edit-mode 字体/字号 bug).
    <ConfigProvider mountContainer={getUniverPortal()} locale={designLocale()}>
    <div
      ref={panelRef}
      className="octo-board-native-inject__panel octo-board-properties-interactive"
      data-testid="board-native-panel-text-controls"
      role="group"
      aria-label={t('docs.board.nativePanel.group')}
    >
      {/* Font family — one app-owned control using the same catalogue and missing-font probe as
          Univer's Sheet picker. Pointer-down snapshots the WYSIWYG range before any overlay action. */}
      <fieldset className="octo-board-native-inject__fs">
        <legend>{t('docs.toolbar.fontFamily')}</legend>
        <button
          ref={fontFamilyAnchorRef}
          type="button"
          className="octo-board-native-inject__select-host octo-board-native-inject__font-select octo-board-properties-interactive properties-trigger"
          data-prevent-outside-click="true"
          data-testid="board-native-panel-font-family-control"
          aria-haspopup="listbox"
          aria-expanded={fontFamilyOpen}
          onPointerDown={(event) => {
            captureEditingSelection()
            event.preventDefault()
            setFontSizeOpen(false)
            setFontFamilyOpen((open) => !open)
          }}
          onClick={(event) => {
            // Keyboard activation has no pointerdown; mouse/touch already toggles above.
            if (event.detail === 0) {
              setFontSizeOpen(false)
              setFontFamilyOpen((open) => !open)
            }
          }}
          onKeyDown={restoreEditingSelectionOnEscape}
        >
          <span style={{ fontFamily: BOARD_FONT_FAMILIES.find((font) => String(font.id) === currentFamily)?.value }}>
            {currentFamily === MIXED_VALUE
              ? t('docs.board.nativePanel.mixed')
              : t(BOARD_FONT_FAMILIES.find((font) => String(font.id) === currentFamily)?.labelKey ?? 'docs.toolbar.font.arial')}
          </span>
          <MoreDownIcon className="octo-board-native-inject__font-size-arrow" />
        </button>
        <select
          className="octo-board-native-inject__test-select octo-board-properties-interactive properties-trigger"
          data-prevent-outside-click="true"
          data-testid="board-native-panel-font-family"
          tabIndex={-1}
          aria-hidden="true"
          value={currentFamily}
          onChange={(event) => applyFamily(event.currentTarget.value)}
          onKeyDown={restoreEditingSelectionOnEscape}
        >
          {currentFamily === MIXED_VALUE && <option value={MIXED_VALUE} />}
          {BOARD_FONT_FAMILIES.map((font) => <option key={font.id} value={font.id} />)}
        </select>
        {fontFamilyOpen && fontFamilyPosition && getUniverPortal() && createPortal(
          <div
            className="octo-board-native-inject__font-menu octo-board-properties-interactive"
            data-prevent-outside-click="true"
            role="listbox"
            style={{ left: fontFamilyPosition.left, top: fontFamilyPosition.top, minWidth: fontFamilyPosition.width }}
          >
            {BOARD_FONT_FAMILIES.map((font) => {
              const supported = fontSupport.get(font.id) !== false
              return (
                <button
                  key={font.id}
                  type="button"
                  role="option"
                  aria-selected={currentFamily === String(font.id)}
                  className="octo-board-native-inject__font-option"
                  style={{ fontFamily: font.value }}
                  onPointerDown={(event) => {
                    captureEditingSelection()
                    event.preventDefault()
                  }}
                  onClick={() => {
                    applyFamily(String(font.id))
                    restoreEditingSelection()
                  }}
                >
                  <span>{t(font.labelKey)}</span>
                  {!supported && (
                    <Tooltip
                      title={t('docs.board.nativePanel.fontNotSupported')}
                      placement="right"
                      className="octo-board-native-inject__font-tooltip"
                      asChild
                    >
                      <span
                        className="octo-board-native-inject__font-warning"
                        aria-label={t('docs.board.nativePanel.fontNotSupported')}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <InfoIcon />
                      </span>
                    </Tooltip>
                  )}
                </button>
              )
            })}
          </div>,
          getUniverPortal()!,
        )}
      </fieldset>

      {/* Font size — one table-style dropdown anchored directly below the editable input. */}
      <fieldset className="octo-board-native-inject__fs">
        <legend>{t('docs.board.nativePanel.fontSize')}</legend>
        <span
          ref={fontSizeAnchorRef}
          className="octo-board-native-inject__font-size-trigger octo-board-properties-interactive properties-trigger"
          data-prevent-outside-click="true"
          onPointerDown={captureEditingSelection}
        >
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            className="octo-board-native-inject__font-size octo-board-properties-interactive properties-trigger"
            data-prevent-outside-click="true"
            data-testid="board-native-panel-font-size"
            value={fontSizeEditingRef.current ? fontSizeDraft : currentSize}
            onFocus={() => {
              captureEditingSelection()
              fontSizeEditingRef.current = true
              fontSizeDraftRef.current = currentSize
              setFontSizeDraft(currentSize)
              setFontSizeOpen(true)
            }}
            onChange={(event) => {
              const value = event.currentTarget.value
              fontSizeEditingRef.current = true
              fontSizeDraftRef.current = value
              setFontSizeDraft(value)
              // Keep typed-size behavior compatible with the table input and with the existing
              // Board contract: a valid value applies immediately while the dropdown stays open.
              // Presets are complete actions and return to editing; arbitrary input keeps focus
              // until Enter/blur so multi-digit values can be typed without interruption.
              if (
                value.trim() !== '' &&
                Number.isFinite(Number(value)) &&
                FONT_SIZES.includes(value as typeof FONT_SIZES[number])
              ) {
                applySize(value)
              }
            }}
            onBlur={(event) => {
              if (skipNextFontSizeBlurRef.current) {
                skipNextFontSizeBlurRef.current = false
                return
              }
              // A completed preset/Enter commit leaves this DOM input focused until the next canvas
              // interaction. Only a genuinely active input edit may commit on blur; otherwise a
              // later selection change would apply the previous draft to the newly selected text.
              if (!fontSizeEditingRef.current) return
              commitFontSize(event.currentTarget.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitFontSize(fontSizeDraftRef.current || event.currentTarget.value)
                restoreEditingSelection()
                return
              }
              if (event.key === 'Escape') {
                fontSizeEditingRef.current = false
                setFontSizeOpen(false)
                fontSizeDraftRef.current = currentSize
                setFontSizeDraft(currentSize)
                setFontFamilyOpen(false)
                restoreEditingSelection(true)
              }
            }}
            aria-label={t('docs.board.nativePanel.fontSize')}
            placeholder={currentSize === MIXED_VALUE ? t('docs.board.nativePanel.mixed') : undefined}
          />
          <MoreDownIcon className="octo-board-native-inject__font-size-arrow" />
        </span>
        {fontSizeOpen && fontSizePosition && getUniverPortal() && createPortal(
          <div
            className="octo-board-native-inject__font-size-menu octo-board-properties-interactive"
            role="listbox"
            data-prevent-outside-click="true"
            style={{ left: fontSizePosition.left, top: fontSizePosition.top, width: fontSizePosition.width }}
          >
            {FONT_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                role="option"
                aria-selected={currentSize === size}
                className="octo-board-native-inject__font-size-option"
                onPointerDown={(event) => {
                  captureEditingSelection()
                  // Keep focus on the input until the option click commits. Because preventDefault
                  // cancels the focus transfer, there is no intermediate blur to suppress here.
                  event.preventDefault()
                }}
                onClick={() => {
                  commitFontSize(size)
                  restoreEditingSelection()
                }}
              >
                {size}
              </button>
            ))}
          </div>,
          getUniverPortal()!,
        )}
      </fieldset>

      {/* Text colour — the shared ColorSplitControl (preset grid + custom spectrum + hex), identical
          to the docs table toolbar, replacing the upstream stroke picker for text elements. The
          <ConfigProvider> hands the embedded @univerjs/design ColorPicker its portal host + locale
          (更多 / 确定 / 取消 labels), and `octo-theme` supplies the --octo-* tokens the popover paints
          itself with — exactly how Toolbar.tsx wraps the same control. */}
      <fieldset className="octo-board-native-inject__fs">
        <legend>{t('docs.board.nativePanel.textColor')}</legend>
        <ConfigProvider mountContainer={getUniverPortal()} locale={designLocale()}>
          <span
            className="octo-board-native-inject__color octo-theme"
            data-testid="board-native-panel-color"
            data-current-color={currentColor || 'mixed'}
          >
            <ColorSplitControl
              title={t('docs.board.nativePanel.textColor')}
              initialColor={currentColor || DEFAULT_TEXT_COLOR}
              currentColor={currentColor || DEFAULT_TEXT_COLOR}
              renderIcon={(c) => currentColor
                ? <FontColorDoubleIcon className="octo-tb-icon" extend={{ colorChannel1: c }} />
                : <span className="octo-board-color-icon octo-board-color-icon--mixed" aria-hidden="true" />}
              onMainClick={(c) => {
                if (currentColor) applyColor(c)
              }}
              onPick={(c) => applyColor(c)}
              onClear={() => applyColor(DEFAULT_TEXT_COLOR)}
              portalPopover
            />
          </span>
        </ConfigProvider>
      </fieldset>

      {/* Bold / Italic / Underline — element-level toggles under customData.*. */}
      <fieldset className="octo-board-native-inject__fs">
        <legend>{t('docs.board.nativePanel.style')}</legend>
        <div className="octo-board-native-inject__marks" role="group">
          <button
            type="button"
            className={
              'octo-board-native-inject__mark-btn' +
              (currentBold ? ' octo-board-native-inject__mark-btn--on' : '')
            }
            data-testid="board-native-panel-bold"
            aria-label={t('docs.board.nativePanel.bold')}
            aria-pressed={currentBold}
            title={t('docs.board.nativePanel.bold')}
            onClick={() => toggleMark('bold')}
          >
            <BoldIcon className="octo-tb-icon" />
          </button>
          <button
            type="button"
            className={
              'octo-board-native-inject__mark-btn' +
              (currentItalic ? ' octo-board-native-inject__mark-btn--on' : '')
            }
            data-testid="board-native-panel-italic"
            aria-label={t('docs.board.nativePanel.italic')}
            aria-pressed={currentItalic}
            title={t('docs.board.nativePanel.italic')}
            onClick={() => toggleMark('italic')}
          >
            <ItalicIcon className="octo-tb-icon" />
          </button>
          <button
            type="button"
            className={
              'octo-board-native-inject__mark-btn' +
              (currentUnderline ? ' octo-board-native-inject__mark-btn--on' : '')
            }
            data-testid="board-native-panel-underline"
            aria-label={t('docs.board.nativePanel.underline')}
            aria-pressed={currentUnderline}
            title={t('docs.board.nativePanel.underline')}
            onClick={() => toggleMark('underline')}
          >
            <UnderlineIcon className="octo-tb-icon" />
          </button>
        </div>
      </fieldset>

      {/* Horizontal alignment — replaces the upstream 3-button list. */}
      <fieldset className="octo-board-native-inject__fs">
        <legend>{t('docs.board.nativePanel.align.group')}</legend>
        <div
          className="octo-board-native-inject__aligns"
          data-testid="board-native-panel-aligns"
          role="group"
        >
          {BOARD_TEXT_ALIGNS.map((a) => {
            const Icon = ALIGN_ICONS[a]
            const on = currentAlign === a
            return (
              <button
                key={a}
                type="button"
                className={
                  'octo-board-native-inject__align-btn' +
                  (on ? ' octo-board-native-inject__align-btn--on' : '')
                }
                data-testid="board-native-panel-align-btn"
                data-align={a}
                aria-label={t(`docs.board.nativePanel.align.${a}`)}
                aria-pressed={on}
                title={t(`docs.board.nativePanel.align.${a}`)}
                onClick={() => applyAlign(a)}
              >
                <Icon className="octo-tb-icon" />
              </button>
            )
          })}
        </div>
      </fieldset>

    </div>
    </ConfigProvider>
  )
}
