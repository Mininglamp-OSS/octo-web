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

import { useEffect, useRef, useState } from 'react'
import { MathfieldElement } from 'mathlive'
import { requestFormulaSave, requestDrawingBlur } from './formulaBridge.ts'
import { t } from '../../octoweb/index.ts'

/** Component key registered with Univer's ComponentManager (must match on every collaborating client). */
export const OCTO_MATH_FORMULA_KEY = 'octo-math-formula'

/** The persisted per-formula payload (Univer drawing `data`). */
export interface MathFormulaData {
  latex?: string
  id?: string
  fontSize?: number
}

const DEFAULT_FONT = 20
const MIN_FONT = 10
const MAX_FONT = 72

// Global default: never auto-show the virtual keyboard.
try {
  ;(MathfieldElement as unknown as { mathVirtualKeyboardPolicy?: string }).mathVirtualKeyboardPolicy = 'manual'
} catch {
  /* ignore */
}

// Inject ONE global stylesheet that makes MathLive's virtual keyboard impossible to render — both the
// old (.ML__keyboard) and new (.MLK__*) keyboard panels, plus the in-field keyboard/menu toggles.
// display:none is authoritative: even if MathLive flips it "visible", there is nothing to paint.
const KB_KILL_ID = 'octo-mathlive-no-keyboard'
function installKeyboardKill(): void {
  if (typeof document === 'undefined' || document.getElementById(KB_KILL_ID)) return
  const style = document.createElement('style')
  style.id = KB_KILL_ID
  style.textContent = `
    .ML__keyboard,
    .ML__keyboard--visible,
    .MLK__backdrop,
    .MLK__plate,
    [class^="MLK__"] { display: none !important; visibility: hidden !important; }
    math-field::part(virtual-keyboard-toggle),
    math-field::part(menu-toggle) { display: none !important; }
  `
  document.head.appendChild(style)
}

export function MathFormula({ data }: { data?: MathFormulaData }): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const mfRef = useRef<MathfieldElement | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [focused, setFocused] = useState(false)
  const [fontSize, setFontSize] = useState(data?.fontSize ?? DEFAULT_FONT)

  const latex = data?.latex ?? ''
  const id = data?.id ?? ''
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
    // Fill the whole box so a click anywhere inside edits (the border handles belong to Univer).
    mf.style.cssText = `width:100%;height:100%;border:none;background:transparent;font-size:${fontRef.current}px;display:flex;align-items:center;`
    mf.value = latex
    const onInput = () => scheduleSave()
    const onFocusIn = () => {
      // Drop Univer's drawing selection so its keyboard shortcuts (arrows move / Delete removes the
      // drawing) have no target while we're editing — the keys then act inside the formula.
      requestDrawingBlur()
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
    host.appendChild(mf)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      mf.removeEventListener('keydown', stopKeys)
      mf.removeEventListener('keyup', stopKeys)
      mf.removeEventListener('input', onInput)
      mf.removeEventListener('focusin', onFocusIn)
      mf.removeEventListener('focusout', onFocusOut)
      host.removeEventListener('pointerdown', onHostPointerDown)
      if (host.contains(mf)) host.removeChild(mf)
      mfRef.current = null
    }
  }, [])

  // Reflect remote latex changes (skip while locally focused so we don't clobber typing).
  useEffect(() => {
    const mf = mfRef.current
    if (mf && document.activeElement !== mf && mf.value !== latex) mf.value = latex
  }, [latex])

  useEffect(() => {
    const mf = mfRef.current
    if (mf) mf.style.fontSize = `${fontSize}px`
  }, [fontSize])

  const bumpFont = (delta: number) => {
    setFontSize((f) => {
      const next = Math.max(MIN_FONT, Math.min(MAX_FONT, f + delta))
      fontRef.current = next
      if (idRef.current && mfRef.current) requestFormulaSave(idRef.current, mfRef.current.value, next)
      return next
    })
  }

  const toolBtn = {
    border: '1px solid var(--octo-border,#e5e6eb)',
    background: 'var(--octo-bg,#fff)',
    color: 'var(--octo-fg,#1f2329)',
    borderRadius: 4,
    minWidth: 26,
    height: 24,
    fontSize: 13,
    cursor: 'pointer',
    padding: '0 4px',
  } as const

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {focused && (
        // Font-size toolbar above the formula. onMouseDown preventDefault keeps the field focused so
        // a button click resizes instead of blurring.
        <div
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            marginBottom: 4,
            display: 'flex',
            gap: 4,
            padding: 4,
            background: 'var(--octo-bg,#fff)',
            border: '1px solid var(--octo-border,#e5e6eb)',
            borderRadius: 6,
            boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
            zIndex: 10,
            whiteSpace: 'nowrap',
          }}
        >
          <button type="button" title={t('docs.sheet.formula.zoomOut')} style={toolBtn} onClick={() => bumpFont(-2)}>A⁻</button>
          <span style={{ fontSize: 12, minWidth: 30, textAlign: 'center', alignSelf: 'center', color: 'var(--octo-muted,#8a919e)' }}>{fontSize}px</span>
          <button type="button" title={t('docs.sheet.formula.zoomIn')} style={toolBtn} onClick={() => bumpFont(2)}>A⁺</button>
        </div>
      )}
      {/* MathLive is appended here imperatively; this div has no JSX children so React leaves it alone. */}
      <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
