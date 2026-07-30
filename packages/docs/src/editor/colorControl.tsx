/**
 * colorControl — the shared colour-picker primitives used by BOTH the docs table toolbar
 * (Toolbar.tsx) and the whiteboard's native-panel text controls (../board/NativePanelTextControls).
 *
 * Extracted so the two surfaces render the SAME colour experience — a preset swatch grid + a custom
 * spectrum + hex "更多颜色" flow from @univerjs/design's ColorPicker — instead of drifting apart with
 * two independent implementations. The board's text-colour control was reworked (XIN-528 lineage) to
 * open this exact popover, so a user picks colour the same way whether they are in a doc table or on
 * the board.
 *
 * The three helpers here (`getUniverPortal`, `designLocale`, `IconResetColor`) and the
 * `ColorSplitControl` component were previously private to Toolbar.tsx; moving them here keeps a
 * single source of truth without changing their behaviour.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { ColorPicker, Tooltip } from '@univerjs/design'
// The @univerjs/design locale bundles supply the ColorPicker's own button labels (更多 / 确定 /
// 取消). Each surface mounts its own <ConfigProvider>, so we hand it the bundle matching the app's
// current language — otherwise those labels render blank (ConfigContext.locale is undefined).
import designZhCN from '@univerjs/design/locale/zh-CN'
import designEnUS from '@univerjs/design/locale/en-US'
import { t, i18n } from '../octoweb/index.ts'
import { UNIVER_COLOR_PRESETS } from './colorPalette.ts'

/**
 * Dedicated, docs-scoped portal host for @univerjs/design popups. They mount OUTSIDE the app tree,
 * where the Univer theme (which supplies their background color) isn't applied — so the popup surface
 * would render transparent. Hosting them under a known element lets styles.css give the popup a solid
 * background, scoped to `.octo-univer-portal` so the sheet's own Univer popups are untouched.
 */
export function getUniverPortal(): HTMLElement | null {
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

/** The @univerjs/design locale bundle whose `design` sub-object drives the embedded ColorPicker's
 * button labels (更多 / 确定 / 取消), matched to the app's current language. Read at render so a
 * locale switch is reflected the next time the caller re-renders. */
export function designLocale() {
  const lang = (i18n.getLocale() || '').toLowerCase()
  return (lang.startsWith('zh') ? designZhCN : designEnUS).design
}

/** "Reset colour" glyph for the picker's clear row — a swatch square with a diagonal slash, the same
 * "no colour" affordance the sheet shows next to its 重置颜色 item. Stroke line-art (not filled), so
 * it reads at 14px without .octo-tb-icon's fill. */
export const IconResetColor = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="octo-colorpicker-clear-icon">
    <rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <line x1="3.6" y1="12.4" x2="12.4" y2="3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
)

/**
 * Split colour control shared by the text-colour and highlight buttons: the main button applies the
 * last-used colour, the caret opens the sheet's own Univer ColorPicker (preset grid + custom spectrum
 * + hex). ColorPicker.onChange fires for a completed preset click or the custom panel's 确定 button;
 * dragging the spectrum/hue only mutates the picker's internal state, so one pick = one caller
 * transaction, matching the sheet. We additionally bridge preset pointerdown below because an
 * Excalidraw dropdown can tear this control down before Univer receives the later click.
 *
 * The popover closes on outside-click like the sheet's (and the docs link/list menus) — but a click
 * inside the ColorPicker's own "更多颜色" dialog, which portals to #octo-univer-portal, must NOT count
 * as outside: closing there would unmount the ColorPicker and take the dialog down with it.
 */
export function ColorSplitControl({
  title,
  initialColor,
  currentColor,
  renderIcon,
  onMainClick,
  onPick,
  onClear,
  portalPopover = false,
  singleButton = false,
  openSignal,
  getAnchorRect,
  portalAlign = 'start',
  commitPresetOnPointerDown = false,
}: {
  title: string
  initialColor: string
  /**
   * Opt-in CONTROLLED truth. When provided, the displayed icon, the ColorPicker's selected-swatch
   * highlight, and the main-button action all track this value — so the control mirrors the live
   * Excalidraw appState/selection colour and stays in sync no matter which entry point changed it
   * (a sibling control, a selection switch, the tool-default → selected transition). Board surfaces
   * pass it; the docs table toolbar omits it and keeps the "last-used colour" memory below.
   *
   * Leave `undefined` for the uncontrolled last-used behaviour: `initialColor` seeds the memory once
   * and a parent re-render must NOT reset the colour the user picked (docs toolbar semantics).
   */
  currentColor?: string
  renderIcon: (color: string) => ReactNode
  onMainClick: (color: string) => void
  onPick: (color: string) => void
  onClear: () => void
  /** Escape clipping/overflow when embedded in the narrow scrolling whiteboard property panel. */
  portalPopover?: boolean
  /** Render one swatch button that opens the picker instead of a main-action + caret split button. */
  singleButton?: boolean
  /**
   * Opt-in imperative open. When this value CHANGES to a truthy number the popover opens, without a
   * click on the control's own button. Board slot 9 uses it: the native Excalidraw toolbar button
   * and the digit-9 shortcut dispatch a document event, and the mounted control opens from that.
   */
  openSignal?: number
  /**
   * Opt-in anchor for the portal popover position. When provided, its returned rect is used instead
   * of the control's own bounding box — so a visually-hidden control (opened via `openSignal`) can
   * still position its popover next to the real trigger (e.g. the native toolbar button).
   */
  getAnchorRect?: () => { left: number; right: number; top: number; bottom: number } | null
  /** Start-align ordinary board pickers so they open to the button's right; the far-right canvas
   * toolbar trigger opts into end alignment to keep its palette inside the viewport. */
  portalAlign?: 'start' | 'end'
  /** Board-only workaround for Excalidraw portal teardown. Docs keep Univer's semantic onChange. */
  commitPresetOnPointerDown?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [lastColor, setLastColor] = useState<string>(currentColor ?? initialColor)
  const ref = useRef<HTMLSpanElement>(null)
  const popoverRef = useRef<HTMLSpanElement>(null)
  const [portalPosition, setPortalPosition] = useState({ left: 8, top: 8 })
  const commitPick = (color: string) => {
    setLastColor(color)
    onPick(color)
    setOpen(false)
  }
  // Univer 0.25 normally commits a preset through its click handler and public onChange. Inside an
  // Excalidraw dropdown, however, native pointer handling can tear the dropdown down before that
  // click is emitted. Resolve the pressed preset by Univer's stable row/button order and commit on
  // pointerdown so white and every other swatch still applies before teardown. preventDefault below
  // suppresses the later click, avoiding a duplicate onChange when the control remains mounted.
  const commitPresetPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('[data-u-comp="color-picker-presets"] button')
      : null
    if (!(commitPresetOnPointerDown || (portalPopover && currentColor !== undefined)) || !target || !event.currentTarget.contains(target)) return
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-u-comp="color-picker-presets"] button'),
    )
    const color = UNIVER_COLOR_PRESETS.flat()[buttons.indexOf(target)]
    if (!color) return
    // Excalidraw closes its native dropdown during pointer handling. Commit before that teardown and
    // consume this preset press; waiting for click means the picker can disappear first.
    event.preventDefault()
    event.stopPropagation()
    commitPick(color)
  }
  // `initialColor` is deliberately only the initial value for the UNCONTROLLED (docs toolbar) path.
  // For the CONTROLLED path, `currentColor` is the live truth: whenever it changes — a sibling
  // control edited the colour, the selection switched to a differently-coloured element, or the
  // tool-default ⇄ selected mode flipped — snap the displayed colour to it so the icon and the
  // ColorPicker's selected swatch never show a stale value. A local pick already sets `lastColor`
  // optimistically, so once the scene write echoes back through `currentColor` this is a no-op.
  // Guarded on equality so it cannot loop, and inert when `currentColor` is undefined (toolbar).
  useEffect(() => {
    if (currentColor !== undefined && currentColor !== lastColor) setLastColor(currentColor)
  }, [currentColor])
  // Imperative open (board slot 9): a changed, truthy signal opens the popover. `openSignal` seeds
  // at 0/undefined, so this never fires on mount — only when a later increment requests the picker.
  useEffect(() => {
    if (openSignal) setOpen(true)
  }, [openSignal])
  useLayoutEffect(() => {
    if (!open || !portalPopover) return
    const place = () => {
      const rect = getAnchorRect?.() ?? ref.current?.getBoundingClientRect()
      if (!rect) return
      const popoverWidth = popoverRef.current?.offsetWidth || 264
      const popoverHeight = popoverRef.current?.offsetHeight || 400
      const preferredLeft = portalAlign === 'end' ? rect.right - popoverWidth : rect.left
      setPortalPosition({
        // Ordinary board colour controls start-align with their button and grow to the right. Only
        // callers at the far-right toolbar edge opt into end alignment. Always place below the
        // trigger; anchoring from rect.top made the palette overlap the horizontal toolbar.
        left: Math.max(8, Math.min(preferredLeft, window.innerWidth - popoverWidth - 8)),
        top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - popoverHeight - 8)),
      })
    }
    place()
    const resizeObserver = typeof ResizeObserver === 'undefined' || !popoverRef.current
      ? null
      : new ResizeObserver(place)
    if (popoverRef.current) resizeObserver?.observe(popoverRef.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, portalPopover, portalAlign, getAnchorRect])
  useEffect(() => {
    if (!open || typeof document === 'undefined') return

    // Univer's “More Colors” dialog uses a Radix body portal, outside both ConfigProvider's mount
    // container and Excalidraw's dropdown. Mark the dialog AND its overlay with Excalidraw's native
    // outside-click exemption as soon as Radix mounts them; otherwise the first spectrum/confirm
    // pointer press tears down this ColorPicker before its onChange can commit.
    // Keep wheel/trackpad and touch scrolling inside the body-portalled dialog. Excalidraw listens
    // above the portal and otherwise consumes these events as canvas zoom/pan, which leaves the
    // custom-colour dialog visibly scrollable but impossible to scroll.
    const stopDialogScrollPropagation = (event: Event) => event.stopPropagation()
    const markColorDialog = () => {
      const colorDialog = document.querySelector<HTMLElement>(
        '[role="dialog"]:has([data-u-comp="color-picker-spectrum"])',
      )
      if (!colorDialog) return
      if (colorDialog.dataset.octoColorDialog !== 'true') {
        colorDialog.dataset.octoColorDialog = 'true'
        colorDialog.addEventListener('wheel', stopDialogScrollPropagation, { passive: true })
        colorDialog.addEventListener('touchmove', stopDialogScrollPropagation, { passive: true })
      }
      colorDialog.setAttribute('data-prevent-outside-click', '')
      // Dialog.Content portals to body rather than ConfigProvider's mount container. Restore the
      // Octo/Univer theme scope on the painted content itself so its utility variables, surface,
      // fields and action buttons retain the same layout and colours as the inline picker.
      colorDialog.classList.add('octo-theme', 'octo-univer-color-dialog')
      // Radix renders the modal overlay immediately before Content and gives it no stable public
      // attribute in Univer 0.25. Mark that sibling without broad-matching unrelated dialogs.
      const overlay = colorDialog.previousElementSibling
      if (overlay instanceof HTMLElement) {
        overlay.dataset.octoColorDialog = 'true'
        overlay.setAttribute('data-prevent-outside-click', '')
      }
    }
    markColorDialog()
    const dialogObserver = new MutationObserver(markColorDialog)
    dialogObserver.observe(document.body, { childList: true, subtree: true })

    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target) || popoverRef.current?.contains(target)) return
      // Univer's "More Colors" Dialog uses a Radix body portal, so it is neither under the split
      // control nor necessarily under our portal host. Treat only the actual dialog/overlay as
      // inside. Exempting the whole shared portal would make outside-click unable to close a
      // portalled board picker.
      if (target instanceof Element && target.closest('[data-octo-color-dialog="true"]')) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      dialogObserver.disconnect()
      document.querySelectorAll<HTMLElement>('[data-octo-color-dialog="true"]')
        .forEach((element) => {
          element.removeEventListener('wheel', stopDialogScrollPropagation)
          element.removeEventListener('touchmove', stopDialogScrollPropagation)
          delete element.dataset.octoColorDialog
          element.removeAttribute('data-prevent-outside-click')
          element.classList.remove('octo-theme', 'octo-univer-color-dialog')
        })
    }
  }, [open])
  return (
    <span className="octo-color-control octo-color-split" ref={ref}>
      <Tooltip title={title}>
        <button
          type="button"
          className="octo-tb-btn octo-color-main"
          aria-label={title}
          onMouseDown={(e) => {
            e.preventDefault()
            if (singleButton) e.stopPropagation()
          }}
          onClick={(e) => {
            if (singleButton) {
              // Keep the host dropdown mounted while its picker is open. Excalidraw otherwise sees
              // the click as a menu selection and unmounts this control before the portal renders.
              e.stopPropagation()
              setOpen((v) => !v)
            } else {
              onMainClick(lastColor)
            }
          }}
        >
          {renderIcon(lastColor)}
        </button>
      </Tooltip>
      {!singleButton && (
        <button
          type="button"
          className={'octo-tb-btn octo-color-caret-btn' + (open ? ' is-active' : '')}
          aria-label={title}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="octo-tb-caret" aria-hidden="true">▾</span>
        </button>
      )}
      {open && !portalPopover && (
        <span
          ref={popoverRef}
          className="octo-color-popover octo-color-popover--picker"
          // Commit preset presses before Excalidraw can close and unmount its native dropdown.
          onPointerDownCapture={commitPresetPointerDown}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <ColorPicker format="hex" value={lastColor} onChange={commitPick} />
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
      {open && portalPopover && getUniverPortal() && createPortal(
        <span
          ref={popoverRef}
          className="octo-color-popover octo-color-popover--picker octo-board-color-popover"
          style={{ left: portalPosition.left, top: portalPosition.top }}
          // Excalidraw's useOutsideClick explicitly honours this marker for portalled popovers.
          data-prevent-outside-click
          onPointerDownCapture={commitPresetPointerDown}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <ColorPicker format="hex" value={lastColor} onChange={commitPick} />
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
        </span>,
        getUniverPortal()!,
      )}
    </span>
  )
}
