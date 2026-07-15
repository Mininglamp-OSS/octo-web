// The formula editor — the ONLY place a formula is created or edited. It is deliberately built WITHOUT
// an editable MathLive field, because an editable math-field is what drags MathLive's on-screen virtual
// keyboard onto the page. Instead:
//   • a plain <textarea> holds the raw LaTeX (physical keyboard only),
//   • a palette of buttons inserts structures/symbols at the caret,
//   • a READ-ONLY MathLive element renders a live preview (read-only ⇒ no keyboard),
//   • A⁻ / A⁺ adjust the formula's font size.
// Confirm returns (latex, fontSize); the caller inserts a new formula or updates an existing one.

import { useEffect, useRef, useState } from 'react'
import { MathfieldElement } from 'mathlive'
import { t } from '../../octoweb/index.ts'

const MIN_FONT = 10
const MAX_FONT = 72

// The palette mirrors what MathLive's old virtual keyboard offered — structures (fraction, sub/
// superscript, radical, big operators, matrices, delimiters, decorations), plus operators, Greek
// letters, relations and arrows. Clicking a button inserts its LaTeX at the textarea caret. Templates
// carry empty `{}` slots; insertFrag drops the caret into the first slot so typing continues there.
// `title` and select item labels hold i18n KEYS (docs.sheet.formula.*), resolved via t() at render.
// Symbol glyphs (√, ∑, α…) are language-neutral and stay as literals; only the words are keyed.
const PALETTE_GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'docs.sheet.formula.paletteStructure',
    items: [
      ['𝑎/𝑏', '\\frac{}{}'],
      ['xⁿ', '^{}'],
      ['xₙ', '_{}'],
      ['x_n^m', '_{}^{}'],
      ['√', '\\sqrt{}'],
      ['ⁿ√', '\\sqrt[]{}'],
      ['∑', '\\sum_{}^{}'],
      ['∏', '\\prod_{}^{}'],
      ['∫', '\\int_{}^{}'],
      ['∬', '\\iint_{}'],
      ['∮', '\\oint_{}'],
      ['lim', '\\lim_{}'],
      ['(ⁿₖ)', '\\binom{}{}'],
    ],
  },
  {
    title: 'docs.sheet.formula.paletteBracket',
    items: [
      ['( )', '\\left({}\\right)'],
      ['[ ]', '\\left[{}\\right]'],
      ['{ }', '\\left\\{{}\\right\\}'],
      ['|x|', '\\left|{}\\right|'],
      ['⌈ ⌉', '\\left\\lceil{}\\right\\rceil'],
      ['@docs.sheet.formula.matrix', '\\begin{matrix}{}&{}\\\\{}&{}\\end{matrix}'],
      ['@docs.sheet.formula.pmatrix', '\\begin{pmatrix}{}&{}\\\\{}&{}\\end{pmatrix}'],
      ['@docs.sheet.formula.determinant', '\\begin{vmatrix}{}&{}\\\\{}&{}\\end{vmatrix}'],
      ['@docs.sheet.formula.cases', '\\begin{cases}{}&{}\\\\{}&{}\\end{cases}'],
      ['x⃗', '\\vec{}'],
      ['x̂', '\\hat{}'],
      ['x̄', '\\overline{}'],
      ['ẋ', '\\dot{}'],
    ],
  },
  {
    title: 'docs.sheet.formula.paletteOperator',
    items: [
      ['±', '\\pm '], ['∓', '\\mp '], ['×', '\\times '], ['÷', '\\div '], ['·', '\\cdot '], ['∗', '\\ast '],
      ['≤', '\\leq '], ['≥', '\\geq '], ['≠', '\\neq '], ['≈', '\\approx '], ['≡', '\\equiv '], ['∝', '\\propto '],
      ['≪', '\\ll '], ['≫', '\\gg '], ['∈', '\\in '], ['∉', '\\notin '], ['⊂', '\\subset '], ['⊆', '\\subseteq '],
      ['∪', '\\cup '], ['∩', '\\cap '], ['∀', '\\forall '], ['∃', '\\exists '], ['∇', '\\nabla '], ['∂', '\\partial '],
      ['∞', '\\infty '], ['°', '^\\circ '],
    ],
  },
  {
    title: 'docs.sheet.formula.paletteGreek',
    items: [
      ['α', '\\alpha '], ['β', '\\beta '], ['γ', '\\gamma '], ['δ', '\\delta '], ['ε', '\\epsilon '], ['ζ', '\\zeta '],
      ['η', '\\eta '], ['θ', '\\theta '], ['κ', '\\kappa '], ['λ', '\\lambda '], ['μ', '\\mu '], ['ν', '\\nu '],
      ['ξ', '\\xi '], ['π', '\\pi '], ['ρ', '\\rho '], ['σ', '\\sigma '], ['τ', '\\tau '], ['φ', '\\phi '],
      ['χ', '\\chi '], ['ψ', '\\psi '], ['ω', '\\omega '],
      ['Γ', '\\Gamma '], ['Δ', '\\Delta '], ['Θ', '\\Theta '], ['Λ', '\\Lambda '], ['Π', '\\Pi '], ['Σ', '\\Sigma '],
      ['Φ', '\\Phi '], ['Ψ', '\\Psi '], ['Ω', '\\Omega '],
    ],
  },
  {
    title: 'docs.sheet.formula.paletteArrow',
    items: [
      ['→', '\\rightarrow '], ['←', '\\leftarrow '], ['↔', '\\leftrightarrow '], ['⇒', '\\Rightarrow '],
      ['⇐', '\\Leftarrow '], ['⇔', '\\Leftrightarrow '], ['↦', '\\mapsto '],
      ['sin', '\\sin '], ['cos', '\\cos '], ['tan', '\\tan '], ['log', '\\log '], ['ln', '\\ln '],
    ],
  },
]

export function LatexInputModal({
  initialLatex,
  initialFontSize = 20,
  showPalette = true,
  title,
  onConfirm,
  onCancel,
}: {
  initialLatex: string
  initialFontSize?: number
  /** Show the structure/symbol palette (builder mode). Off = raw-LaTeX box only. */
  showPalette?: boolean
  /** Modal heading; defaults to the generic "插入公式". */
  title?: string
  onConfirm: (latex: string, fontSize: number) => void
  onCancel: () => void
}): JSX.Element {
  const [latex, setLatex] = useState(initialLatex)
  const [fontSize, setFontSize] = useState(initialFontSize)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const mfRef = useRef<MathfieldElement | null>(null)

  // Read-only MathLive as the live preview (read-only ⇒ never shows a virtual keyboard).
  useEffect(() => {
    const host = previewRef.current
    if (!host) return
    const mf = new MathfieldElement()
    mfRef.current = mf
    mf.readOnly = true
    try {
      ;(mf as unknown as { mathVirtualKeyboardPolicy?: string }).mathVirtualKeyboardPolicy = 'manual'
    } catch {
      /* ignore */
    }
    mf.style.cssText = `width:100%;min-height:56px;font-size:${fontSize}px;border:none;background:transparent;pointer-events:none;`
    mf.value = latex
    host.appendChild(mf)
    return () => {
      if (host.contains(mf)) host.removeChild(mf)
      mfRef.current = null
    }
  }, [])

  useEffect(() => {
    if (mfRef.current) mfRef.current.value = latex
  }, [latex])
  useEffect(() => {
    if (mfRef.current) mfRef.current.style.fontSize = `${fontSize}px`
  }, [fontSize])

  // Insert a LaTeX fragment at the textarea caret. For structure templates ("\frac{}{}") we drop the
  // caret between the first empty braces so the user can keep typing the numerator right away.
  const insertFrag = (frag: string) => {
    const ta = taRef.current
    const start = ta?.selectionStart ?? latex.length
    const end = ta?.selectionEnd ?? latex.length
    const next = latex.slice(0, start) + frag + latex.slice(end)
    setLatex(next)
    const brace = frag.indexOf('{}')
    const caret = start + (brace >= 0 ? brace + 1 : frag.length)
    requestAnimationFrame(() => {
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(caret, caret)
    })
  }

  const bumpFont = (delta: number) => setFontSize((f) => Math.max(MIN_FONT, Math.min(MAX_FONT, f + delta)))

  const palBtn = {
    border: '1px solid var(--octo-border,#e5e6eb)',
    background: 'var(--octo-bg,#fff)',
    color: 'var(--octo-fg,#1f2329)',
    borderRadius: 6,
    minWidth: 30,
    height: 30,
    fontSize: 15,
    cursor: 'pointer',
    padding: '0 6px',
  } as const

  return (
    <div
      className="octo-modal-overlay"
      role="presentation"
      onMouseDown={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div
        className="octo-modal octo-theme"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 'min(560px, 94vw)', background: 'var(--octo-bg,#fff)', color: 'var(--octo-fg,#1f2329)', borderRadius: 12, padding: 20, boxShadow: '0 12px 40px rgba(0,0,0,0.2)' }}
      >
        <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>{title ?? t('docs.sheet.latexTitle')}</h3>

        {/* Symbol / structure palette — clicking inserts LaTeX into the textarea below. Grouped +
            scrollable so the full set (like the old virtual keyboard) fits without a huge modal.
            Hidden in raw-LaTeX mode (showPalette=false). */}
        {showPalette && (
        <div style={{ maxHeight: 240, overflowY: 'auto', marginBottom: 10, paddingRight: 4 }}>
          {PALETTE_GROUPS.map((group) => (
            <div key={group.title} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--octo-muted,#8a919e)', margin: '2px 0 4px' }}>{t(group.title)}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {group.items.map(([label, frag]) => {
                  // Labels prefixed with '@' are i18n keys (word labels like 矩阵); bare labels are
                  // language-neutral glyphs (√, ∑, α…) rendered verbatim.
                  const text = label.startsWith('@') ? t(label.slice(1)) : label
                  return (
                    <button key={frag} type="button" style={palBtn} onClick={() => insertFrag(frag)} title={frag.trim()}>
                      {text}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        )}

        <textarea
          ref={taRef}
          value={latex}
          onChange={(e) => setLatex(e.target.value)}
          placeholder="\frac{-b \pm \sqrt{b^2-4ac}}{2a}"
          autoFocus
          spellCheck={false}
          style={{
            width: '100%',
            minHeight: 72,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 13,
            padding: 8,
            border: '1px solid var(--octo-border,#e5e6eb)',
            borderRadius: 8,
            background: 'var(--octo-bg,#fff)',
            color: 'var(--octo-fg,#1f2329)',
            boxSizing: 'border-box',
            resize: 'vertical',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '12px 0 4px' }}>
          <span style={{ fontSize: 12, color: 'var(--octo-muted,#8a919e)' }}>{t('docs.sheet.latexPreview')}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <button type="button" className="octo-tb-btn" title={t('docs.sheet.formula.zoomOut')} onClick={() => bumpFont(-2)}>A⁻</button>
            <span style={{ fontSize: 12, minWidth: 34, textAlign: 'center', color: 'var(--octo-muted,#8a919e)' }}>{fontSize}px</span>
            <button type="button" className="octo-tb-btn" title={t('docs.sheet.formula.zoomIn')} onClick={() => bumpFont(2)}>A⁺</button>
          </span>
        </div>
        <div
          ref={previewRef}
          style={{ minHeight: 56, padding: 8, border: '1px dashed var(--octo-border,#e5e6eb)', borderRadius: 8, overflowX: 'auto', display: 'flex', alignItems: 'center' }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" className="octo-tb-btn" onClick={onCancel}>
            {t('docs.sheet.formulaEditorCancel')}
          </button>
          <button
            type="button"
            className="octo-tb-btn"
            style={{ background: 'var(--octo-accent,#3370ff)', color: '#fff' }}
            onClick={() => onConfirm(latex, fontSize)}
          >
            {t('docs.sheet.formulaEditorOk')}
          </button>
        </div>
      </div>
    </div>
  )
}
