/**
 * nativePanelInject — replace the text-related controls in Excalidraw 0.18.1's own right-side
 * properties panel with the docs surface's shared controls, in place, without patching Excalidraw.
 *
 * ## What it does
 *
 * When at least one `text` element is selected on the whiteboard, Excalidraw renders its own
 * properties panel (`<div class="panelColumn">`) which contains, among other things, a font-size
 * button list (S/M/L/XL), a text-align button list (left/center/right), and a stroke-color picker
 * (which is Excalidraw's stand-in for "text colour" on a text element, because text has no fill).
 * These controls disagree with the shared Doc/Sheet typography surface: the app owns a larger
 * preset-size catalogue and colour palette, plus bold / italic / underline controls that
 * Excalidraw does not expose here.
 *
 * Rather than mount a second floating toolbar (backup/board-floating-toolbar), this installer hides
 * the divergent upstream controls with an inline `display: none` and drops one combined React block
 * at the font-size fieldset's original position — an in-place replacement, so the user still sees a
 * single native-looking panel whose text controls behave exactly like the docs toolbar. The block
 * paints itself with Excalidraw's own CSS variables (see nativePanelInject.css) so it is visually
 * indistinguishable from a native section. Element writes use Excalidraw's live `mutateElement`
 * path and immediate history capture, so versioning and collaboration observe the same mutation as
 * native actions.
 *
 * ## Why a MutationObserver and not a component
 *
 * Excalidraw controls its own panel: React state changes on selection re-render the panel subtree,
 * which unmounts and remounts our injected DOM. A MutationObserver on the Excalidraw container is
 * the only seam that survives every re-render without a private API on the vendor package. We keep
 * the observer scoped to the `.excalidraw` root the caller passes so it never touches DOM outside
 * the whiteboard.
 *
 * ## Stable DOM anchors
 *
 * Excalidraw 0.18.1's action panels ship with these anchors (verified against
 * dist/prod/index.js — `labels.fontSize` / `labels.textAlign` / `labels.stroke` render sites and the
 * `eo` (ButtonList) component):
 *   - font-size fieldset:   `fieldset` containing `button[data-testid="fontSize-small"]` etc.
 *   - text-align fieldset:  `fieldset` containing `button[data-testid="align-left"]` etc.
 *   - stroke color picker:  the FIRST `<div>` inside `.panelColumn` containing
 *                           `.color-picker-container` (upstream renders stroke before background;
 *                           text elements never render the background picker at all).
 *
 * All three anchors survive locale changes because they are `data-testid` values, not i18n text.
 *
 * ## Selection detection — selected AND editing states
 *
 * Excalidraw shows this same `.panelColumn` in two situations for a text element (verified against
 * dist/prod/index.js — `getSelectedElements` / alias `Rb`):
 *
 *     Rb = (elements, appState) =>
 *       appState.editingTextElement ? [appState.editingTextElement]
 *       : appState.newElement      ? [appState.newElement]
 *       : getSelected(elements, appState, { includeBoundTextElement: true })
 *
 *   1. Selected state — the user single-clicked the text box; the element id sits in
 *      `appState.selectedElementIds`.
 *   2. Editing state — the user double-clicked into the text (the boxed panel in the product spec);
 *      Excalidraw drives the panel off `appState.editingTextElement` and typically leaves
 *      `selectedElementIds` empty until the edit is submitted.
 *
 * The panel DOM (fieldset anchors `fontSize-small` / `align-left`, stroke picker) is identical in
 * both states because the same render path produces it, so ONE injection covers both. The injector
 * reads the imperative API on every panel mount and treats the union of `selectedElementIds` and
 * `editingTextElement` as the active text selection. Non-text-only selections keep every upstream
 * control visible — we never hide anything if there is no text element in play, so shape-only edits
 * look and behave exactly like unmodified Excalidraw.
 *
 * ## Cleanup contract
 *
 * `installNativePanelExtensions` returns a disposer. Callers register it through `opts.onCleanup`
 * so BoardShell can tear down all injected React roots + disconnect the observer on unmount, and
 * a second installer call (e.g. locale switch) does not leak roots. React roots are also unmounted
 * when their host `<div>` leaves the DOM (Excalidraw dropping the panel between renders).
 */
import { createRoot, type Root } from 'react-dom/client'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { NativePanelTextControls, type NativePanelTextRuntime } from './NativePanelTextControls.tsx'
import { NativePanelShapeColorControls } from './NativePanelShapeColorControls.tsx'
import type { BoardTextDefaultsKey } from './boardTextDefaults.ts'
import { DEFAULT_BOARD_FONT_FAMILY } from './boardFontFamilies.ts'

/** Options accepted by `installNativePanelExtensions`. */
export interface InstallNativePanelOptions {
  /** When true the observer is not installed at all — the read-only whiteboard exposes no editing
   *  controls, so the injector has nothing to do. */
  readOnly?: boolean
  /** Optional sink for the disposer, mirroring BoardShell's existing cleanup pattern. */
  onCleanup?: (dispose: () => void) => void
  /** Board-instance key for pending text defaults. */
  defaultsKey?: BoardTextDefaultsKey
  /** Excalidraw element-mutation helpers, handed off from BoardShell's dynamic import so neither
   *  this module nor NativePanelTextControls statically imports the client-only vendor bundle. When
   *  absent (e.g. before the dynamic import resolves) the text controls are skipped and Excalidraw's
   *  native text sections stay visible. */
  textRuntime?: NativePanelTextRuntime
}

/** Structural view of a text element — matches the Excalidraw ExcalidrawTextElement surface we
 *  touch. Kept structural to avoid importing the vendor union at value scope. */
interface TextElementView {
  id: string
  type: string
  isDeleted?: boolean
  fontSize: number
  fontFamily: number
  strokeColor: string
  backgroundColor?: string
  textAlign?: string
  lineHeight?: number
  customData?: Record<string, unknown> | null
  /** Excalidraw bound text points back to the selected shape/container through this stable id. */
  containerId?: string | null
}

/** Sentinel host classes we own; used to skip re-injecting into the same fieldset/div. */
const HOST_CLASS = 'octo-board-native-inject'
const HIDDEN_ORIGINAL = 'octo-board-native-hidden'

/** Selector for a font-size fieldset — matched by the presence of Excalidraw's stable testId. */
const FONT_SIZE_BUTTON_TESTIDS = ['fontSize-small', 'fontSize-medium', 'fontSize-large', 'fontSize-xlarge'] as const
const FONT_FAMILY_BUTTON_TESTIDS = [`font-family-octo-${DEFAULT_BOARD_FONT_FAMILY}`, 'font-family-hand-drawn', 'font-family-normal', 'font-family-code', 'font-family-show-fonts'] as const
const ALIGN_BUTTON_TESTIDS = ['align-left', 'align-horizontal-center', 'align-right'] as const
const SHAPE_COLOR_TYPES = new Set([
  'rectangle',
  'diamond',
  'ellipse',
  'arrow',
  'line',
  'freedraw',
  // Toolbar slot 7 (code block / embedded web page) exposes the same native stroke/background
  // pickers as shapes, so it must use the app-owned Doc/Sheet palette as well.
  'embeddable',
])
const SHAPE_BACKGROUND_TYPES = new Set(['rectangle', 'diamond', 'ellipse', 'line', 'freedraw', 'embeddable'])

/** True when a `.panelColumn` node inside `root` is currently mounted. Used as the coarse
 *  "properties panel is on screen" signal. */
function findPanelColumns(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.panelColumn'))
}

/** Find a fieldset that contains a button with any of `testIds` (stable anchors from
 *  dist/prod/index.js). Returns null if none match. */
function findFieldsetByTestIds(scope: HTMLElement, testIds: readonly string[]): HTMLFieldSetElement | null {
  for (const tid of testIds) {
    const btn = scope.querySelector<HTMLElement>(`[data-testid="${tid}"]`)
    if (btn) {
      const fs = btn.closest('fieldset')
      if (fs) return fs
    }
  }
  return null
}

/** Find the stroke color picker's outer `<div>` inside a panelColumn. Excalidraw wraps every color
 *  picker in a `<div><h3 aria-hidden="true">…</h3>Pa(…)</div>` and renders stroke BEFORE background,
 *  so the first `<div>` in the panelColumn that owns a `.color-picker-container` is the stroke one.
 *  Text elements never render the background picker (`Lu(e,n)` returns false for `text`), which
 *  keeps this "first descendant" heuristic unambiguous when text-only selection is in play. */
function findColorHosts(panelColumn: HTMLElement): HTMLElement[] {
  const hosts: HTMLElement[] = []
  for (const picker of panelColumn.querySelectorAll<HTMLElement>(':scope > div .color-picker-container')) {
    let node: HTMLElement | null = picker
    while (node && node.parentElement !== panelColumn) node = node.parentElement
    if (node && !hosts.includes(node)) hosts.push(node)
  }
  return hosts
}

function findStrokeColorHost(panelColumn: HTMLElement): HTMLElement | null {
  return findColorHosts(panelColumn)[0] ?? null
}

/** Snapshot of the currently selected text elements, or null when the selection is not text-only. */
interface TextSelectionSnapshot {
  elements: readonly TextElementView[]
  selectedIds: readonly string[]
  /** True in STATE B: the Text tool is active with nothing selected, so the injected controls edit
   *  the `currentItem*` appState defaults instead of any element. */
  toolDefault: boolean
}

interface ShapeSelectionSnapshot {
  selectedIds: readonly string[]
  backgroundIds: readonly string[]
  toolDefault: boolean
  toolSupportsBackground: boolean
  /** Native colour hosts are safe to replace only if every selected non-text element can be
   * addressed by our shape controls. Frames/images/iframes/magicframes otherwise need the native
   * fallback that Excalidraw rendered for the aggregate selection. */
  allSelectedNonTextAddressable: boolean
}

interface PanelSelectionSnapshot {
  text: TextSelectionSnapshot | null
  shape: ShapeSelectionSnapshot | null
}

function readTextSelection(api: ExcalidrawImperativeAPI): TextSelectionSnapshot | null {
  // Guard against test stubs that omit these methods; production always ships both.
  const getSceneEls = (api as { getSceneElementsIncludingDeleted?: () => readonly unknown[] })
    .getSceneElementsIncludingDeleted
  const getAppState = (api as {
    getAppState?: () => {
      selectedElementIds?: Record<string, boolean>
      editingTextElement?: { id: string; type: string; isDeleted?: boolean } | null
      activeTool?: { type?: string } | null
    }
  }).getAppState
  if (typeof getSceneEls !== 'function' || typeof getAppState !== 'function') return null

  const all = getSceneEls.call(api) as readonly TextElementView[]
  const state = getAppState.call(api) ?? {}
  const selectedMap = state.selectedElementIds ?? {}
  const selectedIds = Object.keys(selectedMap).filter((id) => selectedMap[id] === true)

  // Editing state: double-clicking into a text element drives the panel off
  // `appState.editingTextElement` (verified against dist/prod/index.js `getSelectedElements`), and
  // that element is usually absent from `selectedElementIds` until the edit is submitted. Fold it
  // into the active set so the same injection covers both the selected and editing panels.
  const editing = state.editingTextElement ?? null
  const editingId =
    editing && !editing.isDeleted && editing.type === 'text' ? editing.id : null
  if (editingId && !selectedIds.includes(editingId)) selectedIds.push(editingId)

  if (selectedIds.length === 0) {
    // STATE B — tool-default panel: the Text tool is active but nothing is selected yet. Excalidraw
    // renders the SAME `.panelColumn` (font-size S/M/L/XL, stroke row, align) bound to the
    // `currentItem*` appState defaults rather than to any element. `activeTool.type === 'text'` is
    // the discriminator (verified against dist/prod/index.js: `activeTool:{...,type:"text"}`). We
    // return a tool-default snapshot so the same in-place injection takes over this panel too, and
    // the injected controls write `currentItemFontSize` / `currentItemStrokeColor` /
    // `currentItemTextAlign` (+ pending customData marks) instead of mutating an element.
    if (state.activeTool?.type === 'text') {
      return { elements: all, selectedIds: [], toolDefault: true }
    }
    return null
  }

  const activeSet = new Set(selectedIds)
  const selectedTextIds = all
    .filter((el) => !el.isDeleted && el.type === 'text' && (
      activeSet.has(el.id) || (el.containerId != null && activeSet.has(el.containerId))
    ))
    .map((el) => el.id)
  if (selectedTextIds.length === 0) return null
  // Attribute-targeted mixed selection: retain only text ids. The text controls then mutate fonts,
  // sizes, marks, colour and alignment on text elements while leaving shapes/frames untouched.
  return { elements: all, selectedIds: selectedTextIds, toolDefault: false }
}

/** Shape tools 2–7 use Excalidraw's divergent private colour picker. Detect that exact surface so
 * it can be replaced with the same app-owned 5×9 control used by Doc and Board text. */
function readShapeSelection(api: ExcalidrawImperativeAPI): ShapeSelectionSnapshot | null {
  const getSceneEls = (api as { getSceneElementsIncludingDeleted?: () => readonly unknown[] })
    .getSceneElementsIncludingDeleted
  const getAppState = (api as {
    getAppState?: () => {
      selectedElementIds?: Record<string, boolean>
      activeTool?: { type?: string } | null
    }
  }).getAppState
  if (typeof getSceneEls !== 'function' || typeof getAppState !== 'function') return null

  const all = getSceneEls.call(api) as readonly TextElementView[]
  const state = getAppState.call(api) ?? {}
  const selectedIds = Object.keys(state.selectedElementIds ?? {})
    .filter((id) => state.selectedElementIds?.[id] === true)
  if (selectedIds.length === 0) {
    const type = state.activeTool?.type ?? ''
    return SHAPE_COLOR_TYPES.has(type)
      ? {
          selectedIds: [],
          backgroundIds: [],
          toolDefault: true,
          toolSupportsBackground: SHAPE_BACKGROUND_TYPES.has(type),
          allSelectedNonTextAddressable: true,
        }
      : null
  }

  const active = new Set(selectedIds)
  const selectedNonText = all.filter(
    (el) => !el.isDeleted && active.has(el.id) && el.type !== 'text',
  )
  const selectedShapes = all.filter(
    (el) => !el.isDeleted && active.has(el.id) && SHAPE_COLOR_TYPES.has(el.type),
  )
  if (selectedShapes.length === 0) return null
  return {
    selectedIds: selectedShapes.map((el) => el.id),
    backgroundIds: selectedShapes
      .filter((el) => SHAPE_BACKGROUND_TYPES.has(el.type))
      .map((el) => el.id),
    toolDefault: false,
    toolSupportsBackground: false,
    allSelectedNonTextAddressable: selectedNonText.every((el) => SHAPE_COLOR_TYPES.has(el.type)),
  }
}

function readPanelSelection(api: ExcalidrawImperativeAPI): PanelSelectionSnapshot {
  return {
    text: readTextSelection(api),
    shape: readShapeSelection(api),
  }
}

/**
 * Hide an existing Excalidraw DOM node with an inline `display: none`. Inline style beats any
 * stylesheet rule regardless of load order (the same rationale as installExcalidrawDebrand). We
 * keep the node in the tree so Excalidraw's React tree can reconcile / unmount it cleanly on the
 * next selection change; we only ever mark it via a sentinel class so re-runs are idempotent.
 */
function hideOriginal(el: HTMLElement): void {
  if (!el.classList.contains(HIDDEN_ORIGINAL)) el.classList.add(HIDDEN_ORIGINAL)
  if (el.style.display !== 'none') el.style.display = 'none'
}

/** Reveal a previously-hidden Excalidraw node — used when the selection turns non-text-only and we
 *  want the upstream picker back. Idempotent. */
function showOriginal(el: HTMLElement): void {
  if (el.classList.contains(HIDDEN_ORIGINAL)) el.classList.remove(HIDDEN_ORIGINAL)
  if (el.style.display === 'none') el.style.display = ''
}

/** Managed React root paired with the DOM host it renders into. */
interface ManagedRoot {
  host: HTMLElement
  root: Root
  renderKey: string
  /** Bit that lets us short-circuit `unmount` on nodes that Excalidraw already dropped from the
   *  DOM (calling `unmount` on a detached container is fine but noisy under React 18 strict-mode). */
  detached: boolean
}

/**
 * Install the docs text controls into every Excalidraw properties panel that appears under
 * `rootEl`. Returns a disposer that unmounts every injected root and disconnects the observer.
 *
 * The observer watches `rootEl`'s subtree; every mutation cycle we (a) locate the mounted
 * `.panelColumn`, (b) decide whether the current selection is text-only, (c) either inject / update
 * our React root and hide the upstream font-size + text-align fieldsets and stroke picker, or (d)
 * unmount our root and reveal the originals. Idempotent by construction: every step reads the
 * present DOM state (sentinel class + presence of our host) before writing.
 */
export function installNativePanelExtensions(
  rootEl: HTMLElement,
  api: ExcalidrawImperativeAPI,
  opts: InstallNativePanelOptions = {},
): () => void {
  const { readOnly = false, onCleanup, textRuntime } = opts
  const defaultsKey = opts.defaultsKey ?? api.id ?? Symbol('board-text-defaults')
  if (readOnly) {
    // No injection in read-only sessions; return a no-op disposer so callers do not branch.
    const noop = () => {}
    onCleanup?.(noop)
    return noop
  }
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    const noop = () => {}
    onCleanup?.(noop)
    return noop
  }

  const managed = new Set<ManagedRoot>()

  function unmountAll(): void {
    for (const entry of managed) {
      try {
        entry.root.unmount()
      } catch {
        // React 18 tolerates unmount on a detached container, but a caller-injected error handler
        // could still throw during unmount — swallow so the whole cleanup keeps running.
      }
      // Best-effort: revive any originals still hidden under this host's panelColumn so a
      // subsequent re-mount by Excalidraw does not leave a phantom hidden fieldset behind.
      if (!entry.detached && entry.host.isConnected) {
        entry.host.remove()
      }
    }
    managed.clear()
  }

  function unmountRootFor(host: HTMLElement): void {
    for (const entry of managed) {
      if (entry.host === host) {
        try { entry.root.unmount() } catch { /* see unmountAll */ }
        managed.delete(entry)
        if (host.isConnected) host.remove()
        return
      }
    }
  }

  /** Excalidraw may replace `.panelColumn` while a portalled font menu is open. A React root whose
   * host was detached still owns that portal, so keeping it alive leaves a second menu at stale
   * viewport coordinates (often x=0 after scrolling). Unmount detached roots before injecting the
   * replacement panel; React then removes every portal owned by the old instance. */
  function unmountDetachedRoots(): void {
    for (const entry of [...managed]) {
      if (!entry.host.isConnected || !rootEl.contains(entry.host)) {
        try { entry.root.unmount() } catch { /* see unmountAll */ }
        managed.delete(entry)
      }
    }
  }

  /** Render (or update) the injection host inside `panelColumn`. */
  function renderInto(panelColumn: HTMLElement, snapshot: TextSelectionSnapshot): void {
    // The text controls mutate live elements through Excalidraw's own primitives, which the host
    // hands off via `textRuntime` (kept out of a static vendor import — see NativePanelTextRuntime).
    // Without it there is nothing to wire the controls to, so leave the native text sections intact.
    if (!textRuntime) return
    // Locate the upstream text controls by their stable testId anchors. The font-size fieldset is
    // the natural seam for our combined block (it opens Excalidraw's own text-properties group), so
    // we drop our host at that exact spot rather than appending to the panel end — an in-place
    // replacement, not a hidden-original + tacked-on addendum.
    const fontSizeFs = findFieldsetByTestIds(panelColumn, FONT_SIZE_BUTTON_TESTIDS)
    const fontFamilyFs = findFieldsetByTestIds(panelColumn, FONT_FAMILY_BUTTON_TESTIDS)
    const alignFs = findFieldsetByTestIds(panelColumn, ALIGN_BUTTON_TESTIDS)
    const strokeHost = findStrokeColorHost(panelColumn)

    // Hide the upstream controls we replace. Left in the DOM so React can still reconcile them.
    if (fontSizeFs) hideOriginal(fontSizeFs)
    if (fontFamilyFs) hideOriginal(fontFamilyFs)
    if (alignFs) hideOriginal(alignFs)
    if (strokeHost) hideOriginal(strokeHost)

    // Insert or reuse our injection host AT the original font-size position (before it), so the
    // native panel reads as one continuous column: everything above the text group is untouched,
    // our controls occupy the slot the S/M/L/XL + align rows used to hold, and the layers/opacity/
    // actions below stay put. Fall back to the align fieldset, then the stroke host, then append.
    let host = panelColumn.querySelector<HTMLElement>(`:scope > .${HOST_CLASS}`)
    if (!host) {
      host = document.createElement('div')
      host.className = HOST_CLASS
      host.dataset.testid = 'board-native-panel-inject'
      const before = fontSizeFs ?? alignFs
      const after = strokeHost
      if (before && before.parentElement === panelColumn) {
        before.before(host)
      } else if (after && after.parentElement === panelColumn) {
        after.after(host)
      } else {
        panelColumn.appendChild(host)
      }
      const root = createRoot(host)
      const renderKey = `${snapshot.toolDefault ? 'defaults' : 'selection'}:${[...snapshot.selectedIds].sort().join(',')}`
      const entry: ManagedRoot = { host, root, renderKey, detached: false }
      managed.add(entry)
      root.render(
        <NativePanelTextControls
          excalidrawAPI={api}
          initialSelection={snapshot}
          targetIds={snapshot.selectedIds}
          toolDefault={snapshot.toolDefault}
          defaultsKey={defaultsKey}
          runtime={textRuntime}
        />,
      )
    } else {
      // The upstream panel DOM survives Text-tool-default → selected/editing transitions. Refresh
      // the injected React props when that mode/identity changes; otherwise controls keep writing
      // currentItem* defaults while visually claiming to edit the selected element.
      const entry = [...managed].find((candidate) => candidate.host === host)
      const renderKey = `${snapshot.toolDefault ? 'defaults' : 'selection'}:${[...snapshot.selectedIds].sort().join(',')}`
      if (entry && entry.renderKey !== renderKey) {
        entry.renderKey = renderKey
        entry.root.render(
          <NativePanelTextControls
            excalidrawAPI={api}
            initialSelection={snapshot}
            targetIds={snapshot.selectedIds}
            toolDefault={snapshot.toolDefault}
            defaultsKey={defaultsKey}
            runtime={textRuntime}
          />,
        )
      }
    }
    panelColumn.classList.add('octo-board-native-panel-column')
  }

  function renderShapeInto(panelColumn: HTMLElement, snapshot: ShapeSelectionSnapshot): void {
    const colorHosts = findColorHosts(panelColumn)
    colorHosts.forEach(hideOriginal)

    let host = panelColumn.querySelector<HTMLElement>(`:scope > .${HOST_CLASS}`)
    const renderKey = `shape:${snapshot.toolDefault ? 'defaults' : [...snapshot.selectedIds].sort().join(',')}:${[...snapshot.backgroundIds].sort().join(',')}:${snapshot.toolSupportsBackground}`
    const controls = (
      <NativePanelShapeColorControls
        excalidrawAPI={api}
        toolDefault={snapshot.toolDefault}
        targetIds={snapshot.selectedIds}
        backgroundTargetIds={snapshot.backgroundIds}
        toolSupportsBackground={snapshot.toolSupportsBackground}
      />
    )
    if (!host) {
      host = document.createElement('div')
      host.className = HOST_CLASS
      host.dataset.testid = 'board-native-panel-inject'
      const firstColorHost = colorHosts[0]
      if (firstColorHost?.parentElement === panelColumn) firstColorHost.before(host)
      else panelColumn.prepend(host)
      const root = createRoot(host)
      managed.add({ host, root, renderKey, detached: false })
      root.render(controls)
    } else {
      const entry = [...managed].find((candidate) => candidate.host === host)
      if (entry && entry.renderKey !== renderKey) {
        entry.renderKey = renderKey
        entry.root.render(controls)
      }
    }
    panelColumn.classList.add('octo-board-native-panel-column')
  }

  function renderMixedInto(
    panelColumn: HTMLElement,
    textSnapshot: TextSelectionSnapshot,
    shapeSnapshot: ShapeSelectionSnapshot,
  ): void {
    if (!textRuntime) return
    const fontSizeFs = findFieldsetByTestIds(panelColumn, FONT_SIZE_BUTTON_TESTIDS)
    const fontFamilyFs = findFieldsetByTestIds(panelColumn, FONT_FAMILY_BUTTON_TESTIDS)
    const alignFs = findFieldsetByTestIds(panelColumn, ALIGN_BUTTON_TESTIDS)
    const colorHosts = findColorHosts(panelColumn)
    if (fontSizeFs) hideOriginal(fontSizeFs)
    if (fontFamilyFs) hideOriginal(fontFamilyFs)
    if (alignFs) hideOriginal(alignFs)
    // Keep Excalidraw's aggregate colour fallback when the mixed selection also contains an
    // unsupported non-text element. Hiding every native host here used to leave frames/images/
    // iframes/magicframes with no colour control at all.
    if (shapeSnapshot.allSelectedNonTextAddressable) colorHosts.forEach(hideOriginal)

    let host = panelColumn.querySelector<HTMLElement>(`:scope > .${HOST_CLASS}`)
    const renderKey = `mixed:t=${[...textSnapshot.selectedIds].sort().join(',')}:s=${[...shapeSnapshot.selectedIds].sort().join(',')}:b=${[...shapeSnapshot.backgroundIds].sort().join(',')}`
    const controls = (
      <>
        <NativePanelShapeColorControls
          excalidrawAPI={api}
          toolDefault={false}
          targetIds={shapeSnapshot.selectedIds}
          backgroundTargetIds={shapeSnapshot.backgroundIds}
        />
        <NativePanelTextControls
          excalidrawAPI={api}
          initialSelection={textSnapshot}
          targetIds={textSnapshot.selectedIds}
          toolDefault={false}
          defaultsKey={defaultsKey}
          runtime={textRuntime}
        />
      </>
    )
    if (!host) {
      host = document.createElement('div')
      host.className = HOST_CLASS
      host.dataset.testid = 'board-native-panel-inject'
      const before = fontSizeFs ?? alignFs
      if (before?.parentElement === panelColumn) before.before(host)
      else if (colorHosts[0]?.parentElement === panelColumn) colorHosts[0].before(host)
      else panelColumn.prepend(host)
      const root = createRoot(host)
      managed.add({ host, root, renderKey, detached: false })
      root.render(controls)
    } else {
      const entry = [...managed].find((candidate) => candidate.host === host)
      if (entry && entry.renderKey !== renderKey) {
        entry.renderKey = renderKey
        entry.root.render(controls)
      }
    }
    panelColumn.classList.add('octo-board-native-panel-column')
  }

  function clampPanelScroll(panelColumn: HTMLElement): void {
    // Excalidraw may preserve scrollTop while replacing/hiding a taller native section. Once the
    // replacement is shorter, that stale offset exposes blank space below the property controls.
    // Clamp after layout instead of always jumping to the top, preserving the user's valid position.
    requestAnimationFrame(() => {
      if (!panelColumn.isConnected) return
      const scrollOwner = panelColumn.closest<HTMLElement>('.App-menu__left') ?? panelColumn
      const maxScrollTop = Math.max(0, scrollOwner.scrollHeight - scrollOwner.clientHeight)
      if (scrollOwner.scrollTop > maxScrollTop) scrollOwner.scrollTop = maxScrollTop
    })
  }

  function sweep(): void {
    // Do this even when no replacement panel exists yet: detached React roots can keep portalled
    // menus alive outside rootEl until explicitly unmounted.
    unmountDetachedRoots()
    const panelColumns = findPanelColumns(rootEl)
    if (panelColumns.length === 0) return
    for (const panelColumn of panelColumns) {
      const { text: textSelection, shape: shapeSelection } = readPanelSelection(api)
      const existingHost = panelColumn.querySelector<HTMLElement>(`:scope > .${HOST_CLASS}`)
      // A panel may survive a tool/selection transition. Reveal previously replaced native sections
      // first, then hide only the sections owned by the new injected mode.
      panelColumn.querySelectorAll<HTMLElement>(`.${HIDDEN_ORIGINAL}`).forEach(showOriginal)
      if (textSelection && shapeSelection && !textSelection.toolDefault && !shapeSelection.toolDefault) {
        renderMixedInto(panelColumn, textSelection, shapeSelection)
      } else if (textSelection) {
        renderInto(panelColumn, textSelection)
      } else if (shapeSelection) {
        renderShapeInto(panelColumn, shapeSelection)
      } else {
        panelColumn.classList.remove('octo-board-native-panel-column')
        if (existingHost) unmountRootFor(existingHost)
      }
      clampPanelScroll(panelColumn)
    }
  }

  // Initial sweep runs before subscribing so an already-mounted panel gets injected right away.
  sweep()

  const observer = new MutationObserver(() => {
    sweep()
  })
  observer.observe(rootEl, { childList: true, subtree: true })

  // Selection/tool transitions can reuse the same panel DOM without inserting a child, so a DOM
  // observer alone misses the tool-default → selection rebind. Drive the sweep from Excalidraw state
  // too — but COALESCE it: Excalidraw emits onChange continuously through a pointer drag (every frame),
  // and the panel is open exactly when something is selected, i.e. exactly when a drag happens. sweep()
  // does per-panel DOM work (reveal/hide native sections, re-read selection), so running it every frame
  // thrashes the panel. The panel's structural output depends only on the derived selection signature
  // (mode + toolDefault + selected ids + hasBackground); the injected controls read live values through
  // their own onChange subscriptions. So skip the sweep whenever that signature is unchanged — a drag
  // that doesn't change the selection does no DOM work, while a real transition still rebinds at once.
  const selectionSignature = (): string => {
    const { text, shape } = readPanelSelection(api)
    const textSig = text
      ? `t:${text.toolDefault ? 'd' : 's'}:${[...text.selectedIds].sort().join(',')}`
      : ''
    const shapeSig = shape
      ? `s:${shape.toolDefault ? 'd' : [...shape.selectedIds].sort().join(',')}:${[...shape.backgroundIds].sort().join(',')}:${shape.toolSupportsBackground}`
      : ''
    return textSig || shapeSig ? `${textSig}|${shapeSig}` : 'none'
  }
  let lastSignature = selectionSignature()
  const unsubscribeApi =
    typeof api.onChange === 'function'
      ? api.onChange(() => {
          const signature = selectionSignature()
          if (signature === lastSignature) return
          lastSignature = signature
          sweep()
        })
      : () => {}

  const disposer = () => {
    try { observer.disconnect() } catch { /* observer already disconnected */ }
    try { unsubscribeApi() } catch { /* API listener already disconnected */ }
    unmountAll()
  }
  onCleanup?.(disposer)
  return disposer
}
