/**
 * Runtime de-brand of the Excalidraw surfaces that have NO public i18n / composition seam in
 * @excalidraw/excalidraw 0.18.1:
 *
 *   - the four upstream brand link buttons at the top of the Help dialog — Documentation / Blog /
 *     GitHub issues / YouTube (XIN-531 item 2), and
 *   - the "更多工具 → Mermaid 至 Excalidraw" dropdown item (`toolBar.mermaidToExcalidraw`), and
 *   - the Mermaid dialog title + description (`mermaid.title` / `mermaid.description`) (items 3 & 4), and
 *   - the "浏览素材库 / Browse libraries" online entry in the library panel (XIN-557), and
 *   - Excalidraw's built-in collaborator avatar stack (`.UserList__wrapper`), a redundant second
 *     presence display next to the board's own header PresenceBar (XIN-680).
 *
 * Why not i18n override: 0.18.1 exposes no way to override individual translations. `t()` reads a
 * module-private `currentLangData`, and there is no `langData` prop or setter on the public API.
 * The mermaid menu item is rendered inside Excalidraw's own shapes toolbar and the mermaid dialog
 * is a built-in modal, so neither is reachable via props/children the way the main menu (item 1,
 * custom `<MainMenu>`) is. Patching the vendored source is explicitly out of scope. So for these
 * surfaces we act on the rendered DOM in place: a subtree MutationObserver watches for the specific
 * nodes and rewrites the upstream brand token to the product word "画布" (mermaid), hides the
 * brand-button header (help dialog), or removes the node (online browse anchor) as they appear.
 *
 * Why the help-dialog header moved here from scoped CSS: item 2 was first hidden with
 * `.excalidraw .HelpDialog__header { display: none }` in board.css. That FAILED on the real machine
 * (XIN-556). The class name is correct — 0.18.1 does render exactly those four `.HelpDialog__btn`
 * anchors inside `.HelpDialog__header` — but Excalidraw's own `.excalidraw .HelpDialog__header
 * { display: flex }` has the SAME specificity, and its `index.css` is pulled in via a dynamic
 * `import()` (BoardShell) that appends to <head> AFTER the statically-imported board.css. On a
 * specificity tie the later stylesheet wins, so `flex` beat `hidden`. Setting `display: none` as an
 * inline style on the node sidesteps the cascade entirely and is verifiable in a jsdom test (a CSS
 * cascade is not), so the observer is the reliable mechanism; board.css keeps a higher-specificity
 * rule only as a no-flash first paint layer.
 *
 * The library browse entry is the same story: `LibraryMenuControlButtons` unconditionally renders
 * `LibraryMenuBrowseButton` — an `<a class="library-menu-browse-button">` whose `href` points at
 * `VITE_APP_LIBRARY_URL` (excalidraw.com's hosted library) and opens `target="_excalidraw_libraries"`.
 * There is no prop to suppress it, so we strip the anchor at runtime with the same observer. The
 * local library controls are handled separately: installLibraryControlButtons (libraryControlButtons.ts)
 * replaces the "..." overflow (load/import, save-to-file, reset) with explicit buttons in the same
 * row (XIN-621 ①); this de-brand pass only removes the online browse anchor. The add-selection-to-
 * library button and the saved-item grid (click/drag-out reuse) live elsewhere in the panel and are
 * left intact.
 *
 * The mermaid rewrite is text-only and idempotent: only bare "Excalidraw" tokens inside the three
 * mermaid-specific containers are swapped, and a node with no remaining token is left untouched — so
 * re-processing the same node, or observing the mutations this makes, never compounds. The
 * description additionally has its flowchart / sequence / class highlight anchors flattened to plain
 * text (XIN-698): upstream renders those three words as external `<a>` links to the mermaid docs, and
 * the product wants them as plain, non-clickable words, so each anchor is replaced by a text node
 * carrying its text — the wording and sentence stay intact, only the link is dropped. This too is
 * idempotent: once the anchors are gone the query matches nothing. Hiding the help header is
 * likewise idempotent (inline `display: none` re-applied only when unset) and node-preserving — we
 * never remove the node, so Excalidraw's React tree can still unmount the dialog cleanly. The anchor
 * removal is a no-op once the anchor is gone.
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
// dialog "Excalidraw+", the "Excalidraw 素材库" library, the welcome screen) are NOT rewritten and
// must stay branded, so we never touch text outside these containers.
const MENU_ITEM_SELECTOR = '.dropdown-menu-item__text'
const DIALOG_TARGET_SELECTOR = '.dialog-mermaid-title, .ttd-dialog-desc'

// The mermaid description container alone (a subset of DIALOG_TARGET_SELECTOR). Its flowchart /
// sequence / class highlight anchors are flattened to plain text (XIN-698); the title carries no
// such links, so anchor flattening is scoped to the description only.
const DIALOG_DESC_SELECTOR = '.ttd-dialog-desc'

// Help-dialog brand header (item 2): the container holding the four `.HelpDialog__btn` link buttons
// (Documentation / Blog / GitHub issues / YouTube). The shortcut lists rendered below it live in a
// sibling `.HelpDialog__islands-container`, so hiding only the header removes exactly those four
// buttons and never touches the shortcut reference the product keeps.
const HELP_DIALOG_HEADER_SELECTOR = '.HelpDialog__header'

// The online "浏览素材库 / Browse libraries" anchor rendered by `LibraryMenuBrowseButton`. This is
// the ONLY online-library entry; the local dropdown, add-to-library button, and saved-item grid do
// not carry this class, so removing it leaves every local capability intact.
const LIBRARY_BROWSE_BUTTON_SELECTOR = '.library-menu-browse-button'

// Excalidraw's built-in collaborator avatar stack (XIN-680). It renders in the canvas top-right
// zone (`.layer-ui__wrapper__top-right`), by the 素材库 library controls, from appState.collaborators
// — the same data that draws the remote cursors. The board already shows the canonical presence
// display in its own header (PresenceBar), so this is a redundant second collaborator display. We
// hide the wrapper (leaving the node so Excalidraw's React tree still reconciles it, and cursors —
// canvas-drawn, not part of this DOM — stay); the count badge on the collab button goes with it.
const COLLABORATOR_USERLIST_SELECTOR = '.UserList__wrapper'

/**
 * Hide an element via an inline `display: none`. Inline style beats any stylesheet rule regardless
 * of load order (the tie that let the CSS-only attempt fail — see the module doc), and leaving the
 * node in place keeps Excalidraw's React tree able to reconcile/unmount it. Idempotent: only writes
 * when the node is not already hidden.
 */
function hideElementInline(el: Element): void {
  if (el instanceof HTMLElement && el.style.display !== 'none') {
    el.style.display = 'none'
  }
}

/**
 * Rewrite the brand token in the DIRECT text nodes of `el`, leaving child elements untouched. Used
 * for the menu label and the mermaid title/description; touching only `el`'s own text nodes keeps
 * any child elements (e.g. the mermaid menu icon) intact. The description's highlight anchors are
 * handled separately by flattenDescriptionLinks.
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

/**
 * Flatten the highlight anchors inside the mermaid description to plain text (XIN-698). Upstream
 * renders the 流程图 / 序列图 / 类图 (flowchart / sequence / class diagram) words as external `<a>`
 * links to the mermaid docs; the product wants them as plain, non-clickable words. Each anchor is
 * replaced by a text node carrying its text, so the wording and sentence stay intact and only the
 * link is dropped. Idempotent: once the anchors are gone the query matches nothing.
 */
function flattenDescriptionLinks(el: Element): void {
  el.querySelectorAll('a').forEach((anchor) => {
    const doc = anchor.ownerDocument ?? document
    anchor.replaceWith(doc.createTextNode(anchor.textContent ?? ''))
  })
}

/** True for a menu label that belongs to the Mermaid item (the only entry carrying the brand). */
function isMermaidMenuLabel(el: Element): boolean {
  return (el.textContent ?? '').includes('Mermaid')
}

/**
 * Remove the online "browse libraries" anchor(s) inside (or equal to) `el` (XIN-557). Only the
 * `library-menu-browse-button` anchor is removed; sibling local controls are left in place. A no-op
 * once the anchor is gone, so re-running or observing the removal never compounds.
 */
function removeOnlineLibraryEntry(el: Element): void {
  el.querySelectorAll(LIBRARY_BROWSE_BUTTON_SELECTOR).forEach((anchor) => anchor.remove())
  if (el.matches(LIBRARY_BROWSE_BUTTON_SELECTOR)) el.remove()
}

/** Apply every de-brand operation to the target surfaces inside (or equal to) `el`. Idempotent. */
function debrandWithin(el: Element): void {
  // Item 2: hide the four upstream brand link buttons at the top of the Help dialog.
  el.querySelectorAll(HELP_DIALOG_HEADER_SELECTOR).forEach(hideElementInline)
  if (el.matches(HELP_DIALOG_HEADER_SELECTOR)) hideElementInline(el)

  // XIN-680: hide Excalidraw's redundant built-in collaborator avatar stack (canvas top-right, by
  // 素材库). The board's own header PresenceBar is the canonical display; cursors are unaffected.
  el.querySelectorAll(COLLABORATOR_USERLIST_SELECTOR).forEach(hideElementInline)
  if (el.matches(COLLABORATOR_USERLIST_SELECTOR)) hideElementInline(el)

  // Item 3: the "更多工具 → Mermaid 至 Excalidraw" dropdown item. Matched by its "Mermaid" text
  // rather than the data-testid, which Excalidraw shares with the web-embed tool item.
  el.querySelectorAll(MENU_ITEM_SELECTOR).forEach((label) => {
    if (isMermaidMenuLabel(label)) debrandTextNodes(label)
  })
  if (el.matches(MENU_ITEM_SELECTOR) && isMermaidMenuLabel(el)) debrandTextNodes(el)

  // Item 4: mermaid dialog title + description.
  el.querySelectorAll(DIALOG_TARGET_SELECTOR).forEach(debrandTextNodes)
  if (el.matches(DIALOG_TARGET_SELECTOR)) debrandTextNodes(el)

  // XIN-698: flatten the description's flowchart / sequence / class highlight anchors to plain text.
  el.querySelectorAll(DIALOG_DESC_SELECTOR).forEach(flattenDescriptionLinks)
  if (el.matches(DIALOG_DESC_SELECTOR)) flattenDescriptionLinks(el)

  // XIN-557: strip the online "浏览素材库 / Browse libraries" entry, keeping local library controls.
  removeOnlineLibraryEntry(el)
}

/**
 * Start de-branding the Excalidraw surfaces under `root` and return a disposer. Excalidraw renders
 * the toolbar menu and library panel inside the canvas and its dialogs (help, mermaid) into
 * `document.body` portals, so a subtree observer on the document body catches all of them whenever
 * they open. Runs once immediately for anything already mounted, then on every subtree insertion.
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
