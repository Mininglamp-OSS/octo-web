// The formula picker — the single π-button dropdown (WPS style). A scrollable list of preset formulas,
// each rendered as a live (read-only) MathLive preview inside a card; clicking a card inserts it. A
// pinned footer offers the two builders: 「插入新公式」(structure palette) and 「LaTeX 公式」(raw LaTeX).
//
// Read-only MathLive ⇒ no virtual keyboard here either. Rendered by SheetView, opened from the ribbon
// via formulaBridge.requestFormulaPicker.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MathfieldElement } from 'mathlive'
import { t } from '../../octoweb/index.ts'
import { FORMULA_PRESETS } from './formulaPresets.ts'
import { OCTO_FORMULA_PI_ANCHOR_ID } from './PiIcon.tsx'

/** One read-only MathLive render (no keyboard, no interaction) used as a preview thumbnail. */
function MathPreview({ latex, fontSize = 18 }: { latex: string; fontSize?: number }): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const mf = new MathfieldElement()
    mf.readOnly = true
    try {
      ;(mf as unknown as { mathVirtualKeyboardPolicy?: string }).mathVirtualKeyboardPolicy = 'manual'
    } catch {
      /* ignore */
    }
    mf.style.cssText = `font-size:${fontSize}px;border:none;background:transparent;pointer-events:none;`
    mf.value = latex
    host.appendChild(mf)
    return () => {
      if (host.contains(mf)) host.removeChild(mf)
    }
  }, [latex, fontSize])
  return <div ref={hostRef} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }} />
}

/** Small ƒx glyph shown on the footer rows (mirrors the ribbon's formula icon). */
function FxIcon(): JSX.Element {
  return <span style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif', fontSize: 13, opacity: 0.8 }}>√x</span>
}

export function FormulaPicker({
  onPick,
  onNewFormula,
  onLatex,
  onClose,
}: {
  onPick: (latex: string) => void
  onNewFormula: () => void
  onLatex: () => void
  onClose: () => void
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const PANEL_W = 360
  // Anchor to the π ribbon button: the panel's LEFT edge aligns with the button's left, opening just
  // below it. Measured from the button's DOM rect so it stays put regardless of where the click landed.
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 12, top: 92 })
  useLayoutEffect(() => {
    const el = document.getElementById(OCTO_FORMULA_PI_ANCHOR_ID)
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    setPos({ left: Math.max(8, Math.min(r.left, vw - PANEL_W - 8)), top: r.bottom + 6 })
  }, [])

  const footerRow = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: 13,
    color: 'var(--octo-fg,#1f2329)',
    background: 'transparent',
    border: 'none',
    width: '100%',
    textAlign: 'left' as const,
  }

  return (
    <div
      role="presentation"
      onMouseDown={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: pos.top,
          left: pos.left,
          width: PANEL_W,
          maxHeight: '76vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--octo-bg,#fff)',
          color: 'var(--octo-fg,#1f2329)',
          border: '1px solid var(--octo-border,#e5e6eb)',
          borderRadius: 8,
          boxShadow: '0 12px 40px rgba(0,0,0,0.28)',
          overflow: 'hidden',
        }}
      >
        {/* Scrollable preset list */}
        <div style={{ overflowY: 'auto', padding: '8px 10px', flex: 1 }}>
          {FORMULA_PRESETS.map((p) => (
            <div key={p.key} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--octo-muted,#8a919e)', margin: '0 0 4px 2px' }}>{t(p.key)}</div>
              <button
                type="button"
                onClick={() => onPick(p.latex)}
                title={t(p.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '100%',
                  minHeight: 64,
                  padding: '10px 12px',
                  background: 'var(--octo-card,#fff)',
                  border: '1px solid var(--octo-border,#e5e6eb)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  overflowX: 'auto',
                }}
              >
                <MathPreview latex={p.latex} />
              </button>
            </div>
          ))}
        </div>

        {/* Pinned footer: the two builders */}
        <div style={{ borderTop: '1px solid var(--octo-border,#e5e6eb)', background: 'var(--octo-bg,#fff)' }}>
          <button type="button" style={footerRow} onClick={onNewFormula}>
            <FxIcon />
            {t('docs.sheet.formula.newFormula')}
          </button>
          <button type="button" style={footerRow} onClick={onLatex}>
            <FxIcon />
            {t('docs.sheet.formula.latex')}
          </button>
        </div>
      </div>
    </div>
  )
}
