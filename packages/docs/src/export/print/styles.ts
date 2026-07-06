/**
 * Print-only styling for the native `window.print()` PDF export path.
 *
 * Strategy:
 *  - On screen: the print root is fully hidden (it exists only to be printed).
 *  - Under `@media print`: hide the entire app, show ONLY the print root, and
 *    let the browser paginate the already-rendered KaTeX + prose content.
 *
 * We deliberately keep the editor's own prose/KaTeX CSS in charge of the
 * actual glyph layout (that is what guarantees pixel-perfect formula spacing);
 * this file only handles page geometry, visibility toggling, and page-break
 * safety so formulas / code blocks / table rows don't split awkwardly.
 */

/** DOM id of the injected print stylesheet. */
export const PRINT_STYLE_ID = 'octo-print-style'
/** DOM id of the transient print root container. */
export const PRINT_ROOT_ID = 'octo-print-root'

/** Build the print-only CSS string. */
export function buildPrintCss(): string {
  return `
/* ---- Screen: print root is invisible and out of flow ---- */
#${PRINT_ROOT_ID} {
  display: none;
}

/* ---- Print: only the print root is visible ---- */
@media print {
  /* A4 with comfortable margins (matches the jsPDF path's ~20mm feel). */
  @page {
    size: A4;
    margin: 18mm 16mm;
  }

  html, body {
    background: #fff !important;
    margin: 0 !important;
    padding: 0 !important;
  }

  /* Hide everything, then reveal only the print root subtree. */
  body > *:not(#${PRINT_ROOT_ID}) {
    display: none !important;
  }

  #${PRINT_ROOT_ID} {
    display: block !important;
    position: static !important;
    width: 100% !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    color: #000 !important;
    box-shadow: none !important;
  }

  #${PRINT_ROOT_ID} .octo-prose {
    max-width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
  }

  /* Ensure backgrounds/colors (code blocks, table headers, callouts) print. */
  #${PRINT_ROOT_ID} * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  /* ---- Page-break safety ---- */

  /* Never split a formula across pages. */
  #${PRINT_ROOT_ID} .katex,
  #${PRINT_ROOT_ID} .katex-display {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  /* Keep code blocks and table rows intact where possible. */
  #${PRINT_ROOT_ID} pre,
  #${PRINT_ROOT_ID} tr,
  #${PRINT_ROOT_ID} img,
  #${PRINT_ROOT_ID} blockquote {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  /* Headings shouldn't be orphaned at the bottom of a page. */
  #${PRINT_ROOT_ID} h1,
  #${PRINT_ROOT_ID} h2,
  #${PRINT_ROOT_ID} h3,
  #${PRINT_ROOT_ID} h4 {
    break-after: avoid;
    page-break-after: avoid;
  }

  /* Repeat table headers on each printed page. */
  #${PRINT_ROOT_ID} thead {
    display: table-header-group;
  }

  /* Emoji atoms are inline unicode glyphs: <span data-type="emoji">glyph</span>.
     Some print pipelines fall back to a text font lacking emoji coverage,
     which drops emoji inside table cells / callouts. Force a color-emoji font
     stack so they always render. */
  #${PRINT_ROOT_ID} span[data-type="emoji"] {
    font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'Twemoji Mozilla', sans-serif !important;
    font-style: normal !important;
    line-height: 1;
  }
}
`.trim()
}
