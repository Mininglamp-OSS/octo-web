/**
 * nativePanelInject × Excalidraw properties panel injection.
 *
 * These tests stand up a fake DOM that mirrors Excalidraw 0.18.1's rendered right-side properties
 * panel (`<div class="panelColumn">` containing a font-size fieldset, an align fieldset, and a
 * stroke color picker) and drive the observer / injector through the surface it will hit in
 * production:
 *
 *   - installer runs against a live selection: our React root mounts inside the panelColumn, the
 *     upstream font-size + align fieldsets and stroke picker are hidden inline, and picking a font
 *     size calls `excalidrawAPI.updateScene` with the live element version advanced by the vendor
 *     mutation primitive.
 *   - editing state (double-click into text): the panel is driven off `appState.editingTextElement`
 *     with an empty `selectedElementIds`; the injector must still mount the same controls, and a
 *     write must still land bumped. Leaving the edit reveals the originals again.
 *   - readOnly disables injection entirely — the observer never runs, nothing is hidden.
 *   - non-text selection reveals originals — the injector must not hide upstream controls when the
 *     user is editing a shape.
 *   - installer.dispose() disconnects the observer and unmounts the injected root.
 *
 * The Excalidraw API is faked with just enough surface (updateScene / onChange /
 * getSceneElementsIncludingDeleted / getAppState). The React children of NativePanelTextControls
 * are exercised through DOM assertions so we validate the wiring end-to-end without pulling in the
 * whole Excalidraw canvas under jsdom.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, act } from '@testing-library/react'

// Keep this DOM-focused suite isolated from Excalidraw's renderer dependency graph (which imports
// open-color JSON directly under Node). The production code uses these two public runtime helpers;
// their semantics here are enough to verify stamps and panel wiring.
vi.mock('@excalidraw/excalidraw', () => ({
  FONT_FAMILY: {},
  newElementWith: (element: El, updates: Partial<El>) => ({
    ...element,
    ...updates,
    version: element.version + 1,
    versionNonce: element.versionNonce + 1,
  }),
  redrawTextBoundingBox: () => {},
  mutateElement: (element: El, updates: Partial<El>) => {
    Object.assign(element, updates, {
      version: element.version + 1,
      versionNonce: element.versionNonce + 1,
    })
    return element
  },
}))
import { installNativePanelExtensions as installNativePanelExtensionsRaw } from '../nativePanelInject.tsx'
import type { NativePanelTextRuntime } from '../NativePanelTextControls.tsx'
// The vendor bundle is mocked above; pull its element-mutation primitives from the SAME public
// exports BoardShell hands off at runtime (see NativePanelTextRuntime / BoardShell's dynamic import).
import { mutateElement, redrawTextBoundingBox } from '@excalidraw/excalidraw'
import { BOARD_FONT_FAMILIES } from '../boardFontFamilies.ts'
import { FONT_FAMILIES } from '../../editor/fontFamilies.ts'
import { FONT_SIZES } from '../../editor/fontSizes.ts'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

// Faithful stand-in for the runtime BoardShell threads through from its client-only dynamic import.
// Passing it (instead of reintroducing a static vendor import in NativePanelTextControls or a broad
// document fallback) is the production seam: without a runtime the injector leaves the native text
// sections intact by contract, so every text-injection test must supply one.
const textRuntime = { mutateElement, redrawTextBoundingBox } as unknown as NativePanelTextRuntime

/** Wrap the installer so existing call sites default to the faithful text runtime while still being
 *  able to override options (readOnly / defaultsKey). Explicitly opting out is `{ textRuntime: undefined }`. */
function installNativePanelExtensions(
  rootEl: HTMLElement,
  api: ExcalidrawImperativeAPI,
  opts: Parameters<typeof installNativePanelExtensionsRaw>[2] = {},
): () => void {
  return installNativePanelExtensionsRaw(rootEl, api, { textRuntime, ...opts })
}

// A minimum Excalidraw text-element shape covering everything the injector reads/writes.
type El = {
  id: string
  type: string
  isDeleted?: boolean
  fontSize: number
  fontFamily: number
  strokeColor: string
  backgroundColor?: string
  textAlign?: string
  lineHeight?: number
  version: number
  versionNonce: number
  customData?: Record<string, unknown> | null
  text?: string
  originalText?: string
  containerId?: string | null
}

/** Build a mock ExcalidrawImperativeAPI backed by a mutable scene + selection map. Supports both
 *  the selected state (`selectedIds`) and the editing state (`editingTextElement`) so tests can
 *  drive the double-click-into-text panel Excalidraw renders off `appState.editingTextElement`. */
function makeApi(initial: {
  elements: El[]
  selectedIds: Record<string, boolean>
  editingTextElementId?: string | null
  activeTool?: string
  currentItemFontSize?: number
  currentItemFontFamily?: number
  currentItemStrokeColor?: string
  currentItemBackgroundColor?: string
  currentItemTextAlign?: string
}): {
  api: ExcalidrawImperativeAPI
  updateScene: ReturnType<typeof vi.fn>
  notify: () => void
  setSelection: (sel: Record<string, boolean>) => void
  setEditing: (id: string | null) => void
  setActiveTool: (type: string) => void
  getScene: () => readonly El[]
  listenerCount: () => number
} {
  const state = {
    elements: [...initial.elements] as El[],
    selectedElementIds: { ...initial.selectedIds },
    editingTextElementId: initial.editingTextElementId ?? null,
    activeTool: initial.activeTool ?? 'selection',
    currentItemFontSize: initial.currentItemFontSize ?? 20,
    currentItemFontFamily: initial.currentItemFontFamily ?? 2001,
    currentItemStrokeColor: initial.currentItemStrokeColor ?? '#1e1e1e',
    currentItemBackgroundColor: initial.currentItemBackgroundColor ?? 'transparent',
    currentItemTextAlign: initial.currentItemTextAlign ?? 'left',
  }
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const l of listeners) l()
  }
  const updateScene = vi.fn((scene: {
    elements?: readonly El[]
    appState?: Record<string, unknown>
    captureUpdate?: 'IMMEDIATELY' | 'EVENTUALLY' | 'NEVER'
  }) => {
    if (Array.isArray(scene.elements)) state.elements = [...scene.elements]
    if (scene.appState) Object.assign(state, scene.appState)
    notify()
  })
  const api = {
    updateScene,
    onChange: (cb: () => void) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getSceneElementsIncludingDeleted: () => state.elements,
    getAppState: () => ({
      selectedElementIds: state.selectedElementIds,
      activeTool: { type: state.activeTool },
      currentItemFontSize: state.currentItemFontSize,
      currentItemFontFamily: state.currentItemFontFamily,
      currentItemStrokeColor: state.currentItemStrokeColor,
      currentItemBackgroundColor: state.currentItemBackgroundColor,
      currentItemTextAlign: state.currentItemTextAlign,
      // Mirror the vendor shape: `editingTextElement` is the element object (or null), not an id.
      editingTextElement: state.editingTextElementId
        ? state.elements.find((e) => e.id === state.editingTextElementId) ?? null
        : null,
    }),
  } as unknown as ExcalidrawImperativeAPI
  return {
    api,
    updateScene,
    notify,
    setSelection: (sel) => {
      state.selectedElementIds = { ...sel }
      notify()
    },
    setEditing: (id) => {
      state.editingTextElementId = id
      notify()
    },
    setActiveTool: (type) => {
      state.activeTool = type
      notify()
    },
    getScene: () => state.elements,
    listenerCount: () => listeners.size,
  }
}

/** Build the DOM Excalidraw would render for the right-side properties panel with a text element
 *  selected: a `.panelColumn` div containing a stroke color picker, a font-size fieldset and an
 *  align fieldset. The DOM classes / testIds mirror the vendor exactly. */
function buildFakePanel(): HTMLElement {
  const container = document.createElement('div')
  container.className = 'excalidraw excalidraw-container'
  container.innerHTML = `
    <div class="App-menu__left">
    <div class="panelColumn">
      <fieldset class="font-family-fs">
        <legend>Font family</legend>
        <button data-testid="font-family-normal">Normal</button>
      </fieldset>
      <div class="stroke-color-wrap">
        <h3 aria-hidden="true">Stroke</h3>
        <div>
          <div role="dialog" aria-modal="true" class="color-picker-container">
            <div class="color-picker__top-picks">
              <button data-testid="color-top-pick-#1e1e1e">A</button>
              <button data-testid="color-top-pick-#e03131">B</button>
            </div>
          </div>
        </div>
      </div>
      <div class="background-color-wrap">
        <h3 aria-hidden="true">Background</h3>
        <div><div role="dialog" aria-modal="true" class="color-picker-container" /></div>
      </div>
      <fieldset class="font-size-fs">
        <legend>Font size</legend>
        <div class="buttonList">
          <button data-testid="fontSize-small" title="Small">S</button>
          <button data-testid="fontSize-medium" title="Medium">M</button>
          <button data-testid="fontSize-large" title="Large">L</button>
          <button data-testid="fontSize-xlarge" title="XL">XL</button>
        </div>
      </fieldset>
      <fieldset class="align-fs">
        <legend>Text align</legend>
        <div class="buttonList">
          <button data-testid="align-left" title="Left">L</button>
          <button data-testid="align-horizontal-center" title="Center">C</button>
          <button data-testid="align-right" title="Right">R</button>
        </div>
      </fieldset>
    </div></div>
  `
  document.body.appendChild(container)
  return container
}

describe('installNativePanelExtensions', () => {
  let root: HTMLElement

  beforeEach(() => {
    root = buildFakePanel()
  })

  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('mounts our controls and hides upstream font-size + align + stroke picker on a text-only selection', async () => {
    const t1: El = {
      id: 't1',
      type: 'text',
      fontSize: 20,
      fontFamily: 2001,
      strokeColor: '#1e1e1e',
      textAlign: 'left',
      lineHeight: 1.25,
      version: 1,
      versionNonce: 42,
    }
    const { api } = makeApi({ elements: [t1], selectedIds: { t1: true } })

    let dispose: () => void = () => {}
    act(() => {
      dispose = installNativePanelExtensions(root, api)
    })

    // Our host + child component render inside the panelColumn.
    const host = root.querySelector('[data-testid="board-native-panel-inject"]')
    expect(host).not.toBeNull()
    expect(root.querySelector('[data-testid="board-native-panel-text-controls"]')).not.toBeNull()

    // Upstream controls are hidden inline (survives cascade tie).
    const fontFamilyFs = root.querySelector<HTMLFieldSetElement>('.font-family-fs')
    const fontFs = root.querySelector<HTMLFieldSetElement>('.font-size-fs')
    const alignFs = root.querySelector<HTMLFieldSetElement>('.align-fs')
    const strokeWrap = root.querySelector<HTMLElement>('.stroke-color-wrap')
    expect(fontFamilyFs?.style.display).toBe('none')
    expect(fontFs?.style.display).toBe('none')
    expect(alignFs?.style.display).toBe('none')
    expect(strokeWrap?.style.display).toBe('none')

    // Font-size Select shows the current 20 as an option (not a docs preset; the injector still
    // renders the FONT_SIZES presets, and the current value is the source-of-truth read directly).
    const sel = root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')
    expect(sel).not.toBeNull()

    dispose()
  })


  it('uses the exact Doc/Sheet font catalogue and persists a selected font as native fontFamily', () => {
    expect(BOARD_FONT_FAMILIES.slice(1).map(({ labelKey, value }) => ({ labelKey, value })))
      .toEqual([...FONT_FAMILIES])
    expect(new Set(BOARD_FONT_FAMILIES.map((font) => font.id)).size)
      .toBe(BOARD_FONT_FAMILIES.length)

    const t1: El = {
      id: 't1', type: 'text', fontSize: 20, fontFamily: 2001, strokeColor: '#1e1e1e',
      version: 4, versionNonce: 40,
    }
    const { api, updateScene } = makeApi({ elements: [t1], selectedIds: { t1: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    const family = root.querySelector<HTMLSelectElement>(
      '[data-testid="board-native-panel-font-family"]',
    )!
    expect([...family.options].map((option) => option.value))
      .toEqual(BOARD_FONT_FAMILIES.map((font) => String(font.id)))
    act(() => { fireEvent.change(family, { target: { value: '2005' } }) })
    const next = (updateScene.mock.calls.at(-1)![0].elements as El[])[0]
    expect(next.fontFamily).toBe(2005)
    expect(next.version).toBe(5)
    expect(next.versionNonce).not.toBe(40)

    dispose()
  })

  it('treats a missing font as the default instead of a mixed selection', () => {
    const t1: El = {
      id: 't1', type: 'text', fontSize: 20, fontFamily: 0, strokeColor: '#1e1e1e',
      version: 1, versionNonce: 1,
    }
    const { api } = makeApi({ elements: [t1], selectedIds: { t1: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    const family = root.querySelector<HTMLSelectElement>(
      '[data-testid="board-native-panel-font-family"]',
    )!
    expect(family.value).toBe('2001')
    // The default (Arial) option reuses the table toolbar's real font label ("Arial"), never a
    // "默认字体" placeholder — missing fonts fall back to it internally without a bespoke UI label.
    expect(root.querySelector('[data-testid="board-native-panel-font-family-control"]')?.textContent)
      .toContain('docs.toolbar.font.arial')

    dispose()
  })

  it('font-size change calls updateScene with a fresh CAS stamp on the mutated element', async () => {
    const t1: El = {
      id: 't1',
      type: 'text',
      fontSize: 20,
      fontFamily: 2001,
      strokeColor: '#1e1e1e',
      textAlign: 'left',
      lineHeight: 1.25,
      version: 5,
      versionNonce: 100,
    }
    const { api, updateScene } = makeApi({ elements: [t1], selectedIds: { t1: true } })

    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    const sel = root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')!
    act(() => {
      fireEvent.change(sel, { target: { value: '24' } })
    })

    expect(updateScene).toHaveBeenCalled()
    const nextEls = updateScene.mock.calls.at(-1)![0].elements as El[]
    const nextT1 = nextEls.find((e) => e.id === 't1')!
    expect(nextT1.fontSize).toBe(24)
    expect(nextT1.version).toBe(6) // +1
    expect(nextT1.versionNonce).not.toBe(100) // refreshed
    expect(typeof nextT1.versionNonce).toBe('number')
    expect(updateScene.mock.calls.at(-1)![0].captureUpdate).toBe('IMMEDIATELY')

    dispose()
  })

  it('applies typography to bound text when only its container is selected', () => {
    const rectangle: El = {
      id: 'rect', type: 'rectangle', fontSize: 0, fontFamily: 0, strokeColor: '#1e1e1e',
      backgroundColor: '#ffffff', version: 1, versionNonce: 1,
    }
    const boundText: El = {
      id: 'bound-text', type: 'text', containerId: 'rect', text: 'Bound', originalText: 'Bound',
      fontSize: 16, fontFamily: 2001, strokeColor: '#1e1e1e', version: 2, versionNonce: 2,
    }
    const { api, updateScene, getScene } = makeApi({
      elements: [rectangle, boundText], selectedIds: { rect: true },
    })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    expect(root.querySelector('[data-testid="board-native-panel-text-controls"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="board-native-panel-shape-colors"]')).not.toBeNull()
    const size = root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')!
    act(() => { fireEvent.change(size, { target: { value: '24' } }) })

    expect(getScene().find((element) => element.id === 'bound-text')?.fontSize).toBe(24)
    expect(getScene().find((element) => element.id === 'rect')?.fontSize).toBe(0)
    expect(updateScene.mock.calls.at(-1)![0].captureUpdate).toBe('IMMEDIATELY')
    dispose()
  })

  it('font-size control is a single preset combobox, not a spinner and not a duplicate popover', () => {
    const t1: El = {
      id: 't1', type: 'text', fontSize: 16, fontFamily: 2001, strokeColor: '#1e1e1e',
      version: 1, versionNonce: 1,
    }
    const { api } = makeApi({ elements: [t1], selectedIds: { t1: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    const input = root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')!
    // No native number spinner — the up/down arrows only render for type="number".
    expect(input.getAttribute('type')).not.toBe('number')
    expect(input.type).toBe('text')

    // The native <datalist> autocomplete is gone: it fired a SECOND browser-owned popover next to the
    // custom menu (the stray white "20" box). Only the app-owned Univer Dropdown menu remains, so the
    // input carries no `list=` binding and no <datalist> exists in the tree.
    expect(input.getAttribute('list')).toBeNull()
    expect(document.querySelector('datalist')).toBeNull()

    // Focusing the input opens the single custom preset menu anchored below it, listing the exact
    // shared FONT_SIZES catalogue.
    act(() => { input.focus() })
    const options = [...document.querySelectorAll('.octo-board-native-inject__font-size-option')]
    expect(options.map((option) => option.textContent)).toEqual([...FONT_SIZES])

    dispose()
  })

  it('reopens the preset menu when the focused size input is clicked after a preset commit', () => {
    const t1: El = {
      id: 't1', type: 'text', fontSize: 16, fontFamily: 2001, strokeColor: '#1e1e1e',
      version: 1, versionNonce: 1,
    }
    const { api } = makeApi({ elements: [t1], selectedIds: { t1: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    const input = root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')!
    act(() => { input.focus() })
    const preset = [...document.querySelectorAll<HTMLButtonElement>(
      '.octo-board-native-inject__font-size-option',
    )].find((option) => option.textContent === '24')!
    act(() => {
      fireEvent.pointerDown(preset)
      fireEvent.click(preset)
    })
    expect(document.activeElement).toBe(input)
    expect(document.querySelector('.octo-board-native-inject__font-size-menu')).toBeNull()

    act(() => { fireEvent.pointerDown(input) })
    expect(document.querySelector('.octo-board-native-inject__font-size-menu')).not.toBeNull()

    dispose()
  })

  it('does not apply a prefix preset while a multi-digit size is still being typed', () => {
    const t1: El = {
      id: 't1', type: 'text', fontSize: 16, fontFamily: 2001, strokeColor: '#1e1e1e',
      version: 1, versionNonce: 1,
    }
    const { api, getScene, updateScene } = makeApi({ elements: [t1], selectedIds: { t1: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    const input = root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')!
    act(() => { input.focus() })
    const writesBeforeTyping = updateScene.mock.calls.length
    act(() => { fireEvent.change(input, { target: { value: '9' } }) })
    expect(getScene()[0].fontSize).toBe(16)
    expect(updateScene.mock.calls).toHaveLength(writesBeforeTyping)

    act(() => { fireEvent.change(input, { target: { value: '96' } }) })
    expect(getScene()[0].fontSize).toBe(96)
    expect(updateScene.mock.calls).toHaveLength(writesBeforeTyping + 1)
    dispose()
  })

  it('does not swallow a custom blur commit after choosing a preset outside text-edit mode', () => {
    const t1: El = {
      id: 't1', type: 'text', fontSize: 16, fontFamily: 2001, strokeColor: '#1e1e1e',
      version: 1, versionNonce: 1,
    }
    const { api, getScene } = makeApi({ elements: [t1], selectedIds: { t1: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    let input = root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')!
    act(() => { fireEvent.focus(input) })
    const preset = [...document.querySelectorAll<HTMLButtonElement>(
      '.octo-board-native-inject__font-size-option',
    )].find((option) => option.textContent === '24')!
    act(() => {
      fireEvent.pointerDown(preset)
      fireEvent.click(preset)
    })
    expect(getScene()[0].fontSize).toBe(24)

    input = root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')!
    act(() => { fireEvent.focus(input) })
    act(() => { fireEvent.change(input, { target: { value: '37' } }) })
    act(() => { fireEvent.blur(input) })
    expect(getScene()[0].fontSize).toBe(37)
    expect(root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')?.value)
      .toBe('37')

    dispose()
  })

  it('keeps an edit-mode preset authoritative when the vendor synchronously refocuses the textarea', async () => {
    const t1: El = {
      id: 't1', type: 'text', text: 'hello', originalText: 'hello',
      fontSize: 16, fontFamily: 2001, strokeColor: '#1e1e1e', version: 1, versionNonce: 1,
    }
    const textarea = document.createElement('textarea')
    textarea.className = 'excalidraw-wysiwyg'
    textarea.dataset.type = 'wysiwyg'
    textarea.value = t1.originalText!
    root.appendChild(textarea)
    const { api, getScene } = makeApi({
      elements: [t1], selectedIds: {}, editingTextElementId: 't1',
    })
    textarea.addEventListener('octo-text-style-update', (event) => {
      const detail = (event as CustomEvent<{ start: number; end: number }>).detail
      textarea.focus()
      textarea.setSelectionRange(detail.start, detail.end)
    })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    act(() => {
      textarea.focus()
      textarea.setSelectionRange(0, 3)
      fireEvent.select(textarea)
    })
    const input = root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')!
    act(() => { input.focus() })
    expect(document.activeElement).toBe(input)
    act(() => { fireEvent.change(input, { target: { value: '37' } }) })
    const preset = [...document.querySelectorAll<HTMLButtonElement>(
      '.octo-board-native-inject__font-size-option',
    )].find((option) => option.textContent === '32')!
    act(() => {
      fireEvent.pointerDown(preset)
      fireEvent.click(preset)
    })

    expect(getScene()[0].fontSize).toBe(16)
    expect(getScene()[0].customData?.textRuns).toEqual([{ start: 0, end: 3, fontSize: 32 }])
    expect(document.activeElement).toBe(textarea)

    dispose()
  })

  it('does not apply a committed preset draft to the next selected text on blur', () => {
    const t1: El = {
      id: 't1', type: 'text', text: 'one', fontSize: 16, fontFamily: 2001,
      strokeColor: '#1e1e1e', version: 1, versionNonce: 1,
    }
    const t2: El = {
      id: 't2', type: 'text', text: 'two', fontSize: 20, fontFamily: 2001,
      strokeColor: '#1e1e1e', version: 3, versionNonce: 2,
    }
    const { api, getScene, setSelection, updateScene } = makeApi({
      elements: [t1, t2], selectedIds: { t1: true },
    })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    const input = root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')!
    act(() => { input.focus() })
    const preset = [...document.querySelectorAll<HTMLButtonElement>(
      '.octo-board-native-inject__font-size-option',
    )].find((option) => option.textContent === '32')!
    act(() => {
      fireEvent.pointerDown(preset)
      fireEvent.click(preset)
    })
    expect(getScene()[0].fontSize).toBe(32)

    const writesAfterCommit = updateScene.mock.calls.length
    const canvasTarget = document.createElement('button')
    root.appendChild(canvasTarget)
    act(() => { setSelection({ t2: true }) })
    act(() => { canvasTarget.focus() })
    expect(document.activeElement).toBe(canvasTarget)
    expect(getScene()[1].fontSize).toBe(20)
    expect(getScene()[1].version).toBe(3)
    expect(updateScene.mock.calls).toHaveLength(writesAfterCommit)
    dispose()
  })

  it('drops an uncommitted size draft when selection moves before blur', () => {
    const t1: El = {
      id: 't1', type: 'text', text: 'one', fontSize: 16, fontFamily: 2001,
      strokeColor: '#1e1e1e', version: 1, versionNonce: 1,
    }
    const t2: El = {
      id: 't2', type: 'text', text: 'two', fontSize: 48, fontFamily: 2001,
      strokeColor: '#1e1e1e', version: 3, versionNonce: 2,
      customData: { textRuns: [{ start: 0, end: 3, fontSize: 36 }] },
    }
    const { api, getScene, setSelection, updateScene } = makeApi({
      elements: [t1, t2], selectedIds: { t1: true },
    })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    const input = root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')!
    act(() => { input.focus() })
    act(() => { fireEvent.change(input, { target: { value: '27' } }) })
    const writesBeforeSelection = updateScene.mock.calls.length
    act(() => { setSelection({ t2: true }) })
    act(() => { fireEvent.blur(input) })

    expect(getScene()[1]).toMatchObject({ fontSize: 48, version: 3 })
    expect(getScene()[1].customData?.textRuns).toEqual([{ start: 0, end: 3, fontSize: 36 }])
    expect(updateScene.mock.calls).toHaveLength(writesBeforeSelection)
    dispose()
  })

  it('shows the real (scale-rounded) font size instead of the raw resized float', () => {
    // A bounding-box resize scales fontSize by a non-integer ratio, leaving float noise
    // (e.g. 75 * 0.99999… → 74.999625). The sidebar must show the real size, ~75, not the raw float.
    const t1: El = {
      id: 't1', type: 'text', fontSize: 74.999625, fontFamily: 2001, strokeColor: '#1e1e1e',
      version: 1, versionNonce: 1,
    }
    const { api } = makeApi({ elements: [t1], selectedIds: { t1: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    expect(root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')?.value)
      .toBe('75')

    dispose()
  })

  it('rounds a typed fractional size to the nearest integer and keeps whole values integral', () => {
    const t1: El = {
      id: 't1', type: 'text', fontSize: 16, fontFamily: 2001, strokeColor: '#1e1e1e',
      version: 1, versionNonce: 1,
    }
    const { api, getScene } = makeApi({ elements: [t1], selectedIds: { t1: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    const sizeSel = '[data-testid="board-native-panel-font-size"]'
    // A decimal typed by hand (or produced by a scale readout the user re-commits) is rounded to the
    // nearest whole number — the control keeps integers only. 17.63 → 18, not 17.6 and not 17.63.
    let size = root.querySelector<HTMLInputElement>(sizeSel)!
    act(() => { size.focus() })
    act(() => { fireEvent.change(size, { target: { value: '17.63' } }) })
    act(() => { fireEvent.keyDown(size, { key: 'Enter' }) })
    expect(getScene()[0].fontSize).toBe(18)

    // A whole value stays integral — no forced ".0" reaches the element or the readout.
    size = root.querySelector<HTMLInputElement>(sizeSel)!
    act(() => { size.blur() })
    act(() => { size.focus() })
    act(() => { fireEvent.change(size, { target: { value: '30' } }) })
    act(() => { fireEvent.keyDown(size, { key: 'Enter' }) })
    expect(getScene()[0].fontSize).toBe(30)
    expect(root.querySelector<HTMLInputElement>(sizeSel)?.value).toBe('30')

    dispose()
  })

  it('rounds a genuinely fractional scaled size to a whole integer (30.48 → 30), never a decimal', () => {
    // A resize can settle on a real fractional size (e.g. 30.48). The sidebar must surface it as a
    // whole "30" — the control shows integers only, never a decimal readout.
    const t1: El = {
      id: 't1', type: 'text', fontSize: 30.48, fontFamily: 2001, strokeColor: '#1e1e1e',
      version: 1, versionNonce: 1,
    }
    const { api } = makeApi({ elements: [t1], selectedIds: { t1: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    expect(root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')?.value)
      .toBe('30')

    dispose()
  })

  it('reads run offsets against the unwrapped source, so a scaled full-text run shows its real size', () => {
    // Chinese wraps per character, so `text` (painted, with soft-wrap \n) is longer than the
    // unwrapped `originalText` the runs are addressed in. A resize scaled BOTH the base and the
    // full-text run to ~75. Reading against `text` would leave a tail on the base default and render
    // "mixed" (blank); reading against `originalText` keeps the whole run == 75.
    const t1: El = {
      id: 't1', type: 'text', fontSize: 15.999,
      originalText: '中文中文', text: '中文\n中文',
      fontFamily: 2001, strokeColor: '#1e1e1e', version: 1, versionNonce: 1,
      customData: { textRuns: [{ start: 0, end: 4, fontSize: 74.999625 }] },
    }
    const { api } = makeApi({ elements: [t1], selectedIds: { t1: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    expect(root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')?.value)
      .toBe('75')

    dispose()
  })

  it('applies a Chinese local selection to the exact source range and treats a full-source selection as global', () => {
    // originalText (source, what the textarea holds) is 4 chars; `text` carries a soft-wrap \n and is
    // 5 chars. Offsets and runs live in the source space — the wrapped length must never be used.
    const t1: El = {
      id: 't1', type: 'text', fontSize: 16, fontFamily: 2001, strokeColor: '#1e1e1e',
      originalText: '中文英文', text: '中文\n英文',
      version: 3, versionNonce: 7,
    }
    const textarea = document.createElement('textarea')
    textarea.className = 'excalidraw-wysiwyg'
    textarea.dataset.type = 'wysiwyg'
    textarea.value = t1.originalText! // source, NOT the wrapped `text`
    root.appendChild(textarea)
    const { api, getScene } = makeApi({
      elements: [t1], selectedIds: {}, editingTextElementId: 't1',
    })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    const size = root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')!

    // Strict sub-range: characters 1..3 ("文英"). Runs land on the exact source offsets.
    act(() => {
      textarea.focus()
      textarea.setSelectionRange(1, 3)
      fireEvent.select(textarea)
    })
    act(() => { size.focus() }) // focus so the controlled input tracks the typed draft
    act(() => { fireEvent.change(size, { target: { value: '40' } }) })
    act(() => { fireEvent.keyDown(size, { key: 'Enter' }) }) // commit a non-preset typed size
    expect(getScene()[0].customData?.textRuns).toEqual([{ start: 1, end: 3, fontSize: 40 }])
    expect(getScene()[0].fontSize).toBe(16) // base untouched by a sub-range write

    // Selecting the ENTIRE source (0..4, the unwrapped length — 4, not the wrapped 5) is the
    // whole-element/global context: it sets the base size and clears the per-run override.
    act(() => {
      textarea.focus()
      textarea.setSelectionRange(0, 4)
      fireEvent.select(textarea)
    })
    act(() => { size.focus() })
    act(() => { fireEvent.change(size, { target: { value: '52' } }) })
    act(() => { fireEvent.keyDown(size, { key: 'Enter' }) })
    expect(getScene()[0].fontSize).toBe(52)
    expect(getScene()[0].customData?.textRuns).toBeUndefined()

    dispose()
  })

  it('applies a Chinese local selection font-family change to the exact source range without collapsing it', () => {
    // Same range mechanics as the font-size case, for the font-family control (改字体/字号). The
    // family <select> steals focus from the textarea on pointer-down, which can collapse the live DOM
    // selection; the panel must apply against the UTF-16 range retained from the last `select` event,
    // not the collapsed caret. Source is 4 chars; `text` carries a soft-wrap \n (5 chars).
    const t1: El = {
      id: 't1', type: 'text', fontSize: 16, fontFamily: 2001, strokeColor: '#1e1e1e',
      originalText: '中文英文', text: '中文\n英文',
      version: 3, versionNonce: 7,
    }
    const textarea = document.createElement('textarea')
    textarea.className = 'excalidraw-wysiwyg'
    textarea.dataset.type = 'wysiwyg'
    textarea.value = t1.originalText!
    root.appendChild(textarea)
    const { api, getScene } = makeApi({
      elements: [t1], selectedIds: {}, editingTextElementId: 't1',
    })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    const family = root.querySelector<HTMLSelectElement>('[data-testid="board-native-panel-font-family"]')!

    // Select characters 1..3 ("文英"), then move focus to the family <select> and collapse the live
    // textarea selection (what a real pointer-down does) BEFORE applying — the retained range wins.
    act(() => {
      textarea.focus()
      textarea.setSelectionRange(1, 3)
      fireEvent.select(textarea)
    })
    act(() => {
      family.focus()
      textarea.setSelectionRange(3, 3) // browser collapses the selection when focus leaves
      fireEvent.change(family, { target: { value: '2005' } })
    })

    // The family lands on the exact 1..3 source range; the element base family is untouched.
    expect(getScene()[0].customData?.textRuns).toEqual([{ start: 1, end: 3, fontFamily: 2005 }])
    expect(getScene()[0].fontFamily).toBe(2001)

    dispose()
  })

  it('text-color control mounts the shared ColorSplitControl and its clear resets strokeColor with a bumped stamp', async () => {
    const t1: El = {
      id: 't1', type: 'text', fontSize: 16, fontFamily: 2001, strokeColor: '#e03131',
      version: 2, versionNonce: 200,
    }
    const { api, updateScene } = makeApi({ elements: [t1], selectedIds: { t1: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    // The shared split control is present (main apply button + caret), replacing the old chip grid.
    const colorHost = root.querySelector('[data-testid="board-native-panel-color"]')
    expect(colorHost).not.toBeNull()
    const caret = colorHost!.querySelector<HTMLButtonElement>('.octo-color-caret-btn')
    expect(caret).not.toBeNull()

    // Open the picker popover and hit its "reset colour" row — exercises applyColor end-to-end
    // (the preset/spectrum picks route through @univerjs/design's own ColorPicker internals, which
    // are not deterministically clickable under jsdom, so the clear row is the stable write path).
    act(() => { fireEvent.click(caret!) })
    const clear = document.querySelector<HTMLButtonElement>('.octo-colorpicker-clear')
    expect(clear).not.toBeNull()
    act(() => { fireEvent.click(clear!) })

    expect(updateScene).toHaveBeenCalled()
    const nextEls = updateScene.mock.calls.at(-1)![0].elements as El[]
    const nextT1 = nextEls.find((e) => e.id === 't1')!
    expect(nextT1.strokeColor).toBe('#000000') // reset to the product's Board text default
    expect(nextT1.version).toBe(3) // bumped
    expect(nextT1.versionNonce).not.toBe(200)
    expect(updateScene.mock.calls.at(-1)![0].captureUpdate).toBe('IMMEDIATELY')

    dispose()
  })

  it('shows mixed text colour explicitly and makes the main action non-destructive', () => {
    const black: El = {
      id: 'black', type: 'text', fontSize: 20, fontFamily: 2001, strokeColor: '#000000',
      version: 1, versionNonce: 1,
    }
    const red: El = {
      id: 'red', type: 'text', fontSize: 20, fontFamily: 2001, strokeColor: '#e03131',
      version: 1, versionNonce: 2,
    }
    const { api, updateScene } = makeApi({
      elements: [black, red],
      selectedIds: { black: true, red: true },
    })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    const colorHost = root.querySelector<HTMLElement>('[data-testid="board-native-panel-color"]')!
    expect(colorHost.dataset.currentColor).toBe('mixed')
    expect(colorHost.querySelector('.octo-board-color-icon--mixed')).not.toBeNull()

    act(() => { fireEvent.click(colorHost.querySelector<HTMLButtonElement>('.octo-color-main')!) })
    expect(updateScene).not.toHaveBeenCalled()

    dispose()
  })

  it('tracks selection/appState truth: single element, selection move, and divergent → mixed', () => {
    // 状态同步: the shared controls (colour / size / family) must reflect the selected element's real
    // values, follow the selection when it moves to a differently-styled element, and collapse to the
    // "mixed" sentinel — never a stale single value — when a multi-selection disagrees.
    const red: El = {
      id: 'r', type: 'text', fontSize: 20, fontFamily: 2001, strokeColor: '#e03131',
      version: 1, versionNonce: 1,
    }
    const blue: El = {
      id: 'b', type: 'text', fontSize: 32, fontFamily: 2005, strokeColor: '#3370ff',
      version: 1, versionNonce: 2,
    }
    const { api, setSelection } = makeApi({ elements: [red, blue], selectedIds: { r: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    const color = () => root.querySelector<HTMLElement>('[data-testid="board-native-panel-color"]')!.dataset.currentColor
    const size = () => root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')!.value
    const family = () => root.querySelector<HTMLSelectElement>('[data-testid="board-native-panel-font-family"]')!.value

    // Single selection → the element's own truth.
    expect([color(), size(), family()]).toEqual(['#e03131', '20', '2001'])

    // Selection moves to the blue element → every control follows the new truth.
    act(() => { setSelection({ b: true }) })
    expect([color(), size(), family()]).toEqual(['#3370ff', '32', '2005'])

    // Divergent multi-selection → the mixed sentinel across all shared controls.
    act(() => { setSelection({ r: true, b: true }) })
    expect(color()).toBe('mixed')
    expect(size()).toBe('') // MIXED_VALUE: the size combobox shows blank, not a stale single size
    expect(family()).toBe('') // MIXED_VALUE: the family select shows its disabled mixed option

    dispose()
  })

  it('exposes only native alignment and safely displays imported justify as left', () => {
    const t1: El = {
      id: 't1', type: 'text', fontSize: 16, fontFamily: 2001, strokeColor: '#1e1e1e', textAlign: 'left',
      customData: { textAlign: 'justify' },
      version: 2, versionNonce: 200,
    }
    const { api } = makeApi({ elements: [t1], selectedIds: { t1: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    expect([...root.querySelectorAll<HTMLElement>('[data-testid="board-native-panel-align-btn"]')]
      .map((button) => button.dataset.align)).toEqual(['left', 'center', 'right'])
    expect(root.querySelector('[data-align="justify"]')).toBeNull()
    expect(root.querySelector('[data-align="left"]')?.getAttribute('aria-pressed')).toBe('true')

    dispose()
  })

  it('bold toggle flips customData.bold and bumps the stamp', async () => {
    const t1: El = {
      id: 't1', type: 'text', fontSize: 16, fontFamily: 2001, strokeColor: '#1e1e1e',
      version: 2, versionNonce: 200,
    }
    const { api, updateScene, notify } = makeApi({ elements: [t1], selectedIds: { t1: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    const boldBtn = root.querySelector<HTMLButtonElement>('[data-testid="board-native-panel-bold"]')
    expect(boldBtn).not.toBeNull()
    act(() => { fireEvent.click(boldBtn!) })
    let nextT1 = (updateScene.mock.calls.at(-1)![0].elements as El[]).find((e) => e.id === 't1')!
    expect(nextT1.customData?.bold).toBe(true)
    expect(nextT1.version).toBe(3)

    // Force a re-render so the store observes the updated bold state before the second click.
    act(() => { notify() })

    // Toggle off — re-query after React has observed the updated live element.
    const updatedBoldBtn = root.querySelector<HTMLButtonElement>('[data-testid="board-native-panel-bold"]')
    act(() => { fireEvent.click(updatedBoldBtn!) })
    nextT1 = (updateScene.mock.calls.at(-1)![0].elements as El[]).find((e) => e.id === 't1')!
    expect(nextT1.customData?.bold).toBeUndefined()

    dispose()
  })

  it('text-tool default state injects in place and writes currentItem defaults', () => {
    const { api, updateScene } = makeApi({
      elements: [],
      selectedIds: {},
      activeTool: 'text',
      currentItemFontSize: 20,
      currentItemStrokeColor: '#1e1e1e',
      currentItemTextAlign: 'left',
    })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    expect(root.querySelector('[data-testid="board-native-panel-inject"]')).not.toBeNull()
    expect(root.querySelector<HTMLFieldSetElement>('.font-size-fs')?.style.display).toBe('none')
    expect(root.querySelector<HTMLElement>('.stroke-color-wrap')?.style.display).toBe('none')

    const family = root.querySelector<HTMLSelectElement>('[data-testid="board-native-panel-font-family"]')!
    act(() => { fireEvent.change(family, { target: { value: '2013' } }) })
    expect(updateScene.mock.calls.at(-1)![0].appState).toEqual({ currentItemFontFamily: 2013 })

    const size = root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')!
    act(() => { fireEvent.change(size, { target: { value: '24' } }) })
    expect(updateScene.mock.calls.at(-1)![0].appState).toEqual({ currentItemFontSize: 24 })

    const right = root.querySelector<HTMLButtonElement>(
      '[data-testid="board-native-panel-align-btn"][data-align="right"]',
    )!
    act(() => { fireEvent.click(right) })
    expect(updateScene.mock.calls.at(-1)![0].appState).toEqual({ currentItemTextAlign: 'right' })

    dispose()
  })

  it('rebinds controls when the same panel transitions from text defaults to selection', async () => {
    const t1: El = {
      id: 't1', type: 'text', fontSize: 32, fontFamily: 2008, strokeColor: '#2f9e44',
      textAlign: 'center', lineHeight: 2, version: 7, versionNonce: 9,
    }
    const { api, setSelection } = makeApi({
      elements: [t1], selectedIds: {}, activeTool: 'text', currentItemFontSize: 12,
      currentItemFontFamily: 2001, currentItemStrokeColor: '#1e1e1e', currentItemTextAlign: 'left',
    })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })
    expect(root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')?.value)
      .toBe('12')

    await act(async () => {
      // The API subscription must rebind on the derived selection-signature change by itself. Do not
      // mutate the panel DOM here: that would let MutationObserver mask a broken onChange path.
      setSelection({ t1: true })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(root.querySelector<HTMLSelectElement>('[data-testid="board-native-panel-font-family"]')?.value)
      .toBe('2008')
    expect(root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')?.value)
      .toBe('32')
    expect(root.querySelector('[data-testid="board-native-panel-line-height"]')).toBeNull()
    dispose()
  })

  it('portals the board colour picker outside the clipping panel', () => {
    const t1: El = {
      id: 't1', type: 'text', fontSize: 16, fontFamily: 2001, strokeColor: '#e03131',
      version: 2, versionNonce: 200,
    }
    const { api } = makeApi({ elements: [t1], selectedIds: { t1: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })
    act(() => { fireEvent.click(root.querySelector<HTMLButtonElement>('.octo-color-caret-btn')!) })
    expect(document.querySelector('#octo-univer-portal .octo-board-color-popover')).not.toBeNull()
    expect(root.querySelector('.panelColumn .octo-board-color-popover')).toBeNull()
    dispose()
  })

  it('editing state (double-click into text) injects even with an empty selectedElementIds', async () => {
    // Excalidraw drives the double-click text-editing panel off `appState.editingTextElement`, and
    // that element is absent from `selectedElementIds` until the edit is submitted. The injector
    // must fold the editing element into the active set so the SAME controls cover both states.
    const t1: El = {
      id: 't1', type: 'text', fontSize: 18, fontFamily: 2001, strokeColor: '#1e1e1e', textAlign: 'left',
      lineHeight: 1.25, version: 3, versionNonce: 7,
    }
    // Note: selectedIds is EMPTY — only the editing element is active.
    const { api, updateScene } = makeApi({
      elements: [t1],
      selectedIds: {},
      editingTextElementId: 't1',
    })

    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    // Our controls mount and the upstream font-size + align + stroke picker are hidden, exactly as
    // in the selected state.
    expect(root.querySelector('[data-testid="board-native-panel-inject"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="board-native-panel-text-controls"]')).not.toBeNull()
    expect(root.querySelector<HTMLFieldSetElement>('.font-size-fs')?.style.display).toBe('none')
    expect(root.querySelector<HTMLFieldSetElement>('.align-fs')?.style.display).toBe('none')
    expect(root.querySelector<HTMLElement>('.stroke-color-wrap')?.style.display).toBe('none')

    // A control write still lands with a bumped stamp while in editing state.
    const sel = root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')!
    act(() => { fireEvent.change(sel, { target: { value: '32' } }) })
    const nextT1 = (updateScene.mock.calls.at(-1)![0].elements as El[]).find((e) => e.id === 't1')!
    expect(nextT1.fontSize).toBe(32)
    expect(nextT1.version).toBe(4) // bumped from 3

    dispose()
  })

  it('subscribes to selected-to-editing transitions and keeps consecutive range writes local', () => {
    const t1: El = {
      id: 't1', type: 'text', text: 'hello', fontSize: 18, fontFamily: 2001,
      strokeColor: '#1e1e1e', version: 3, versionNonce: 7,
      customData: { textRuns: [{ start: 1, end: 4, fontFamily: 2005 }] },
    }
    const textarea = document.createElement('textarea')
    textarea.className = 'excalidraw-wysiwyg'
    textarea.value = t1.text!
    root.appendChild(textarea)
    const { api, setEditing, getScene } = makeApi({
      elements: [t1], selectedIds: { t1: true }, editingTextElementId: null,
    })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    // Whole-element selected state sees the local family override and therefore renders mixed.
    expect(root.querySelector<HTMLSelectElement>(
      '[data-testid="board-native-panel-font-family"]',
    )?.value).toBe('')

    // Enter editing on the SAME already-selected element. This must invalidate the external-store
    // snapshot, bind selection listeners, and replace handlers that previously captured non-editing.
    act(() => { setEditing('t1') })
    act(() => {
      textarea.setSelectionRange(1, 4)
      fireEvent.select(textarea)
    })
    expect(root.querySelector<HTMLSelectElement>(
      '[data-testid="board-native-panel-font-family"]',
    )?.value).toBe('2005')

    const family = root.querySelector<HTMLSelectElement>(
      '[data-testid="board-native-panel-font-family"]',
    )!
    act(() => { fireEvent.change(family, { target: { value: '2006' } }) })
    const size = root.querySelector<HTMLInputElement>(
      '[data-testid="board-native-panel-font-size"]',
    )!
    act(() => { fireEvent.change(size, { target: { value: '24' } }) })

    const next = getScene()[0]
    expect(next.fontFamily).toBe(2001)
    expect(next.fontSize).toBe(18)
    expect(next.customData?.textRuns).toEqual([
      { start: 1, end: 4, fontFamily: 2006, fontSize: 24 },
    ])
    dispose()
  })

  it.each([
    ['font family', 'board-native-panel-font-family', '2006'],
    ['preset font size', 'board-native-panel-font-size', '24'],
    ['custom font size', 'board-native-panel-font-size', '30'],
  ])('keeps the %s control focused across a scene tick and restores the retained range after commit', (
    _label,
    testId,
    value,
  ) => {
    const t1: El = {
      id: 't1', type: 'text', text: 'A😀BC', fontSize: 18, fontFamily: 2001,
      strokeColor: '#1e1e1e', version: 3, versionNonce: 7,
    }
    const textarea = document.createElement('textarea')
    textarea.className = 'excalidraw-wysiwyg'
    textarea.dataset.type = 'wysiwyg'
    textarea.value = t1.text!
    root.appendChild(textarea)
    const { api, notify, getScene } = makeApi({
      elements: [t1], selectedIds: {}, editingTextElementId: 't1',
    })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    const selectionStart = 1
    const selectionEnd = 4
    textarea.focus()
    textarea.setSelectionRange(selectionStart, selectionEnd)
    fireEvent.select(textarea)
    textarea.addEventListener('octo-text-style-update', (event) => {
      const detail = (event as CustomEvent<{ start: number; end: number }>).detail
      textarea.focus()
      textarea.setSelectionRange(detail.start, detail.end)
    })

    const control = root.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!
    expect(control.matches('.properties-trigger.octo-board-properties-interactive')).toBe(true)
    expect(control.dataset.preventOutsideClick).toBe('true')
    fireEvent.pointerDown(control)
    control.focus()
    fireEvent.click(control)
    act(() => { notify() })
    expect(document.activeElement).toBe(control)

    fireEvent.change(control, { target: { value } })
    if (testId.endsWith('size') && value === '30') {
      expect(document.activeElement).toBe(control)
      fireEvent.keyDown(control, { key: 'Enter' })
    }
    expect(document.activeElement).toBe(textarea)
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([selectionStart, selectionEnd])
    const run = getScene()[0].customData?.textRuns as Record<string, unknown>[]
    expect(run).toEqual([
      testId.endsWith('family')
        ? { start: selectionStart, end: selectionEnd, fontFamily: Number(value) }
        : { start: selectionStart, end: selectionEnd, fontSize: Number(value) },
    ])
    dispose()
  })

  it.each(['board-native-panel-font-family', 'board-native-panel-font-size'])(
    'restores the retained UTF-16 range when %s closes with Escape',
    async (testId) => {
      const t1: El = {
        id: 't1', type: 'text', text: 'A😀BC', fontSize: 18, fontFamily: 2001,
        strokeColor: '#1e1e1e', version: 3, versionNonce: 7,
      }
      const textarea = document.createElement('textarea')
      textarea.className = 'excalidraw-wysiwyg'
      textarea.dataset.type = 'wysiwyg'
      textarea.value = t1.text!
      root.appendChild(textarea)
      const { api } = makeApi({ elements: [t1], selectedIds: {}, editingTextElementId: 't1' })
      let dispose: () => void = () => {}
      act(() => { dispose = installNativePanelExtensions(root, api) })
      textarea.focus()
      textarea.setSelectionRange(1, 4)
      fireEvent.select(textarea)

      const control = root.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!
      control.focus()
      fireEvent.keyDown(control, { key: 'Escape' })
      await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)) })
      expect(document.activeElement).toBe(textarea)
      expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([1, 4])
      dispose()
    },
  )

  it('synchronizes all range-aware controls on the first local selection event', () => {
    const t1: El = {
      id: 't1', type: 'text', text: 'hello', fontSize: 18, fontFamily: 2001,
      strokeColor: '#1e1e1e', version: 3, versionNonce: 7,
      customData: {
        textRuns: [{
          start: 1, end: 4, fontFamily: 2005, fontSize: 32, color: '#e03131',
          bold: true, italic: true, underline: true,
        }],
      },
    }
    const textarea = document.createElement('textarea')
    textarea.className = 'excalidraw-wysiwyg'
    textarea.value = t1.text!
    root.appendChild(textarea)
    const { api } = makeApi({
      elements: [t1], selectedIds: {}, editingTextElementId: 't1',
    })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    act(() => {
      textarea.dispatchEvent(new CustomEvent('octo-text-selection-change', {
        bubbles: true,
        detail: {
          elementId: 't1',
          value: 'hello',
          selectionStart: 1,
          selectionEnd: 4,
          textRuns: t1.customData?.textRuns,
          activeStyle: {},
        },
      }))
    })

    expect(root.querySelector<HTMLSelectElement>(
      '[data-testid="board-native-panel-font-family"]',
    )?.value).toBe('2005')
    expect(root.querySelector<HTMLSelectElement>(
      '[data-testid="board-native-panel-font-size"]',
    )?.value).toBe('32')
    expect(root.querySelector<HTMLElement>(
      '[data-testid="board-native-panel-color"]',
    )?.dataset.currentColor).toBe('#e03131')
    expect(root.querySelector<HTMLButtonElement>(
      '[data-testid="board-native-panel-bold"]',
    )?.getAttribute('aria-pressed')).toBe('true')
    expect(root.querySelector<HTMLButtonElement>(
      '[data-testid="board-native-panel-italic"]',
    )?.getAttribute('aria-pressed')).toBe('true')
    expect(root.querySelector<HTMLButtonElement>(
      '[data-testid="board-native-panel-underline"]',
    )?.getAttribute('aria-pressed')).toBe('true')
    dispose()
  })

  it('reads live text runs after reselecting a range so bold can be toggled off', () => {
    const t1: El = {
      id: 't1', type: 'text', text: 'hello', originalText: 'hello', fontSize: 18,
      fontFamily: 2001, strokeColor: '#1e1e1e', version: 1, versionNonce: 1,
    }
    const textarea = document.createElement('textarea')
    textarea.className = 'excalidraw-wysiwyg'
    textarea.value = 'hello'
    root.appendChild(textarea)
    const { api, getScene } = makeApi({
      elements: [t1], selectedIds: {}, editingTextElementId: 't1',
    })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    act(() => {
      textarea.setSelectionRange(1, 4)
      fireEvent.select(textarea)
      fireEvent.click(root.querySelector<HTMLButtonElement>('[data-testid="board-native-panel-bold"]')!)
    })
    expect(getScene()[0].customData?.textRuns).toEqual([{ start: 1, end: 4, bold: true }])

    // Simulate the vendor re-emitting selection state after the live element was replaced. The
    // event's run payload is intentionally stale; the control must read current scene customData.
    act(() => {
      textarea.dispatchEvent(new CustomEvent('octo-text-selection-change', {
        bubbles: true,
        detail: {
          elementId: 't1', value: 'hello', selectionStart: 1, selectionEnd: 4,
          textRuns: [], activeStyle: {},
        },
      }))
    })
    expect(root.querySelector<HTMLButtonElement>(
      '[data-testid="board-native-panel-bold"]',
    )?.getAttribute('aria-pressed')).toBe('true')

    act(() => {
      fireEvent.click(root.querySelector<HTMLButtonElement>('[data-testid="board-native-panel-bold"]')!)
    })
    expect(getScene()[0].customData?.textRuns).toEqual([{ start: 1, end: 4, bold: false }])
    dispose()
  })

  it('routes an editing range to a per-property local override and preserves unrelated data', () => {
    const t1: El = {
      id: 't1', type: 'text', text: 'A😀BCD', fontSize: 18, fontFamily: 2001,
      strokeColor: '#1e1e1e', version: 3, versionNonce: 7,
      customData: {
        italic: true,
        durable: 'keep',
        textRuns: [{ start: 1, end: 3, fontSize: 32, color: '#ff0000', bold: true }],
      },
    }
    const textarea = document.createElement('textarea')
    textarea.className = 'excalidraw-wysiwyg'
    textarea.value = t1.text!
    root.appendChild(textarea)
    const { api, updateScene } = makeApi({
      elements: [t1], selectedIds: {}, editingTextElementId: 't1',
    })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })
    textarea.setSelectionRange(1, 3)
    fireEvent.select(textarea)
    // The browser can collapse the live textarea selection when a sidebar control takes focus.
    // The write must still use the last editor selection event, not accidentally route globally.
    textarea.setSelectionRange(0, 0)

    const styleEvents: CustomEvent[] = []
    textarea.addEventListener('octo-text-style-update', (event) => {
      styleEvents.push(event as CustomEvent)
    })
    const size = root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')!
    act(() => { fireEvent.change(size, { target: { value: '24' } }) })

    const next = (updateScene.mock.calls.at(-1)![0].elements as El[])[0]
    expect(next.fontSize).toBe(18)
    expect(next.customData?.italic).toBe(true)
    expect(next.customData?.durable).toBe('keep')
    expect(next.customData?.textRuns).toEqual([
      { start: 1, end: 3, fontSize: 24, color: '#ff0000', bold: true },
    ])
    expect(styleEvents.at(-1)?.detail).toEqual({
      start: 1, end: 3, style: { fontSize: 24 }, committed: true,
    })
    dispose()
  })

  it('keeps an empty-selection editing range across every character control', () => {
    const t1: El = {
      id: 't1', type: 'text', text: '普通文字😀中文', fontSize: 18, fontFamily: 2001,
      strokeColor: '#1e1e1e', version: 3, versionNonce: 7, customData: { durable: 'keep' },
    }
    const textarea = document.createElement('textarea')
    textarea.className = 'excalidraw-wysiwyg'
    textarea.value = t1.text!
    root.appendChild(textarea)
    textarea.focus()
    const { api, getScene } = makeApi({
      elements: [t1], selectedIds: {}, editingTextElementId: 't1',
    })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    const start = '普通'.length
    const end = '普通文字😀'.length
    act(() => {
      textarea.setSelectionRange(start, end)
      fireEvent.select(textarea)
    })

    act(() => {
      fireEvent.change(
        root.querySelector<HTMLSelectElement>('[data-testid="board-native-panel-font-family"]')!,
        { target: { value: '2006' } },
      )
      fireEvent.change(
        root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')!,
        { target: { value: '24' } },
      )
      fireEvent.click(root.querySelector<HTMLButtonElement>('.octo-color-caret-btn')!)
    })
    act(() => {
      fireEvent.click(document.querySelector<HTMLButtonElement>('.octo-colorpicker-clear')!)
      fireEvent.click(root.querySelector<HTMLButtonElement>('[data-testid="board-native-panel-bold"]')!)
      fireEvent.click(root.querySelector<HTMLButtonElement>('[data-testid="board-native-panel-italic"]')!)
      fireEvent.click(root.querySelector<HTMLButtonElement>('[data-testid="board-native-panel-underline"]')!)
    })

    const next = getScene()[0]
    expect(next.fontFamily).toBe(2001)
    expect(next.fontSize).toBe(18)
    expect(next.strokeColor).toBe('#1e1e1e')
    expect(next.customData).toEqual({
      durable: 'keep',
      textRuns: [{
        start, end, fontFamily: 2006, fontSize: 24, color: '#000000',
        bold: true, italic: true, underline: true,
      }],
    })
    expect(document.activeElement).toBe(textarea)
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([start, end])
    dispose()
  })

  it('lets a full-text global change clear only that property after a local override', () => {
    const t1: El = {
      id: 't1', type: 'text', text: 'hello', fontSize: 18, fontFamily: 2001,
      strokeColor: '#1e1e1e', version: 3, versionNonce: 7,
      customData: {
        durable: 'keep',
        textRuns: [{ start: 1, end: 4, fontSize: 32, color: '#e03131', bold: true }],
      },
    }
    const textarea = document.createElement('textarea')
    textarea.className = 'excalidraw-wysiwyg'
    textarea.value = t1.text!
    root.appendChild(textarea)
    const { api, updateScene } = makeApi({
      elements: [t1], selectedIds: {}, editingTextElementId: 't1',
    })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    textarea.setSelectionRange(0, 5)
    fireEvent.select(textarea)
    const size = root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')!
    act(() => { fireEvent.change(size, { target: { value: '24' } }) })

    const next = (updateScene.mock.calls.at(-1)![0].elements as El[])[0]
    expect(next.fontSize).toBe(24)
    expect(next.customData).toEqual({
      durable: 'keep',
      textRuns: [{ start: 1, end: 4, color: '#e03131', bold: true }],
    })
    dispose()
  })

  it('routes a collapsed caret to active insertion style without changing the element', () => {
    const t1: El = {
      id: 't1', type: 'text', text: 'hello', fontSize: 18, fontFamily: 2001,
      strokeColor: '#1e1e1e', version: 3, versionNonce: 7,
      customData: { textRuns: [{ start: 0, end: 2, bold: true }] },
    }
    const textarea = document.createElement('textarea')
    textarea.className = 'excalidraw-wysiwyg'
    textarea.value = t1.text!
    root.appendChild(textarea)
    const { api, updateScene } = makeApi({
      elements: [t1], selectedIds: {}, editingTextElementId: 't1',
    })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })
    textarea.setSelectionRange(2, 2)
    fireEvent.select(textarea)

    const styleEvents: CustomEvent[] = []
    textarea.addEventListener('octo-text-style-update', (event) => {
      styleEvents.push(event as CustomEvent)
    })

    const size = root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')!
    act(() => { fireEvent.change(size, { target: { value: '24' } }) })
    expect(updateScene).not.toHaveBeenCalled()
    expect(t1.fontSize).toBe(18)
    expect(t1.customData?.textRuns).toEqual([{ start: 0, end: 2, bold: true }])
    expect(styleEvents.at(-1)?.detail).toEqual({
      start: 2, end: 2, style: { fontSize: 24 }, mode: 'caret',
    })
    dispose()
  })

  it('clears only the changed base property from every selected element textRuns', () => {
    const t1: El = {
      id: 't1', type: 'text', text: 'one', fontSize: 18, fontFamily: 2001,
      strokeColor: '#111111', version: 1, versionNonce: 1,
      customData: {
        durable: 'keep-1',
        textRuns: [{ start: 0, end: 3, fontSize: 30, color: '#ff0000', bold: true }],
      },
    }
    const t2: El = {
      id: 't2', type: 'text', text: 'two', fontSize: 20, fontFamily: 2002,
      strokeColor: '#222222', version: 2, versionNonce: 2,
      customData: {
        durable: 'keep-2',
        textRuns: [{ start: 0, end: 2, fontSize: 12, italic: true }],
      },
    }
    const { api, updateScene } = makeApi({
      elements: [t1, t2], selectedIds: { t1: true, t2: true },
    })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    const size = root.querySelector<HTMLInputElement>('[data-testid="board-native-panel-font-size"]')!
    // The whole-element view is mixed because the local font-size override differs from the base.
    expect(size.value).toBe('')
    act(() => { fireEvent.change(size, { target: { value: '24' } }) })
    const next = updateScene.mock.calls.at(-1)![0].elements as El[]
    expect(next.map((element) => element.fontSize)).toEqual([24, 24])
    expect(next[0].customData).toEqual({
      durable: 'keep-1',
      textRuns: [{ start: 0, end: 3, color: '#ff0000', bold: true }],
    })
    expect(next[1].customData).toEqual({
      durable: 'keep-2',
      textRuns: [{ start: 0, end: 2, italic: true }],
    })
    dispose()
  })

  it('toggles the font menu and closes it on an outside pointer', () => {
    const t1: El = {
      id: 't1', type: 'text', text: 'hello', fontSize: 18, fontFamily: 2001,
      strokeColor: '#1e1e1e', version: 1, versionNonce: 1,
    }
    const { api } = makeApi({ elements: [t1], selectedIds: { t1: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    const trigger = root.querySelector<HTMLButtonElement>(
      '[data-testid="board-native-panel-font-family-control"]',
    )!
    act(() => { fireEvent.pointerDown(trigger) })
    expect(document.querySelector('.octo-board-native-inject__font-menu')).not.toBeNull()

    act(() => { fireEvent.pointerDown(trigger) })
    expect(document.querySelector('.octo-board-native-inject__font-menu')).toBeNull()

    act(() => { fireEvent.pointerDown(trigger) })
    expect(document.querySelector('.octo-board-native-inject__font-menu')).not.toBeNull()
    act(() => { fireEvent.pointerDown(document.body) })
    expect(document.querySelector('.octo-board-native-inject__font-menu')).toBeNull()
    dispose()
  })

  it('commits app-owned font and size options globally from a mixed whole-element selection', () => {
    const t1: El = {
      id: 't1', type: 'text', text: '范德萨大风沙', originalText: '范德萨大风沙',
      fontSize: 20, fontFamily: 2001, strokeColor: '#111111', version: 1, versionNonce: 1,
      customData: {
        durable: 'keep',
        textRuns: [{ start: 0, end: 2, fontFamily: 2006, fontSize: 48, bold: true }],
      },
    }
    const { api, getScene } = makeApi({ elements: [t1], selectedIds: { t1: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    const familyTrigger = root.querySelector<HTMLButtonElement>(
      '[data-testid="board-native-panel-font-family-control"]',
    )!
    expect(familyTrigger.textContent).toContain('docs.board.nativePanel.mixed')
    act(() => { fireEvent.click(familyTrigger) })
    const familyOption = document.querySelector<HTMLButtonElement>(
      '.octo-board-native-inject__font-option[role="option"]',
    )!
    act(() => { fireEvent.click(familyOption) })

    let next = getScene()[0]
    expect(next.fontFamily).toBe(2001)
    expect(next.customData).toEqual({
      durable: 'keep',
      textRuns: [{ start: 0, end: 2, fontSize: 48, bold: true }],
    })

    const sizeInput = root.querySelector<HTMLInputElement>(
      '[data-testid="board-native-panel-font-size"]',
    )!
    expect(sizeInput.value).toBe('')
    expect(sizeInput.placeholder).toBe('docs.board.nativePanel.mixed')
    act(() => { fireEvent.focus(sizeInput) })
    const sizeOption = [...document.querySelectorAll<HTMLButtonElement>(
      '.octo-board-native-inject__font-size-option[role="option"]',
    )].find((option) => option.textContent === '24')!
    act(() => {
      fireEvent.pointerDown(sizeOption)
      fireEvent.click(sizeOption)
    })

    next = getScene()[0]
    expect(next.fontSize).toBe(24)
    expect(next.customData).toEqual({
      durable: 'keep',
      textRuns: [{ start: 0, end: 2, bold: true }],
    })
    dispose()
  })

  it('uses attribute-targeted controls but preserves native colour fallback for a mixed text/shape/frame selection', () => {
    const text: El = {
      id: 'text', type: 'text', fontSize: 20, fontFamily: 2001, strokeColor: '#111111',
      textAlign: 'left', version: 1, versionNonce: 1,
    }
    const shape: El = {
      id: 'shape', type: 'rectangle', fontSize: 0, fontFamily: 2001,
      strokeColor: '#e03131', backgroundColor: '#fff4b9', version: 1, versionNonce: 2,
    }
    const line: El = {
      id: 'line', type: 'line', fontSize: 0, fontFamily: 2001,
      strokeColor: '#1971c2', backgroundColor: 'transparent', version: 1, versionNonce: 3,
    }
    const frame: El = {
      id: 'frame', type: 'frame', fontSize: 0, fontFamily: 2001,
      strokeColor: '#999999', backgroundColor: 'transparent', version: 1, versionNonce: 4,
    }
    const { api, updateScene } = makeApi({
      elements: [text, shape, line, frame],
      selectedIds: { text: true, shape: true, line: true, frame: true },
    })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    expect(root.querySelector('[data-testid="board-native-panel-text-controls"]')).not.toBeNull()
    expect(root.querySelector('[data-testid="board-native-panel-shape-colors"]')).not.toBeNull()
    expect(root.querySelector<HTMLFieldSetElement>('.font-family-fs')?.style.display).toBe('none')
    expect(root.querySelector<HTMLFieldSetElement>('.font-size-fs')?.style.display).toBe('none')
    expect(root.querySelector<HTMLFieldSetElement>('.align-fs')?.style.display).toBe('none')
    expect(root.querySelector<HTMLElement>('.stroke-color-wrap')?.style.display).not.toBe('none')
    expect(root.querySelector<HTMLElement>('.background-color-wrap')?.style.display).not.toBe('none')

    const family = root.querySelector<HTMLSelectElement>('[data-testid="board-native-panel-font-family"]')!
    act(() => { fireEvent.change(family, { target: { value: '2006' } }) })
    let next = updateScene.mock.calls.at(-1)![0].elements as El[]
    expect(next.find((el) => el.id === 'text')?.fontFamily).toBe(2006)
    expect(next.find((el) => el.id === 'shape')?.fontFamily).toBe(2001)
    expect(next.find((el) => el.id === 'line')?.fontFamily).toBe(2001)
    expect(next.find((el) => el.id === 'frame')?.fontFamily).toBe(2001)
    expect(updateScene.mock.calls.at(-1)![0].captureUpdate).toBe('IMMEDIATELY')

    updateScene.mockClear()
    const stroke = root.querySelector<HTMLElement>('[data-testid="board-native-panel-shape-stroke"]')!
    expect(stroke.dataset.currentColor).toBe('mixed')
    const paletteButton = stroke.querySelector<HTMLButtonElement>('.octo-color-caret-btn')!
    act(() => { fireEvent.click(paletteButton) })
    const colorPicker = document.querySelector<HTMLElement>('.octo-board-color-popover')!
    expect(colorPicker).not.toBeNull()
    // The detailed palette interaction is owned by ColorSplitControl's suite; here the invariant is
    // that mixed shape colour uses the shared picker rather than Excalidraw's native swatches.
    act(() => { fireEvent.click(paletteButton) })

    // Re-open and clear through the shared picker to exercise an intentional shape-only write.
    act(() => { fireEvent.click(paletteButton) })
    const clear = document.querySelector<HTMLButtonElement>('.octo-colorpicker-clear')!
    act(() => { fireEvent.click(clear) })
    next = updateScene.mock.calls.at(-1)![0].elements as El[]
    expect(next.find((el) => el.id === 'shape')?.strokeColor).toBe('#000000')
    expect(next.find((el) => el.id === 'line')?.strokeColor).toBe('#000000')
    expect(next.find((el) => el.id === 'text')?.strokeColor).toBe('#111111')
    expect(next.find((el) => el.id === 'frame')?.strokeColor).toBe('#999999')
    expect(updateScene.mock.calls.at(-1)![0].captureUpdate).toBe('IMMEDIATELY')

    dispose()
  })

  it('leaving the editing state (editingTextElement cleared, nothing selected) reveals the originals', async () => {
    const t1: El = {
      id: 't1', type: 'text', fontSize: 18, fontFamily: 2001, strokeColor: '#1e1e1e',
      version: 1, versionNonce: 1,
    }
    const { api, setEditing } = makeApi({
      elements: [t1],
      selectedIds: {},
      editingTextElementId: 't1',
    })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })
    expect(root.querySelector('[data-testid="board-native-panel-inject"]')).not.toBeNull()

    // Submit the edit: editingTextElement clears and nothing is selected — the injector drops our
    // host and reveals the upstream controls.
    await act(async () => {
      setEditing(null)
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(root.querySelector('[data-testid="board-native-panel-inject"]')).toBeNull()
    expect(root.querySelector<HTMLFieldSetElement>('.font-size-fs')?.style.display).not.toBe('none')

    dispose()
  })

  it('readOnly=true does not inject anything', () => {
    const t1: El = { id: 't1', type: 'text', fontSize: 20, fontFamily: 2001, strokeColor: '#000', version: 1, versionNonce: 1 }
    const { api } = makeApi({ elements: [t1], selectedIds: { t1: true } })

    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api, { readOnly: true }) })

    expect(root.querySelector('[data-testid="board-native-panel-inject"]')).toBeNull()
    expect(root.querySelector<HTMLFieldSetElement>('.font-size-fs')?.style.display).not.toBe('none')

    dispose()
  })

  it('replaces shape tools 2–7 native color pickers with the shared palette controls', () => {
    const s1: El = {
      id: 's1', type: 'rectangle', fontSize: 0, fontFamily: 2001, strokeColor: '#000000',
      backgroundColor: 'transparent', version: 1, versionNonce: 1,
    }
    const { api, updateScene } = makeApi({ elements: [s1], selectedIds: { s1: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    expect(root.querySelector('[data-testid="board-native-panel-shape-colors"]')).not.toBeNull()
    expect(root.querySelector<HTMLElement>('.stroke-color-wrap')?.style.display).toBe('none')
    expect(root.querySelector<HTMLElement>('.background-color-wrap')?.style.display).toBe('none')
    expect(root.querySelectorAll('.octo-color-split')).toHaveLength(2)

    const main = root.querySelector<HTMLButtonElement>('.octo-color-main')!
    act(() => { fireEvent.click(main) })
    const next = (updateScene.mock.calls.at(-1)![0].elements as El[])[0]
    expect(next.strokeColor).toBe('#000000')
    expect(next.version).toBe(2)
    expect(next.versionNonce).not.toBe(1)
    expect(updateScene.mock.calls.at(-1)![0].captureUpdate).toBe('IMMEDIATELY')

    dispose()
  })

  it('does not paint a fallback when the selected shapes have mixed colours', () => {
    const s1: El = {
      id: 's1', type: 'rectangle', fontSize: 0, fontFamily: 2001,
      strokeColor: '#e03131', backgroundColor: '#fff4b9', version: 1, versionNonce: 1,
    }
    const s2: El = {
      id: 's2', type: 'rectangle', fontSize: 0, fontFamily: 2001,
      strokeColor: '#1971c2', backgroundColor: '#b2f2bb', version: 1, versionNonce: 2,
    }
    const { api, updateScene } = makeApi({
      elements: [s1, s2], selectedIds: { s1: true, s2: true },
    })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    const stroke = root.querySelector<HTMLElement>('[data-testid="board-native-panel-shape-stroke"]')!
    expect(stroke.dataset.currentColor).toBe('mixed')
    expect(stroke.querySelector('.octo-board-color-icon--mixed')).not.toBeNull()
    act(() => { fireEvent.click(stroke.querySelector<HTMLButtonElement>('.octo-color-main')!) })
    expect(updateScene).not.toHaveBeenCalled()

    const fill = root.querySelector<HTMLElement>('[data-testid="board-native-panel-shape-fill"]')!
    expect(fill.dataset.currentColor).toBe('mixed')
    expect(fill.querySelector('.octo-board-color-icon--mixed')).not.toBeNull()
    act(() => { fireEvent.click(fill.querySelector<HTMLButtonElement>('.octo-color-main')!) })
    expect(updateScene).not.toHaveBeenCalled()
    dispose()
  })

  it.each(['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'embeddable'])(
    'injects the unified palette for tool %s with nothing selected',
    (activeTool) => {
      const { api } = makeApi({ elements: [], selectedIds: {}, activeTool })
      let dispose: () => void = () => {}
      act(() => { dispose = installNativePanelExtensions(root, api) })
      expect(root.querySelector('[data-testid="board-native-panel-shape-colors"]')).not.toBeNull()
      expect(root.querySelectorAll('.octo-color-split')).toHaveLength(
        ['rectangle', 'diamond', 'ellipse', 'line', 'freedraw', 'embeddable'].includes(activeTool) ? 2 : 1,
      )
      dispose()
    },
  )

  it('re-renders fill capability when shape tools switch within one installer', () => {
    const { api, setActiveTool } = makeApi({ elements: [], selectedIds: {}, activeTool: 'arrow' })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })
    expect(root.querySelectorAll('.octo-color-split')).toHaveLength(1)

    act(() => { setActiveTool('line') })
    expect(root.querySelectorAll('.octo-color-split')).toHaveLength(2)
    act(() => { setActiveTool('rectangle') })
    expect(root.querySelectorAll('.octo-color-split')).toHaveLength(2)
    act(() => { setActiveTool('arrow') })
    expect(root.querySelectorAll('.octo-color-split')).toHaveLength(1)
    dispose()
  })

  it('keeps native controls visible for selections outside text and tools 2–7', () => {
    const s1: El = {
      id: 's1', type: 'image', fontSize: 0, fontFamily: 2001, strokeColor: '#000',
      version: 1, versionNonce: 1,
    }
    const { api } = makeApi({ elements: [s1], selectedIds: { s1: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    expect(root.querySelector('[data-testid="board-native-panel-inject"]')).toBeNull()
    expect(root.querySelector<HTMLElement>('.stroke-color-wrap')?.style.display).not.toBe('none')
    dispose()
  })

  it('disposer disconnects the observer so late DOM mutations are ignored', async () => {
    const t1: El = { id: 't1', type: 'text', fontSize: 20, fontFamily: 2001, strokeColor: '#000', version: 1, versionNonce: 1 }
    const { api } = makeApi({ elements: [t1], selectedIds: { t1: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    // Initial mount populated the host.
    expect(root.querySelector('[data-testid="board-native-panel-inject"]')).not.toBeNull()

    act(() => { dispose() })

    // After dispose, our host should be gone and further DOM mutations should NOT re-inject.
    expect(root.querySelector('[data-testid="board-native-panel-inject"]')).toBeNull()
    // Simulate Excalidraw remounting the panel (nothing we do here should trigger our injector).
    const extra = document.createElement('div')
    extra.className = 'panelColumn'
    extra.innerHTML = `<fieldset class="font-size-fs"><button data-testid="fontSize-small"/></fieldset>`
    root.appendChild(extra)
    // Give the MutationObserver task a microtask to run — none is installed, so nothing happens.
    await Promise.resolve()
    expect(extra.querySelector('[data-testid="board-native-panel-inject"]')).toBeNull()
  })

  it('subscribes injector and controls, then releases both API listeners on disposal', () => {
    const t1: El = { id: 't1', type: 'text', fontSize: 20, fontFamily: 2001, strokeColor: '#000', version: 1, versionNonce: 1 }
    const harness = makeApi({ elements: [t1], selectedIds: { t1: true } })
    let dispose: () => void = () => {}

    act(() => { dispose = installNativePanelExtensions(root, harness.api, { defaultsKey: 'board-a' }) })
    expect(harness.listenerCount()).toBe(2)

    act(() => { dispose() })
    expect(harness.listenerCount()).toBe(0)
    expect(root.querySelector('[data-testid="board-native-panel-inject"]')).toBeNull()
  })

  it('removes an open portalled font menu when its panel root is detached', async () => {
    const t1: El = { id: 't1', type: 'text', fontSize: 20, fontFamily: 2001, strokeColor: '#000', version: 1, versionNonce: 1 }
    const { api } = makeApi({ elements: [t1], selectedIds: { t1: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    act(() => {
      fireEvent.pointerDown(root.querySelector<HTMLButtonElement>(
        '[data-testid="board-native-panel-font-family-control"]',
      )!)
    })
    expect(document.querySelectorAll('.octo-board-native-inject__font-menu')).toHaveLength(1)

    await act(async () => {
      root.querySelector('.panelColumn')?.remove()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(document.querySelectorAll('.octo-board-native-inject__font-menu')).toHaveLength(0)
    dispose()
  })

  it('clamps stale panel scroll after an alignment write reflows the injected controls', async () => {
    const t1: El = {
      id: 't1', type: 'text', fontSize: 20, fontFamily: 2001, strokeColor: '#000',
      textAlign: 'left', version: 1, versionNonce: 1,
    }
    const { api } = makeApi({ elements: [t1], selectedIds: { t1: true } })
    const panel = root.querySelector<HTMLElement>('.panelColumn')!
    const scrollOwner = root.querySelector<HTMLElement>('.App-menu__left')!
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    Object.defineProperty(scrollOwner, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(scrollOwner, 'scrollHeight', { configurable: true, value: 260 })
    scrollOwner.scrollTop = 180
    act(() => {
      fireEvent.click(root.querySelector<HTMLButtonElement>(
        '[data-testid="board-native-panel-align-btn"][data-align="right"]',
      )!)
    })
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)) })

    expect(scrollOwner.scrollTop).toBe(60)
    expect(panel.scrollTop).toBe(0)
    dispose()
  })

  it('re-mounts our host after the panel is torn down and recreated', async () => {
    const t1: El = { id: 't1', type: 'text', fontSize: 20, fontFamily: 2001, strokeColor: '#000', version: 1, versionNonce: 1 }
    const { api } = makeApi({ elements: [t1], selectedIds: { t1: true } })
    let dispose: () => void = () => {}
    act(() => { dispose = installNativePanelExtensions(root, api) })

    expect(root.querySelector('[data-testid="board-native-panel-inject"]')).not.toBeNull()

    // Simulate Excalidraw dropping the panel and mounting a fresh one.
    act(() => { root.querySelector('.panelColumn')?.remove() })
    // MutationObserver work is microtask-scheduled; flush.
    await new Promise((r) => setTimeout(r, 0))
    expect(root.querySelector('.panelColumn')).toBeNull()

    // Add a fresh panelColumn similar to the initial fixture.
    const fresh = document.createElement('div')
    fresh.className = 'panelColumn'
    fresh.innerHTML = `
      <fieldset class="font-size-fs">
        <div class="buttonList">
          <button data-testid="fontSize-small"/>
          <button data-testid="fontSize-medium"/>
        </div>
      </fieldset>
      <fieldset class="align-fs">
        <div class="buttonList">
          <button data-testid="align-left"/>
        </div>
      </fieldset>
    `
    await act(async () => {
      root.appendChild(fresh)
      await new Promise((r) => setTimeout(r, 0))
    })

    expect(fresh.querySelector('[data-testid="board-native-panel-inject"]')).not.toBeNull()
    expect(fresh.querySelector<HTMLFieldSetElement>('.font-size-fs')?.style.display).toBe('none')

    dispose()
  })
})
