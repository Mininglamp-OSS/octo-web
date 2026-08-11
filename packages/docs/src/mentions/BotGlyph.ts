// The Bot glyph — the one mark that says "this candidate is an agent, not a person".
//
// Traced from the executable-comment prototype's `#i-bot` sprite symbol (a 24×24 line-art robot
// head: rounded body, antenna, two dot eyes, mouth). Kept as an inline, dependency-free SVG string
// rather than a React component because its only consumer builds the suggestion popup with raw DOM
// (the mention menu is deliberately framework-free so it runs headless in jsdom tests).
//
// `stroke="currentColor"` and no `fill` mean it inherits the accent colour from whatever wrapper it
// sits in (`.octo-mention-avatar`, `.octo-version-badge-bot`), so it tracks light/dark automatically.

/** Inline SVG markup for the bot glyph. Sized by CSS; `aria-hidden` — the row's text carries meaning. */
export const BOT_GLYPH_SVG =
  '<svg class="octo-bot-glyph" viewBox="0 0 24 24" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="4" y="6" width="16" height="13" rx="3"></rect>' +
  '<path d="M12 3v3M8 11h.01M16 11h.01M8 15h8"></path>' +
  '</svg>'

/** Build the glyph as a real element (avoids innerHTML at call sites that build DOM directly). */
export function createBotGlyph(): SVGElement {
  const wrap = document.createElement('div')
  wrap.innerHTML = BOT_GLYPH_SVG
  return wrap.firstElementChild as SVGElement
}
