/**
 * Math rendering for PDF export — plain selectable text (no SVG, no image).
 *
 * Per 小吴's decision, formulas must NOT be vector SVG or raster images; the
 * whole PDF should be selectable/searchable text. jsPDF can't typeset LaTeX,
 * so we convert LaTeX to a best-effort Unicode string: Greek letters, common
 * operators (∑ ∫ √ × ⋅ ≤ ≥ ≠ → ∞ …), and Unicode super/subscripts. This keeps
 * math as real text (selectable, copyable, searchable) rendered with the CJK
 * font, at the cost of complex layout (nested fractions, big matrices) which
 * degrade to a readable linear form.
 *
 * Everything stays client-side; no MathJax / svg2pdf / font embedding.
 */

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ',
  varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ',
  varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
}

const SYMBOLS: Record<string, string> = {
  times: '×', div: '÷', pm: '±', mp: '∓', cdot: '⋅', ast: '∗', star: '⋆',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈',
  equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝',
  sum: '∑', prod: '∏', int: '∫', iint: '∬', iiint: '∭', oint: '∮',
  infty: '∞', partial: '∂', nabla: '∇', forall: '∀', exists: '∃',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', supset: '⊃', subseteq: '⊆',
  supseteq: '⊇', cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅',
  rightarrow: '→', to: '→', leftarrow: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', mapsto: '↦',
  langle: '⟨', rangle: '⟩', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋',
  cdots: '⋯', ldots: '…', dots: '…', vdots: '⋮', ddots: '⋱',
  prime: '′', circ: '∘', bullet: '•', oplus: '⊕', otimes: '⊗',
  wedge: '∧', vee: '∨', neg: '¬', angle: '∠', perp: '⊥', parallel: '∥',
  degree: '°', deg: '°', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ',
  aleph: 'ℵ', surd: '√', top: '⊤', bot: '⊥',
  quad: '  ', qquad: '    ', ',': ' ', ';': ' ', ':': ' ', '!': '',
  left: '', right: '', displaystyle: '', textstyle: '', limits: '', nolimits: '',
}

const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶',
  '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽',
  ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ', 'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ', 'x': 'ˣ',
}
const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆',
  '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍',
  ')': '₎', 'a': 'ₐ', 'e': 'ₑ', 'i': 'ᵢ', 'j': 'ⱼ', 'n': 'ₙ', 'x': 'ₓ',
  'o': 'ₒ', 't': 'ₜ',
}

/** Map each char of a script body to Unicode super/subscript; '' if any char unsupported. */
function toScript(body: string, table: Record<string, string>): string | null {
  let out = ''
  for (const ch of body) {
    const m = table[ch]
    if (m === undefined) return null
    out += m
  }
  return out
}

/**
 * Convert a LaTeX formula to a best-effort Unicode text string.
 * Never throws; unknown constructs are left in a readable linear form.
 */
export function latexToUnicode(latex: string): string {
  let s = latex

  // \frac{a}{b} -> (a)/(b)  (do a few passes for simple nesting)
  const fracRe = /\\d?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g
  for (let i = 0; i < 4 && fracRe.test(s); i++) {
    s = s.replace(/\\d?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)')
  }

  // \sqrt{x} -> √(x) ; \sqrt[n]{x} -> ⁿ√(x)
  s = s.replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, (_m, n, x) => `${toScript(n, SUP) ?? n}√(${x})`)
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)')

  // \text{...} / \mathrm{...} / \mathbf{...} -> inner
  s = s.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\s*\{([^{}]*)\}/g, '$1')

  // Greek + symbols (\name)
  s = s.replace(/\\([A-Za-z]+)/g, (m, name) => {
    if (GREEK[name] !== undefined) return GREEK[name]
    if (SYMBOLS[name] !== undefined) return SYMBOLS[name]
    return name // unknown command: drop backslash, keep name
  })
  // Backslash-punct symbols (\, \; \! etc.) handled above via SYMBOLS keys.
  s = s.replace(/\\([,;:!])/g, (_m, p) => SYMBOLS[p] ?? '')

  // Superscripts: ^{...} or ^x
  s = s.replace(/\^\{([^{}]*)\}/g, (m, body) => {
    const sc = toScript(body, SUP)
    return sc ?? `⟨sup:${body}⟩`
  })
  s = s.replace(/\^(\S)/g, (m, ch) => SUP[ch] ?? `^${ch}`)
  // Subscripts: _{...} or _x
  s = s.replace(/_\{([^{}]*)\}/g, (m, body) => {
    const sc = toScript(body, SUB)
    return sc ?? `⟨sub:${body}⟩`
  })
  s = s.replace(/_(\S)/g, (m, ch) => SUB[ch] ?? `_${ch}`)
  // Resolve un-scriptable script placeholders to a caret/underscore form.
  s = s.replace(/⟨sup:([^⟨⟩]*)⟩/g, '^($1)')
  s = s.replace(/⟨sub:([^⟨⟩]*)⟩/g, '_($1)')

  // Strip remaining braces
  s = s.replace(/[{}]/g, '')
  // Collapse excess whitespace
  s = s.replace(/\s+/g, ' ').trim()
  return s
}
