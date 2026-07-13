/**
 * Runtime replacement of the Excalidraw library panel's "..." overflow with explicit, first-class
 * control buttons (XIN-621 item ①).
 *
 * Excalidraw 0.18.1 buries every library control behind a single "..." (overflow) dropdown
 * (`LibraryDropdownMenuButton` → `.library-menu-dropdown-container`). In the empty state that
 * dropdown holds only "打开 / Load" (a local `.excalidrawlib` import); once the library has saved
 * items it also holds "导出到文件 / Save to file" and "清空素材库 / Reset library". A three-dot menu
 * reads as an accident, not an affordance, and there is no prop/composition seam to change the panel
 * layout — `LibraryMenuControlButtons` renders a fixed row. So, exactly like the de-brand pass (see
 * excalidrawDebrand.ts), we act on the rendered DOM: a subtree MutationObserver injects explicit
 * import / save-to-file / reset buttons into the control-buttons row as it mounts, then removes the
 * "..." overflow container. Each click is delegated back to the host (BoardShell), which owns the
 * imperative library API and does the actual file read / serialize / reset.
 *
 * Why all three (not just import): the boss ruling for XIN-621 is that the "..." must go entirely,
 * and any action it held must be surfaced as a visible button rather than silently hidden. The
 * verified 0.18.1 overflow holds exactly import + save-to-file + reset (the online "publish library"
 * item only appears while grid items are drag-selected — an excalidraw.com upload we already strip
 * with the rest of the online surface, so it is intentionally not carried over).
 *
 * The observer is idempotent: each button carries a marker class and is injected once per row, and
 * the overflow removal is a no-op once the container is gone — so re-observing our own insertion (or
 * the de-brand pass removing the sibling online-browse anchor) never adds a duplicate or throws. If
 * React re-renders and re-adds the overflow, the observer simply removes it again.
 */

/** The control-buttons row `LibraryMenuControlButtons` renders (held the "..." dropdown). */
const CONTROL_BUTTONS_SELECTOR = '.library-menu-control-buttons'

/** The "..." overflow container we remove once the explicit buttons are in place. */
const DROPDOWN_CONTAINER_SELECTOR = '.library-menu-dropdown-container'

/** Marker classes on our injected buttons — also the per-row idempotence guards. */
export const IMPORT_BUTTON_CLASS = 'octo-lib-import-btn'
export const SAVE_BUTTON_CLASS = 'octo-lib-save-btn'
export const RESET_BUTTON_CLASS = 'octo-lib-reset-btn'

/** One explicit control: a localized label and the host-owned click handler it delegates to. */
export interface LibraryControlSpec {
  /** Localized button label (resolved by the host so this module stays i18n-free). */
  label: string
  /** Invoked on click — the host drives the imperative library API. */
  onClick: () => void
}

export interface LibraryControlButtonsOptions {
  /** "从本地导入 / Import from local" — reads a `.excalidrawlib` and merges it in. */
  import: LibraryControlSpec
  /** "导出到文件 / Save to file" — serializes the current library to a download. */
  save: LibraryControlSpec
  /** "清空素材库 / Reset library" — clears the library (host confirms first). */
  reset: LibraryControlSpec
}

/** Build one styled control button with its marker class and delegated click. */
function makeButton(doc: Document, cls: string, spec: LibraryControlSpec): HTMLButtonElement {
  const btn = doc.createElement('button')
  btn.type = 'button'
  btn.className = cls
  btn.textContent = spec.label
  btn.title = spec.label
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    spec.onClick()
  })
  return btn
}

/**
 * Inject the three explicit controls at the front of a control-buttons row (import → save → reset,
 * ahead of anything Excalidraw put there) and remove the "..." overflow. Guarded on the import
 * marker so the buttons are added once per row; the overflow removal is always attempted so a
 * re-rendered "..." is stripped again.
 */
function injectInto(container: Element, opts: LibraryControlButtonsOptions): void {
  const doc = container.ownerDocument
  if (!doc) return
  if (!container.querySelector(`.${IMPORT_BUTTON_CLASS}`)) {
    const importBtn = makeButton(doc, IMPORT_BUTTON_CLASS, opts.import)
    const saveBtn = makeButton(doc, SAVE_BUTTON_CLASS, opts.save)
    const resetBtn = makeButton(doc, RESET_BUTTON_CLASS, opts.reset)
    // Lead the row in reading order: import, then save, then reset. Inserting each before the same
    // original first child in reverse yields that left-to-right order.
    const first = container.firstChild
    container.insertBefore(resetBtn, first)
    container.insertBefore(saveBtn, resetBtn)
    container.insertBefore(importBtn, saveBtn)
  }
  // Remove the "..." overflow now that its actions are explicit buttons (boss ruling: no "..." at
  // all). Same DOM-removal mechanism the de-brand pass uses for the online browse anchor.
  container.querySelectorAll(DROPDOWN_CONTAINER_SELECTOR).forEach((el) => el.remove())
}

/** Inject into every control-buttons row inside (or equal to) `el`. */
function injectWithin(el: Element, opts: LibraryControlButtonsOptions): void {
  el.querySelectorAll(CONTROL_BUTTONS_SELECTOR).forEach((c) => injectInto(c, opts))
  if (el.matches(CONTROL_BUTTONS_SELECTOR)) injectInto(el, opts)
  // A re-render can re-add the "..." overflow (or another node) INSIDE an existing row, so the added
  // node is a descendant of the row, not the row itself. Walk up to the enclosing row and re-process
  // it so the re-added overflow is stripped again.
  const enclosingRow = el.closest?.(CONTROL_BUTTONS_SELECTOR)
  if (enclosingRow) injectInto(enclosingRow, opts)
}

/**
 * Start rewriting the Excalidraw library panel's control row under `root` (inject explicit buttons +
 * remove the "..." overflow) and return a disposer. Runs once for anything already mounted, then on
 * every subtree insertion (the library panel mounts lazily when the user opens it). Mirrors
 * installExcalidrawDebrand's lifecycle so the two DOM passes compose without interfering.
 */
export function installLibraryControlButtons(
  root: Document | HTMLElement = document,
  opts: LibraryControlButtonsOptions,
): () => void {
  const host = root instanceof Document ? root.body : root
  if (!host || typeof MutationObserver === 'undefined') return () => {}

  injectWithin(host, opts)

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) injectWithin(node as Element, opts)
      })
    }
  })
  observer.observe(host, { childList: true, subtree: true })

  return () => observer.disconnect()
}
