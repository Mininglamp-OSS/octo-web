// The Univer "float DOM" for an inserted math formula — edited IN PLACE, exactly like a piece of text:
// click anywhere inside the box → a caret appears → type/erase with the physical keyboard. It looks
// like a rendered formula but behaves like an editable field.
//
// THE VIRTUAL KEYBOARD IS KILLED AT THE CSS LEVEL (installKeyboardKill below): MathLive's on-screen
// keyboard panel and its in-field toggle/menu buttons are `display:none`d globally, so no matter what
// MathLive tries, that panel can never appear. Editing is physical-keyboard only.
//
// Click behaviour: the MathLive field fills the WHOLE box (pointer-events:auto), so a click anywhere
// inside edits the formula. Only Univer's transform handles on the BORDER resize/drag the box — inner
// clicks never operate on the box. A small A⁻/A⁺ toolbar (font size) floats above while focused.
//
// Edits are debounced and saved back through the drawing model (requestFormulaSave → updateFormula →
// Yjs), so they persist + replicate.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MathfieldElement } from 'mathlive'
import { ColorPicker, ConfigProvider } from '@univerjs/design'
import designZhCN from '@univerjs/design/locale/zh-CN'
import designEnUS from '@univerjs/design/locale/en-US'
import { requestFormulaSave, requestDrawingBlur, requestFormulaResize, requestFormulaStyle, requestFormulaDelete } from './formulaBridge.ts'
import { t, i18n } from '../../octoweb/index.ts'

/** @univerjs/design locale (ColorPicker's 更多/确定/取消 labels) matching the app language. */
function designLocale() {
  const lang = (i18n.getLocale() || '').toLowerCase()
  return (lang.startsWith('zh') ? designZhCN : designEnUS).design
}

/** Component key registered with Univer's ComponentManager (must match on every collaborating client). */
export const OCTO_MATH_FORMULA_KEY = 'octo-math-formula'

/** The persisted per-formula payload (Univer drawing `data`). */
export interface MathFormulaData {
  latex?: string
  id?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  color?: string
}

const DEFAULT_FONT = 20
const MIN_FONT = 10
const MAX_FONT = 72

/** Univer's delete icon (@univerjs/icons delete-icon), so the trash button matches the ribbon. */
function DeleteGlyph(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.3313 1.4667C5.3313 1.13533 5.59993 0.866699 5.9313 0.866699H10.069C10.4004 0.866699 10.669 1.13533 10.669 1.4667C10.669 1.79807 10.4004 2.0667 10.069 2.0667H5.9313C5.59993 2.0667 5.3313 1.79807 5.3313 1.4667Z" />
      <path d="M1.09985 3.64443C1.09985 3.31306 1.36848 3.04443 1.69985 3.04443H14.2999C14.6312 3.04443 14.8999 3.31306 14.8999 3.64443C14.8999 3.9758 14.6312 4.24443 14.2999 4.24443H1.69985C1.36848 4.24443 1.09985 3.9758 1.09985 3.64443Z" />
      <path d="M6.12398 8.30171C6.35829 8.0674 6.73819 8.0674 6.97251 8.30171L8.00007 9.32928L9.02764 8.30171C9.26195 8.0674 9.64185 8.0674 9.87617 8.30171C10.1105 8.53603 10.1105 8.91593 9.87617 9.15024L8.8486 10.1778L9.87617 11.2054C10.1105 11.4397 10.1105 11.8196 9.87617 12.0539C9.64185 12.2882 9.26195 12.2882 9.02764 12.0539L8.00007 11.0263L6.97251 12.0539C6.73819 12.2882 6.35829 12.2882 6.12398 12.0539C5.88966 11.8196 5.88966 11.4397 6.12398 11.2054L7.15154 10.1778L6.12398 9.15024C5.88966 8.91593 5.88966 8.53603 6.12398 8.30171Z" />
      <path d="M4.75332 5.22217C3.86966 5.22217 3.15332 5.93851 3.15332 6.82217V12.5331C3.15332 13.9691 4.31738 15.1332 5.75332 15.1332H10.2465C11.6825 15.1332 12.8465 13.9691 12.8465 12.5331V6.82217C12.8465 5.93851 12.1302 5.22217 11.2465 5.22217H4.75332ZM4.35332 6.82217C4.35332 6.60125 4.53241 6.42217 4.75332 6.42217H11.2465C11.4674 6.42217 11.6465 6.60125 11.6465 6.82217V12.5331C11.6465 13.3063 11.0197 13.9332 10.2465 13.9332H5.75332C4.98012 13.9332 4.35332 13.3063 4.35332 12.5331V6.82217Z" />
    </svg>
  )
}

/** Univer's dropdown caret (@univerjs/icons more-down-icon). */
function CaretGlyph(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.7 }}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11.3536 6.14645C11.5488 6.34171 11.5488 6.65829 11.3536 6.85355L8.35355 9.85355C8.15829 10.0488 7.84171 10.0488 7.64645 9.85355L4.64645 6.85355C4.45118 6.65829 4.45118 6.34171 4.64645 6.14645C4.84171 5.95118 5.15829 5.95118 5.35355 6.14645L8 8.79289L10.6464 6.14645C10.8417 5.95118 11.1583 5.95118 11.3536 6.14645Z"
      />
    </svg>
  )
}

// Global default: never auto-show the virtual keyboard.
try {
  ;(MathfieldElement as unknown as { mathVirtualKeyboardPolicy?: string }).mathVirtualKeyboardPolicy = 'manual'
} catch {
  /* ignore */
}

// Inject ONE global stylesheet that makes MathLive's virtual keyboard impossible to render — both the
// old (.ML__keyboard) and new (.MLK__*) keyboard panels, plus the in-field keyboard/menu toggles.
// display:none is authoritative: even if MathLive flips it "visible", there is nothing to paint.
const KB_KILL_ID = 'octo-mathlive-styles'
function installKeyboardKill(): void {
  if (typeof document === 'undefined') return
  // Reuse one <style>, but always refresh its content so CSS tweaks apply even across HMR (a stale
  // element previously blocked updates, leaving the toolbar with default browser button borders).
  let style = document.getElementById(KB_KILL_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = KB_KILL_ID
    document.head.appendChild(style)
  }
  style.textContent = `
    .ML__keyboard,
    .ML__keyboard--visible,
    .MLK__backdrop,
    .MLK__plate,
    [class^="MLK__"] { display: none !important; visibility: hidden !important; }
    math-field::part(virtual-keyboard-toggle),
    math-field::part(menu-toggle) { display: none !important; }
    .octo-mf-tb { display: inline-flex; align-items: center; gap: 1px; padding: 4px 6px; background: var(--octo-bg,#fff); border: 1px solid var(--octo-border,#dcdfe5); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.14); color: var(--octo-fg,#1f2329); font-family: inherit; }
    .octo-mf-tb button { -webkit-appearance: none; appearance: none; outline: none; box-shadow: none; display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 28px; margin: 0; padding: 0 6px; border: 1px solid transparent !important; background: transparent; color: inherit; border-radius: 6px; cursor: pointer; font-size: 20px; line-height: 1; transition: background .12s; }
    .octo-mf-tb button:hover { background: rgba(20,86,240,0.08); }
    .octo-mf-tb button.active { background: rgba(20,86,240,0.14); color: var(--octo-accent,#1456f0); }
    .octo-mf-tb .octo-mf-size { font-size: 12px; min-width: 40px; text-align: center; color: var(--octo-muted,#8a919e); user-select: none; }
    .octo-mf-tb .octo-mf-sep { width: 1px; height: 18px; background: var(--octo-border,#e5e6eb); margin: 0 4px; }
  `
}

export function MathFormula({ data }: { data?: MathFormulaData }): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const mfRef = useRef<MathfieldElement | null>(null)
  const measureRef = useRef<MathfieldElement | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSize = useRef<{ w: number; h: number }>({ w: 0, h: 0 })
  // Screen position (viewport coords) for the portaled font-size toolbar.
  const [barPos, setBarPos] = useState<{ left: number; top: number } | null>(null)
  const [focused, setFocused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)
  const [fontSize, setFontSize] = useState(data?.fontSize ?? DEFAULT_FONT)

  const latex = data?.latex ?? ''
  const id = data?.id ?? ''
  const [color, setColor] = useState(data?.color ?? '')
  const idRef = useRef(id)
  idRef.current = id
  const fontRef = useRef(fontSize)
  fontRef.current = fontSize

  const save = () => {
    const mf = mfRef.current
    if (!mf || !idRef.current) return
    requestFormulaSave(idRef.current, mf.value, fontRef.current)
  }
  const scheduleSave = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(save, 400)
  }

  // Measure the hidden read-only field (auto-sized to the formula in both dimensions) and, if the size
  // changed, resize the drawing box to hug it (+ padding). Guarded so it converges without looping.
  const fitNow = () => {
    const m = measureRef.current
    if (!m || !idRef.current) return
    const r = m.getBoundingClientRect()
    const w = r.width + 14
    const h = r.height + 10
    if (w <= 18 || h <= 14) return
    if (Math.abs(w - lastSize.current.w) < 2 && Math.abs(h - lastSize.current.h) < 2) return
    lastSize.current = { w, h }
    requestFormulaResize(idRef.current, w, h)
  }
  const scheduleFit = () => {
    if (resizeTimer.current) clearTimeout(resizeTimer.current)
    resizeTimer.current = setTimeout(fitNow, 140)
  }

  useEffect(() => {
    installKeyboardKill()
    const host = hostRef.current
    if (!host) return
    const mf = new MathfieldElement()
    mfRef.current = mf
    // Editable, but no keyboard and no toggle/menu chrome.
    try {
      ;(mf as unknown as { mathVirtualKeyboardPolicy?: string }).mathVirtualKeyboardPolicy = 'manual'
    } catch {
      /* ignore */
    }
    mf.setAttribute('math-virtual-keyboard-policy', 'manual')
    try {
      ;(mf as unknown as { menuItems?: unknown[] }).menuItems = []
    } catch {
      /* ignore */
    }
    // Fill the whole box so a click anywhere inside edits. We measure the rendered formula from the
    // shadow-DOM content element (below), not from this host, so filling the box doesn't stop auto-fit.
    mf.style.cssText = `width:100%;height:100%;border:none;background:transparent;font-size:${fontRef.current}px;display:flex;align-items:center;`
    mf.value = latex
    const onInput = () => {
      // Keep the hidden measuring field in sync so auto-fit reflects what was just typed.
      if (measureRef.current) measureRef.current.value = mf.value
      scheduleSave()
      scheduleFit()
    }
    // Position the (portaled) font-size toolbar just to the right of the formula, in viewport coords.
    const updateBarPos = () => {
      const h = hostRef.current
      if (!h) return
      const r = h.getBoundingClientRect()
      setBarPos({ left: Math.round(r.right + 6), top: Math.round(r.top) })
    }
    let posRaf = 0
    const onEnter = () => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current)
        hideTimer.current = null
      }
      updateBarPos()
      setHovered(true)
    }
    const onMove = () => {
      if (posRaf) return
      posRaf = requestAnimationFrame(() => {
        posRaf = 0
        updateBarPos()
      })
    }
    const onLeave = () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => setHovered(false), 250)
    }
    const onFocusIn = () => {
      // Drop Univer's drawing selection so its keyboard shortcuts (arrows move / Delete removes the
      // drawing) have no target while we're editing — the keys then act inside the formula.
      requestDrawingBlur()
      updateBarPos()
      setFocused(true)
    }
    const onFocusOut = () => {
      // Delay so a click on the floating toolbar (which blurs the field) isn't treated as "done".
      setTimeout(() => {
        if (document.activeElement !== mf) setFocused(false)
      }, 200)
      save()
    }
    // Keep keystrokes INSIDE MathLive: arrows / Backspace / Delete must move the caret or erase a
    // character in the formula — NOT bubble up to Univer, which would treat them as move/delete on the
    // selected drawing (moving the whole box, or deleting the whole formula). MathLive still handles
    // them (we don't preventDefault); we only stop them reaching Univer's keyboard shortcuts.
    const stopKeys = (e: Event) => e.stopPropagation()
    // A click INSIDE the box edits the formula; a click near the BORDER selects the drawing so Univer
    // can move/resize it. We split by distance to the edge: within EDGE px of any side → let the event
    // through to Univer (select + show transform handles + drag/resize); otherwise → keep it here (stop
    // it reaching Univer so it can't grab focus / select-for-move), place the caret, and focus the
    // field. This is the "inner = edit, border = operate the box" behaviour, no double-click needed.
    const EDGE = 10
    const onHostPointerDown = (e: Event) => {
      const pe = e as PointerEvent
      const r = host.getBoundingClientRect()
      const nearEdge =
        pe.clientX - r.left < EDGE ||
        r.right - pe.clientX < EDGE ||
        pe.clientY - r.top < EDGE ||
        r.bottom - pe.clientY < EDGE
      if (nearEdge) return // border zone → Univer selects / drags / resizes the box
      e.stopPropagation()
      if (document.activeElement !== mf) mf.focus()
    }
    mf.addEventListener('keydown', stopKeys)
    mf.addEventListener('keyup', stopKeys)
    mf.addEventListener('input', onInput)
    mf.addEventListener('focusin', onFocusIn)
    mf.addEventListener('focusout', onFocusOut)
    host.addEventListener('pointerdown', onHostPointerDown)
    host.addEventListener('mouseenter', onEnter)
    host.addEventListener('mousemove', onMove)
    host.addEventListener('mouseleave', onLeave)
    host.appendChild(mf)

    // Auto-fit: measure a hidden READ-ONLY MathLive that auto-sizes to the formula in BOTH dimensions
    // (like the modal preview — tall stacks/∑/fractions included), rather than the on-screen field
    // (constrained to the box) or its shadow content box (baseline height only). getBoundingClientRect
    // of the offscreen field gives the true width AND height. Polled after mount because MathLive lays
    // out asynchronously; only pushes a resize when the size actually changed (converges, no loop).
    const mMf = new MathfieldElement()
    measureRef.current = mMf
    mMf.readOnly = true
    try {
      ;(mMf as unknown as { mathVirtualKeyboardPolicy?: string }).mathVirtualKeyboardPolicy = 'manual'
    } catch {
      /* ignore */
    }
    mMf.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;left:-99999px;top:0;width:max-content;white-space:nowrap;font-size:${fontRef.current}px;`
    mMf.value = latex
    document.body.appendChild(mMf)

    const ro = new ResizeObserver(scheduleFit)
    ro.observe(mf)
    // MathLive renders after mount; poll a few times so a long formula's box catches the full width
    // even if the first measurement lands mid-render (which previously left the box tiny → "co").
    const fitTimers = [120, 350, 700, 1200].map((d) => setTimeout(fitNow, d))

    return () => {
      // Flush any pending debounced edit before teardown — clearing the timer alone would drop the
      // last keystrokes if the component unmounts (navigate away / sheet switch / remote replace)
      // within the debounce window without a preceding blur.
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        save()
      }
      if (resizeTimer.current) clearTimeout(resizeTimer.current)
      if (hideTimer.current) clearTimeout(hideTimer.current)
      if (posRaf) cancelAnimationFrame(posRaf)
      fitTimers.forEach(clearTimeout)
      ro.disconnect()
      if (measureRef.current && document.body.contains(measureRef.current)) document.body.removeChild(measureRef.current)
      measureRef.current = null
      mf.removeEventListener('keydown', stopKeys)
      mf.removeEventListener('keyup', stopKeys)
      mf.removeEventListener('input', onInput)
      mf.removeEventListener('focusin', onFocusIn)
      mf.removeEventListener('focusout', onFocusOut)
      host.removeEventListener('pointerdown', onHostPointerDown)
      host.removeEventListener('mouseenter', onEnter)
      host.removeEventListener('mousemove', onMove)
      host.removeEventListener('mouseleave', onLeave)
      if (host.contains(mf)) host.removeChild(mf)
      mfRef.current = null
    }
  }, [])

  // Reflect remote latex changes (skip while locally focused so we don't clobber typing).
  useEffect(() => {
    const mf = mfRef.current
    if (mf && document.activeElement !== mf && mf.value !== latex) mf.value = latex
    // Keep the hidden measuring field in sync so a remote/preset formula also auto-fits.
    if (measureRef.current && measureRef.current.value !== latex) measureRef.current.value = latex
    scheduleFit()
  }, [latex])

  // Pull REMOTE fontSize/color changes (a collaborator's resize/recolor lands in the drawing `data`
  // and re-flows as new props) back into local state, so the change becomes visible without a remount.
  // Skip while this field is focused/editing so we never clobber the local edit in progress; the local
  // fontRef is realigned here too so a subsequent save() doesn't overwrite the remote value with stale
  // state (the last-writer-wins revert flagged in review).
  const remoteFontSize = data?.fontSize
  useEffect(() => {
    if (document.activeElement === mfRef.current) return
    if (typeof remoteFontSize === 'number' && remoteFontSize !== fontRef.current) {
      fontRef.current = remoteFontSize
      setFontSize(remoteFontSize)
    }
  }, [remoteFontSize])

  const remoteColor = data?.color
  useEffect(() => {
    if (document.activeElement === mfRef.current) return
    const next = remoteColor ?? ''
    setColor((prev) => (prev !== next ? next : prev))
  }, [remoteColor])

  useEffect(() => {
    const mf = mfRef.current
    if (mf) mf.style.fontSize = `${fontSize}px`
    // Font size affects the rendered size, so keep the measuring field in step for correct auto-fit.
    if (measureRef.current) measureRef.current.style.fontSize = `${fontSize}px`
    scheduleFit()
  }, [fontSize])

  // Text color, applied to both the on-screen field and the hidden measuring field. MathLive renders
  // math in currentColor, so this colors the whole formula. (Bold/italic were dropped — CSS can't bold
  // the TeX math glyphs, so those buttons did nothing on a formula and only confused.)
  useEffect(() => {
    for (const el of [mfRef.current, measureRef.current]) {
      if (!el) continue
      el.style.color = color || ''
    }
    scheduleFit()
  }, [color])

  const bumpFont = (delta: number) => {
    setFontSize((f) => {
      const next = Math.max(MIN_FONT, Math.min(MAX_FONT, f + delta))
      fontRef.current = next
      if (idRef.current && mfRef.current) requestFormulaSave(idRef.current, mfRef.current.value, next)
      return next
    })
  }

  const cancelHide = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
    setHovered(true)
  }
  const scheduleHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setHovered(false), 250)
  }

  const applyStyle = (patch: Record<string, unknown>) => {
    if (idRef.current) requestFormulaStyle(idRef.current, patch)
  }
  const del = () => {
    if (idRef.current) requestFormulaDelete(idRef.current)
  }
  const pickColor = (c: string) => {
    setColor(c)
    applyStyle({ color: c })
  }
  const sep = <span className="octo-mf-sep" />
  // A flat toolbar button (Univer-like). pointerdown+stopPropagation so Univer's global pointer
  // handling can't steal the click (which otherwise selects the cell underneath instead of acting).
  const actBtn = (onDown: () => void, active: boolean, node: ReactNode, key: string, title?: string) => (
    <button
      key={key}
      type="button"
      title={title}
      className={active ? 'active' : undefined}
      onPointerDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onDown()
      }}
    >
      {node}
    </button>
  )

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* MathLive is appended here imperatively; this div has no JSX children so React leaves it alone. */}
      <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
      {/* Toolbar PORTALED to <body> so Univer's canvas/selection layers can't clip or cover it. Shown on
          hover OR while editing, positioned to the right of the formula. Flat Univer-style buttons; all
          actions are local-state-first (instant) AND persisted, so they don't depend on Univer re-passing
          props back to this component. */}
      {(focused || hovered) &&
        barPos &&
        createPortal(
          <div
            className="octo-mf-tb octo-theme"
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ position: 'fixed', left: barPos.left, top: barPos.top, zIndex: 99999, whiteSpace: 'nowrap' }}
          >
            {actBtn(() => bumpFont(-2), false, 'A⁻', 'zoom-out', t('docs.sheet.formula.zoomOut'))}
            {actBtn(() => bumpFont(2), false, 'A⁺', 'zoom-in', t('docs.sheet.formula.zoomIn'))}
            {sep}
            {/* Text color: a single "A" with a colored underline + caret; the palette folds into a popover. */}
            {actBtn(
              () => setColorOpen((v) => !v),
              colorOpen,
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}>
                  <span style={{ fontSize: 13 }}>A</span>
                  <span style={{ width: 14, height: 3, borderRadius: 1, background: color || '#1f2329', marginTop: 1 }} />
                </span>
                <CaretGlyph />
              </span>,
              'color',
              t('docs.sheet.formula.textColor'),
            )}
            {sep}
            {actBtn(del, false, <DeleteGlyph />, 'delete', t('docs.sheet.formula.delete'))}
          </div>,
          document.body,
        )}
      {/* Color palette popover — folds out of the "A" button, portaled below the toolbar. Full 60-color
          grid + a native "更多颜色" picker for any custom color, matching the cell color picker's range. */}
      {(focused || hovered) &&
        colorOpen &&
        barPos &&
        createPortal(
          <ConfigProvider mountContainer={document.body} locale={designLocale()}>
            <div
              className="octo-theme"
              onMouseEnter={cancelHide}
              onMouseLeave={scheduleHide}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                position: 'fixed',
                left: barPos.left,
                top: barPos.top + 40,
                zIndex: 99999,
                background: 'var(--octo-bg,#fff)',
                border: '1px solid var(--octo-border,#dcdfe5)',
                borderRadius: 8,
                boxShadow: '0 6px 20px rgba(0,0,0,0.16)',
                padding: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                width: 'max-content',
              }}
            >
              {/* The SAME @univerjs/design ColorPicker the sheet's "开始" tab uses — a compact rounded
                  palette + 更多颜色 + 重置颜色 — so the formula colour picker is unified with it. */}
              <ColorPicker
                format="hex"
                value={color || '#000000'}
                onChange={(c) => {
                  pickColor(c)
                  setColorOpen(false)
                }}
              />
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  pickColor('')
                  setColorOpen(false)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  border: '1px solid var(--octo-border,#e5e6eb)',
                  borderRadius: 6,
                  background: 'var(--octo-bg,#fff)',
                  color: 'var(--octo-fg,#1f2329)',
                  fontSize: 12,
                  padding: '6px 8px',
                  cursor: 'pointer',
                }}
              >
                {t('docs.toolbar.clearColor')}
              </button>
            </div>
          </ConfigProvider>,
          document.body,
        )}
    </div>
  )
}
