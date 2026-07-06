/**
 * PDF Export via native browser print (`window.print()` + `@media print`).
 *
 * 小吴's requirements, satisfied by this path:
 *  - Pure frontend, NO backend service (unlike Puppeteer — no Chromium, no
 *    long-running process).
 *  - Formulas render with pixel-perfect spacing because the BROWSER itself
 *    lays out the already-rendered KaTeX DOM — we never re-draw glyphs by hand
 *    (no jsPDF per-character painting, no vector SVG, no bitmap).
 *  - Everything (CJK text, code blocks, tables, formulas) stays SELECTABLE /
 *    searchable in the resulting PDF because it is real HTML text printed by
 *    the browser.
 *
 * Trade-off (accepted): the user picks "Save as PDF" in the native print
 * dialog instead of a fully-automatic one-click download.
 *
 * How it works:
 *  1. Clone the live editor's rendered `.octo-prose` DOM (KaTeX already laid
 *     out inside it).
 *  2. Drop it into a dedicated print root that is hidden on screen and shown
 *     only under `@media print`, while the rest of the app is hidden when
 *     printing.
 *  3. Call `window.print()`. The browser produces the PDF from the exact same
 *     rendered layout the user sees in the editor.
 *  4. Clean up the print root afterwards.
 */

import { PRINT_STYLE_ID, PRINT_ROOT_ID, buildPrintCss } from './styles.ts'

export interface PrintPdfOptions {
  /** Document title, used as the print document title (Save-as-PDF filename hint). */
  title?: string
  /**
   * The live editor content element (`.octo-prose`). Its rendered HTML —
   * including already-laid-out KaTeX — is cloned into the print root.
   */
  source: HTMLElement
}

/** Inject (once) the print-only stylesheet into <head>. */
function ensurePrintStyle(): void {
  if (document.getElementById(PRINT_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = PRINT_STYLE_ID
  style.textContent = buildPrintCss()
  document.head.appendChild(style)
}

/** Remove any stale print root from a previous run. */
function removePrintRoot(): void {
  const stale = document.getElementById(PRINT_ROOT_ID)
  if (stale) stale.remove()
}

/**
 * Export the current document to PDF using the browser's native print dialog.
 *
 * Returns a promise that resolves after the print dialog closes (best-effort;
 * `afterprint` is not guaranteed on every browser, so we also clean up on a
 * fallback timer).
 */
export function exportDocViaPrint(opts: PrintPdfOptions): Promise<void> {
  const { source, title } = opts

  return new Promise<void>((resolve) => {
    ensurePrintStyle()
    removePrintRoot()

    // Build the print root and clone the rendered editor content into it.
    const root = document.createElement('div')
    root.id = PRINT_ROOT_ID
    // Reuse editor theme classes so KaTeX + prose CSS applies identically.
    root.className = 'octo-doc octo-theme octo-print-root'

    const clone = source.cloneNode(true) as HTMLElement
    // The editor's rendered DOM (`ed.view.dom`) is the bare `.ProseMirror`
    // element; the `.octo-prose` class actually lives on the OUTER
    // <EditorContent> wrapper. Nearly all typography rules in styles.css are
    // descendant selectors like `.octo-prose pre`, `.octo-prose blockquote`,
    // `.octo-prose table` — so without `.octo-prose` on the clone, code-block
    // backgrounds, syntax highlight, blockquotes and table styling all drop
    // out of the print. (KaTeX survives because it ships global katex.min.css
    // with no `.octo-prose` prefix.) Add the class so descendant rules match.
    clone.classList.add('octo-prose')
    // Strip interactive/editing artifacts that must not print.
    clone.removeAttribute('contenteditable')
    clone
      .querySelectorAll('[contenteditable]')
      .forEach((el) => el.removeAttribute('contenteditable'))
    // ProseMirror trailing cursor / gap-cursor / selection decorations.
    clone
      .querySelectorAll(
        '.ProseMirror-trailingBreak, .ProseMirror-gapcursor, .ProseMirror-separator, .ProseMirror-widget',
      )
      .forEach((el) => el.remove())

    root.appendChild(clone)
    document.body.appendChild(root)

    // Temporarily override document.title so the Save-as-PDF dialog suggests it.
    const prevTitle = document.title
    if (title && title.trim()) document.title = title.trim()

    let done = false
    const cleanup = (): void => {
      if (done) return
      done = true
      document.title = prevTitle
      removePrintRoot()
      window.removeEventListener('afterprint', onAfterPrint)
      resolve()
    }
    const onAfterPrint = (): void => cleanup()

    window.addEventListener('afterprint', onAfterPrint)

    // Give the browser a tick to apply the injected print CSS + attach the
    // cloned DOM (KaTeX fonts are already loaded in the live editor, so no
    // extra font wait is needed) before opening the dialog.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        // NOTE: window.print() blocks until the dialog is dismissed in most
        // browsers, so `afterprint` is the primary cleanup trigger. We keep a
        // long fallback timer only for browsers that don't fire `afterprint`,
        // set well beyond any realistic "save as PDF" interaction so we never
        // clear the clone out from under an open print dialog.
        try {
          window.print()
        } finally {
          setTimeout(cleanup, 60000)
        }
      })
    })
  })
}
