// Common formula presets shown in the formula picker (the π-button dropdown). Each has an i18n key
// for its section label (docs.sheet.formula.*) and the LaTeX rendered as a live preview + inserted on
// click. Shared so both the ribbon wiring and the React picker use one source of truth.

export interface FormulaPreset {
  /** i18n key under docs.sheet.formula.* for the section label. */
  key: string
  /** LaTeX rendered as preview and inserted when picked. */
  latex: string
}

export const FORMULA_PRESETS: FormulaPreset[] = [
  { key: 'docs.sheet.formula.circleArea', latex: 'A = \\pi r^2' },
  { key: 'docs.sheet.formula.binomial', latex: '(x + a)^n = \\sum_{k=0}^{n} \\binom{n}{k} x^k a^{n-k}' },
  { key: 'docs.sheet.formula.sumExpansion', latex: '(1 + x)^n = 1 + \\frac{nx}{1!} + \\frac{n(n-1)x^2}{2!} + \\cdots' },
  { key: 'docs.sheet.formula.fourier', latex: 'f(x) = a_0 + \\sum_{n=1}^{\\infty}\\left(a_n\\cos\\frac{n\\pi x}{L} + b_n\\sin\\frac{n\\pi x}{L}\\right)' },
  { key: 'docs.sheet.formula.pythagorean', latex: 'a^2 + b^2 = c^2' },
  { key: 'docs.sheet.formula.quadratic', latex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}' },
  { key: 'docs.sheet.formula.taylor', latex: 'e^x = 1 + \\frac{x}{1!} + \\frac{x^2}{2!} + \\frac{x^3}{3!} + \\cdots' },
  { key: 'docs.sheet.formula.trig1', latex: '\\sin\\alpha \\pm \\sin\\beta = 2\\sin\\frac{1}{2}(\\alpha\\pm\\beta)\\cos\\frac{1}{2}(\\alpha\\mp\\beta)' },
  { key: 'docs.sheet.formula.trig2', latex: '\\cos\\alpha + \\cos\\beta = 2\\cos\\frac{1}{2}(\\alpha+\\beta)\\cos\\frac{1}{2}(\\alpha-\\beta)' },
]
