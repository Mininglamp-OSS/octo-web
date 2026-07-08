/**
 * Runtime de-brand of the two Excalidraw surfaces that have NO public i18n / composition seam in
 * @excalidraw/excalidraw 0.18.1 (XIN-531 items 3 & 4):
 *
 *   - the "更多工具 → Mermaid 至 Excalidraw" dropdown item (`toolBar.mermaidToExcalidraw`), and
 *   - the Mermaid dialog title + description (`mermaid.title` / `mermaid.description`).
 *
 * Why not i18n override: 0.18.1 exposes no way to override individual translations. `t()` reads a
 * module-private `currentLangData`, and there is no `langData` prop or setter on the public API.
 * The mermaid menu item is rendered inside Excalidraw's own shapes toolbar and the mermaid dialog
 * is a built-in modal, so neither is reachable via props/children the way the main menu (item 1,
 * custom `<MainMenu>`) or the help-dialog buttons (item 2, scoped CSS) are. Patching the vendored
 * source is explicitly out of scope. So for these two surfaces we localize the rendered text in
 * place: a subtree MutationObserver watches for the specific nodes and rewrites the upstream brand
 * token to the product word "画布" as they appear.
 *
 * The rewrite is text-only and idempotent: only bare "Excalidraw" tokens inside the three
 * mermaid-specific containers are swapped, element structure (e.g. the description's flowchart /
 * sequence / class highlight links) is preserved, and a node with no remaining token is left
 * untouched — so re-processing the same node, or observing the mutations this makes, never
 * compounds.
 */

/** Product word that replaces the upstream "Excalidraw" brand in the localized whiteboard UI. */
export const BOARD_BRAND = '画布'

/**
 * Swap the bare "Excalidraw" brand token in a mermaid-surface string for the product word. Handles
 * both the localized ("Mermaid 至 Excalidraw", "…在 Excalidraw 中…") and English ("Mermaid to
 * Excalidraw") forms. A string with no token is returned unchanged, so callers can treat this as a
 * cheap no-op and re-run it safely.
 */
export function debrandMermaidText(text: string): string {
  return text.includes('Excalidraw') ? text.replace(/Excalidraw/g, BOARD_BRAND) : text
}

// Mermaid-specific selectors. Scoped narrowly on purpose: other "Excalidraw" mentions (export
// dialog "Excalidraw+", the "Excalidraw 素材库" library, the welcome screen) are NOT in scope and
// must stay branded, so we never touch text outside these containers.
const MENU_ITEM_SELECTOR = '.dropdown-menu-item__text'
const DIALOG_TARGET_SELECTOR = '.dialog-mermaid-title, .ttd-dialog-desc'

/**
 * Rewrite the brand token in the DIRECT text nodes of `el`, leaving child elements untouched. The
 * mermaid description renders its highlight links as child `<a>` elements around the "flowchart /
 * sequence / class" words, so touching only `el`'s own text nodes keeps those links intact.
 */
function debrandTextNodes(el: Element): void {
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const original = node.nodeValue ?? ''
      const next = debrandMermaidText(original)
      if (next !== original) node.nodeValue = next
    }
  })
}

/** True for a menu label that belongs to the Mermaid item (the only entry carrying the brand). */
function isMermaidMenuLabel(el: Element): boolean {
  return (el.textContent ?? '').includes('Mermaid')
}

/** Apply the mermaid de-brand to every target surface inside (or equal to) `el`. Idempotent. */
function debrandWithin(el: Element): void {
  // Item 3: the "更多工具 → Mermaid 至 Excalidraw" dropdown item. Matched by its "Mermaid" text
  // rather than the data-testid, which Excalidraw shares with the web-embed tool item.
  el.querySelectorAll(MENU_ITEM_SELECTOR).forEach((label) => {
    if (isMermaidMenuLabel(label)) debrandTextNodes(label)
  })
  if (el.matches(MENU_ITEM_SELECTOR) && isMermaidMenuLabel(el)) debrandTextNodes(el)

  // Item 4: mermaid dialog title + description.
  el.querySelectorAll(DIALOG_TARGET_SELECTOR).forEach(debrandTextNodes)
  if (el.matches(DIALOG_TARGET_SELECTOR)) debrandTextNodes(el)
}

/**
 * Start localizing the mermaid surfaces under `root` and return a disposer. Excalidraw renders the
 * toolbar menu inside the canvas and its dialogs into `document.body` portals, so a subtree
 * observer on the document body catches both whenever they open. Runs once immediately for
 * anything already mounted, then on every subtree insertion.
 */
export function installExcalidrawDebrand(root: Document | HTMLElement = document): () => void {
  const host = root instanceof Document ? root.body : root
  if (!host || typeof MutationObserver === 'undefined') return () => {}

  debrandWithin(host)

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) debrandWithin(node as Element)
      })
    }
  })
  observer.observe(host, { childList: true, subtree: true })

  return () => observer.disconnect()
}
