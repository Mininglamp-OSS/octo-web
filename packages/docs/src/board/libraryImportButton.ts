/**
 * Runtime injection of an explicit "import from local" button into the Excalidraw library panel
 * (XIN-601 item 1).
 *
 * The library panel's empty state offers no obvious way to bring in a local `.excalidrawlib`: the
 * only entry Excalidraw 0.18.1 renders is the "..." (overflow) dropdown, whose single useful item in
 * the empty state is a "打开 / Open" that opens a file picker. Surfacing a local import behind a
 * three-dot menu reads as an accident, not an affordance. There is no prop/composition seam to
 * change this — `LibraryMenuControlButtons` renders a fixed layout — so, exactly like the de-brand
 * pass (see excalidrawDebrand.ts), we act on the rendered DOM: a subtree MutationObserver injects a
 * first-class button into the control-buttons row as it mounts, and the click is delegated back to
 * the host (BoardShell), which owns the imperative library API and does the actual file read +
 * `updateLibrary`. The existing "..." dropdown is left in place, so save-to-file / reset stay
 * reachable once the library has items — we only make the import entry explicit.
 *
 * The observer is idempotent: the button carries a marker class and is injected once per row, so
 * re-observing our own insertion (or the de-brand pass removing the sibling online-browse anchor)
 * never adds a duplicate.
 */

/** The control-buttons row `LibraryMenuControlButtons` renders (holds the "..." dropdown). */
const CONTROL_BUTTONS_SELECTOR = '.library-menu-control-buttons'

/** Marker class on our injected button — also the idempotence guard. */
export const IMPORT_BUTTON_CLASS = 'octo-lib-import-btn'

export interface LibraryImportButtonOptions {
  /** Localized button label (resolved by the host so this module stays i18n-free). */
  label: string
  /** Invoked on click — opens the local file picker and loads the library (host-owned). */
  onImport: () => void
}

/** Prepend the import button to a control-buttons row, unless one is already there. */
function injectInto(container: Element, opts: LibraryImportButtonOptions): void {
  if (container.querySelector(`.${IMPORT_BUTTON_CLASS}`)) return
  const doc = container.ownerDocument
  if (!doc) return
  const btn = doc.createElement('button')
  btn.type = 'button'
  btn.className = IMPORT_BUTTON_CLASS
  btn.textContent = opts.label
  btn.title = opts.label
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    opts.onImport()
  })
  // First child so the explicit import entry leads the row (ahead of the "..." dropdown).
  container.insertBefore(btn, container.firstChild)
}

/** Inject into every control-buttons row inside (or equal to) `el`. */
function injectWithin(el: Element, opts: LibraryImportButtonOptions): void {
  el.querySelectorAll(CONTROL_BUTTONS_SELECTOR).forEach((c) => injectInto(c, opts))
  if (el.matches(CONTROL_BUTTONS_SELECTOR)) injectInto(el, opts)
}

/**
 * Start injecting the local-import button into the Excalidraw library panel under `root` and return
 * a disposer. Runs once for anything already mounted, then on every subtree insertion (the library
 * panel mounts lazily when the user opens it). Mirrors installExcalidrawDebrand's lifecycle so the
 * two DOM passes compose without interfering.
 */
export function installLibraryImportButton(
  root: Document | HTMLElement = document,
  opts: LibraryImportButtonOptions,
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
