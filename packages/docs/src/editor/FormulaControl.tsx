// Formula insert control (WPS/sheet parity). ONE π-button that opens a rich picker — a scrollable
// list of preset formulas, each rendered as a live (read-only) MathLive preview card; clicking a
// card inserts it as block math. A pinned footer reveals a raw-LaTeX input for a custom formula.
//
// This mirrors the SHEET's own π-button FormulaPicker (packages/docs/src/sheet/floatDom/FormulaPicker
// .tsx) and reuses the SAME preset source (FORMULA_PRESETS) so docs and sheet offer identical
// formulas with the same previews — replacing the old two ∑ / ∑▤ text-glyph buttons that looked
// nothing like the sheet. Insertion goes through docs' own insertBlockMath command (TipTap), so the
// document/schema/exporters are unchanged.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MathfieldElement } from 'mathlive'
import type { Editor } from '@tiptap/core'
import { Tooltip } from '@univerjs/design'
import { t } from '../octoweb/index.ts'
import { FORMULA_PRESETS } from '../sheet/floatDom/formulaPresets.ts'
import { LatexInputModal } from '../sheet/floatDom/LatexInputModal.tsx'

/** One read-only MathLive render (no keyboard, no interaction) used as a preview thumbnail — the same
 * approach the sheet's FormulaPicker uses so the cards render identically. */
function MathPreview({ latex, fontSize = 18 }: { latex: string; fontSize?: number }) {
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
  return <div className="octo-formula-preview" ref={hostRef} />
}

/** π glyph + dropdown chevron, matching the sheet ribbon's PiIcon so the formula buttons read like
 * the sheet's. `kind` only tweaks the glyph slightly (block wraps π in a thin box to read as a
 * standalone display equation; inline leaves it bare) — everything else about the two buttons and
 * their dropdowns is identical. */
function PiGlyph({ kind }: { kind: 'inline' | 'block' }) {
  return (
    <span className={`octo-formula-pi octo-formula-pi--${kind}`} aria-hidden="true">
      <span className="octo-formula-pi-char">π</span>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M11.3536 6.14645C11.5488 6.34171 11.5488 6.65829 11.3536 6.85355L8.35355 9.85355C8.15829 10.0488 7.84171 10.0488 7.64645 9.85355L4.64645 6.85355C4.45118 6.65829 4.45118 6.34171 4.64645 6.14645C4.84171 5.95118 5.15829 5.95118 5.35355 6.14645L8 8.79289L10.6464 6.14645C10.8417 5.95118 11.1583 5.95118 11.3536 6.14645Z"
          fill="currentColor"
        />
      </svg>
    </span>
  )
}

/**
 * Formula insert control. Two toolbar buttons use it — one inserts INLINE math, one BLOCK math —
 * but both open the SAME rich π-picker (preset preview cards + a LaTeX input), so they look and
 * behave identically apart from the button glyph and where the picked formula lands. `kind` selects
 * the insert command (insertInlineMath vs insertBlockMath) and the tooltip/glyph.
 */
export function FormulaControl({ editor, kind }: { editor: Editor; kind: 'inline' | 'block' }) {
  const [open, setOpen] = useState(false)
  // Which builder modal is open: null = none, 'builder' = full symbol palette, 'raw' = LaTeX box only.
  // Both use the SAME sheet component (LatexInputModal), so docs' formula editor is identical to the
  // sheet's rather than a bare text input.
  const [modal, setModal] = useState<null | 'builder' | 'raw'>(null)
  const ref = useRef<HTMLSpanElement>(null)

  // Close on outside-click / Escape, like the colour picker and link popovers. Skip while the modal
  // is open (the modal has its own overlay + Esc handling; a stray outside-click there mustn't also
  // collapse the picker underneath).
  useEffect(() => {
    if (!open || modal) return
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
  }, [open, modal])

  function insert(raw: string, fontSize?: number) {
    const v = raw.trim()
    if (v) {
      // Thread the modal's chosen font size into the node's fontSize attr (parity with the sheet path,
      // which honors LatexInputModal's size). A bare number → px via the NodeView's toCssSize.
      const attrs: { latex: string; fontSize?: string } = { latex: v }
      if (fontSize) attrs.fontSize = String(fontSize)
      if (kind === 'inline') editor.chain().focus().insertInlineMath(attrs).run()
      else editor.chain().focus().insertBlockMath(attrs).run()
    }
    setModal(null)
    setOpen(false)
  }

  const title = t(kind === 'inline' ? 'docs.toolbar.mathInline' : 'docs.toolbar.mathBlock')

  return (
    <span className="octo-color-control octo-formula-control" ref={ref}>
      <Tooltip title={title} asChild>
        <button
          type="button"
          className={'octo-tb-btn octo-formula-btn' + (open ? ' is-active' : '')}
          aria-label={title}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
        >
          <PiGlyph kind={kind} />
        </button>
      </Tooltip>
      {open && (
        <span className="octo-color-popover octo-formula-popover" role="dialog">
          <span className="octo-formula-list">
            {FORMULA_PRESETS.map((p) => (
              <span key={p.key} className="octo-formula-item">
                <span className="octo-formula-item-label">{t(p.key)}</span>
                <button
                  type="button"
                  className="octo-formula-card"
                  title={t(p.key)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(p.latex)}
                >
                  <MathPreview latex={p.latex} />
                </button>
              </span>
            ))}
          </span>
          {/* Footer: the two builders, matching the sheet's FormulaPicker — 插入新公式 opens the full
              symbol/structure palette, LaTeX 公式 opens the raw-LaTeX box. Both are the sheet's own
              LatexInputModal, so the editor is byte-identical to the table's. */}
          <span className="octo-formula-footer">
            <button
              type="button"
              className="octo-formula-footer-row"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false)
                setModal('builder')
              }}
            >
              <span className="octo-formula-fx" aria-hidden="true">
                √x
              </span>
              {t('docs.sheet.formula.newFormula')}
            </button>
            <button
              type="button"
              className="octo-formula-footer-row"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setOpen(false)
                setModal('raw')
              }}
            >
              <span className="octo-formula-fx" aria-hidden="true">
                √x
              </span>
              {t('docs.sheet.formula.latex')}
            </button>
          </span>
        </span>
      )}
      {modal &&
        createPortal(
          // Portal to <body>: .octo-toolbar-wrap carries a `transform`, which makes it the containing
          // block for position:fixed descendants — rendering the modal in-place pinned its "fixed"
          // overlay to the toolbar (it flew to the top of the page). At body level the overlay
          // centers on the viewport like the sheet's.
          <LatexInputModal
            initialLatex=""
            showPalette={modal === 'builder'}
            showFontSize={false}
            onConfirm={(latex, fontSize) => insert(latex, fontSize)}
            onCancel={() => setModal(null)}
          />,
          document.body,
        )}
    </span>
  )
}
