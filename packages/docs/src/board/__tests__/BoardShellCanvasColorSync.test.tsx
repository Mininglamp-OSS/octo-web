import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import type { WhiteboardSession } from '../collab/connect.ts'

const octoToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@octo/base', async (importOriginal) => ({
  ...await importOriginal<typeof import('@octo/base')>(),
  OctoToast: octoToast,
}))

const canvas = vi.hoisted(() => ({
  onChange: null as
    | null
    | ((els: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => void),
  onContextMenu: null as null | ((payload: {
    event: MouseEvent
    type: 'canvas' | 'element'
    sceneX: number
    sceneY: number
    selectedElementIds: Readonly<Record<string, boolean>>
  }) => void),
  onColorCommit: null as null | ((color: string) => void),
  uiOptions: undefined as undefined | { canvasActions?: { loadScene?: boolean } },
  renderDefaultMainMenu: undefined as boolean | undefined,
  appState: {
    selectedElementIds: {} as Record<string, boolean>,
    scrollX: 0,
    scrollY: 0,
    width: 800,
    height: 600,
    zoom: { value: 1 },
    editingLinearElement: null as null | { elementId: string },
  },
  elements: [] as Array<Record<string, unknown>>,
  availableActions: new Set<string>(),
  executeAction: vi.fn(),
  executeActionWithHostFeedback: vi.fn(),
  descendantDrop: vi.fn(),
}))

vi.mock('@excalidraw/excalidraw', () => {
  const Excalidraw = ({
    children,
    excalidrawAPI,
    onChange,
    onContextMenu,
    UIOptions,
    renderDefaultMainMenu = true,
  }: {
    children?: ReactNode
    excalidrawAPI?: (api: unknown) => void
    onChange?: (els: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => void
    onContextMenu?: typeof canvas.onContextMenu
    UIOptions?: { canvasActions?: { loadScene?: boolean } }
    renderDefaultMainMenu?: boolean
  }) => {
    canvas.uiOptions = UIOptions
    canvas.renderDefaultMainMenu = renderDefaultMainMenu
    useEffect(() => {
      const api = {
        updateScene: () => {},
        getAppState: () => canvas.appState,
        getSceneElements: () => canvas.elements,
        executeAction: (name: string) => canvas.executeAction(name),
        executeActionWithHostFeedback: (name: string) => canvas.executeActionWithHostFeedback(name),
        isActionAvailable: (name: string) => canvas.availableActions.has(name),
      }
      excalidrawAPI?.(api)
      canvas.onChange = onChange ?? null
      canvas.onContextMenu = onContextMenu ?? null
      return () => {
        canvas.onChange = null
        canvas.onContextMenu = null
      }
    }, [excalidrawAPI, onChange, onContextMenu])
    return (
      <div data-testid="excalidraw-canvas" onDrop={canvas.descendantDrop}>
        {renderDefaultMainMenu && <button type="button" data-testid="main-menu-trigger">Menu</button>}
        {children}
      </div>
    )
  }
  const MainMenu = (() => null) as unknown as { DefaultItems: Record<string, unknown> }
  MainMenu.DefaultItems = {}
  return {
    FONT_FAMILY: {},
    Excalidraw,
    MainMenu,
    restoreElements: (els: readonly unknown[] | null | undefined) => (els ? [...els] : []),
    reconcileElements: (local: readonly unknown[]) => [...local],
    redrawTextBoundingBox: () => {},
    mutateElement: (element: Record<string, unknown>, updates: Record<string, unknown>) =>
      Object.assign(element, updates),
    loadLibraryFromBlob: async () => [],
    serializeLibraryAsJSON: () => '[]',
    serializeAsJSON: () => '{}',
    getSceneVersion: (elements: readonly unknown[]) => elements.reduce<number>((sum, element) =>
      sum + Number((element as { version?: number }).version ?? 0), 0),
  }
})
vi.mock('@excalidraw/excalidraw/index.css', () => ({}))

vi.mock('../BoardCanvasColorControl.tsx', () => ({
  BoardCanvasColorControl: ({ onColorCommit }: { onColorCommit?: (color: string) => void }) => {
    useEffect(() => {
      canvas.onColorCommit = onColorCommit ?? null
      return () => { canvas.onColorCommit = null }
    }, [onColorCommit])
    return null
  },
}))

vi.mock('../boardStore.ts', () => ({
  hasSavedBoardViewport: () => false,
  loadBoardScene: () => null,
  persistBoardScene: () => true,
  clearBoardScene: () => {},
}))

import { BoardShell } from '../BoardShell.tsx'

function makeSession(initiallySynced = false, role: 'admin' | 'writer' | 'reader' = 'writer'): {
  session: WhiteboardSession
  provider: { isSynced: boolean; emitSynced: () => void }
  handleLocalAppState: ReturnType<typeof vi.fn>
  handleLocalChange: ReturnType<typeof vi.fn>
} {
  const handleLocalAppState = vi.fn()
  const handleLocalChange = vi.fn()
  let bindingSynced = false
  const syncedListeners = new Set<() => void>()
  const provider = {
    isSynced: initiallySynced,
    awareness: {
      clientID: 1,
      getLocalState: () => null,
      getStates: () => new Map(),
      on: () => {},
      off: () => {},
      setLocalStateField: () => {},
    },
    on: (event: string, callback: () => void) => {
      if (event === 'synced') syncedListeners.add(callback)
    },
    off: (event: string, callback: () => void) => {
      if (event === 'synced') syncedListeners.delete(callback)
    },
    emitSynced: () => {
      provider.isSynced = true
      for (const callback of syncedListeners) callback()
    },
  }
  const binding = {
    setApi: () => {},
    setRenderAdapter: () => {},
    setFileSync: () => {},
    setSynced: (nextSynced: boolean) => { bindingSynced = nextSynced },
    handleLocalChange,
    handleLocalAppState: (appState: { viewBackgroundColor?: unknown }) => {
      if (bindingSynced) handleLocalAppState(appState)
    },
    snapshotElements: () => [] as unknown[],
    snapshotViewBackgroundColor: () => '#ffcc00',
  }
  const session = {
    getRole: () => role,
    subscribeRole: () => () => {},
    subscribeTerminal: () => () => {},
    binding,
    provider,
  } as unknown as WhiteboardSession
  return { session, provider, handleLocalAppState, handleLocalChange }
}

async function renderBoard(session: WhiteboardSession): Promise<void> {
  render(<BoardShell docId="doc-1" title="Shared board" space="s1" collabSession={session} collab />)
  await screen.findByTestId('excalidraw-canvas')
  await waitFor(() => {
    expect(canvas.onChange).toBeTruthy()
    expect(canvas.onColorCommit).toBeTruthy()
  })
}

describe('BoardShell — provider-gated canvas background convergence (canvas background authority contract)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canvas.onChange = null
    canvas.onColorCommit = null
    canvas.uiOptions = undefined
    canvas.renderDefaultMainMenu = undefined
    canvas.appState.selectedElementIds = {}
    canvas.appState.editingLinearElement = null
    canvas.elements = []
    canvas.availableActions.clear()
    canvas.executeAction.mockReset()
    canvas.executeAction.mockReturnValue(true)
    canvas.executeActionWithHostFeedback.mockReset()
    canvas.executeActionWithHostFeedback.mockResolvedValue(true)
    canvas.descendantDrop.mockReset()
  })

  it('disables scene loading, blocks every OS file drop, and preserves in-app text/library drops', async () => {
    const { session } = makeSession()
    await renderBoard(session)
    expect(canvas.uiOptions?.canvasActions?.loadScene).toBe(false)

    const host = document.querySelector<HTMLElement>('.octo-board-live-canvas')!
    const descendant = screen.getByTestId('excalidraw-canvas')
    const pngMagicBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const blockedFiles = [
      new File(['x'], 'scene.excalidraw'),
      new File(['x'], 'scene.json', { type: 'application/json' }),
      new File(['x'], 'embedded.png', { type: 'image/png' }),
      new File(['x'], 'embedded.svg', { type: 'image/svg+xml' }),
      new File(['x'], 'notes.txt', { type: 'text/plain' }),
      new File(['x'], 'scene'),
      new File(['x'], 'scene.excalidraw2'),
      new File(['x'], 'board.bin', { type: 'application/vnd.excalidraw+json' }),
      new File([pngMagicBytes], 'photo.jpg', { type: 'image/jpeg' }),
      new File(['x'], 'ordinary.jpg', { type: 'image/jpeg' }),
      new File(['x'], 'animation.gif', { type: 'image/gif' }),
      new File(['x'], 'photo.webp', { type: 'image/webp' }),
    ]
    for (const file of blockedFiles) {
      const event = createEvent.drop(host)
      Object.defineProperty(event, 'dataTransfer', {
        value: { files: [file], types: ['Files'] },
      })
      fireEvent(descendant, event)
      expect(event.defaultPrevented).toBe(true)
    }
    expect(canvas.descendantDrop).not.toHaveBeenCalled()

    const mixedDrop = createEvent.drop(host)
    Object.defineProperty(mixedDrop, 'dataTransfer', {
      value: {
        files: [
          new File(['x'], 'ordinary.jpg', { type: 'image/jpeg' }),
          new File(['x'], 'notes.txt', { type: 'text/plain' }),
        ],
        types: ['Files'],
      },
    })
    fireEvent(descendant, mixedDrop)
    expect(mixedDrop.defaultPrevented).toBe(true)
    expect(canvas.descendantDrop).not.toHaveBeenCalled()

    for (const [types, getData] of [
      [['text/plain'], () => 'text'],
      [['application/x-excalidrawlib'], () => 'library'],
    ] as const) {
      const event = createEvent.drop(host)
      Object.defineProperty(event, 'dataTransfer', {
        value: { files: [], types, getData },
      })
      fireEvent(descendant, event)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(canvas.descendantDrop).toHaveBeenCalledTimes(2)
  })

  it('drops pre-sync appState writes but keeps element sync active', async () => {
    const { session, handleLocalAppState, handleLocalChange } = makeSession()
    await renderBoard(session)

    act(() => {
      canvas.onChange!([{ id: 'shape-1' }], { viewBackgroundColor: '#ffffff' }, {})
      canvas.onColorCommit!('#00aa00')
    })

    expect(handleLocalChange).toHaveBeenCalledTimes(1)
    expect(handleLocalAppState).not.toHaveBeenCalled()
  })

  it('syncs an explicit pick after the provider is actually synced', async () => {
    const { session, handleLocalAppState } = makeSession(true)
    await renderBoard(session)

    act(() => {
      canvas.onColorCommit!('#00aa00')
    })

    expect(handleLocalAppState).toHaveBeenCalledWith({ viewBackgroundColor: '#00aa00' })
  })

  it('forwards post-clear white through onChange so the shared doc converges', async () => {
    const { session, provider, handleLocalAppState } = makeSession()
    await renderBoard(session)

    act(() => {
      provider.emitSynced()
    })
    act(() => {
      canvas.onChange!([], { viewBackgroundColor: '#ffffff' }, {})
    })

    expect(handleLocalAppState).toHaveBeenCalledWith({ viewBackgroundColor: '#ffffff' })
  })

  it('opens the provider and binding gates atomically for immediate local background writes', async () => {
    const { session, provider, handleLocalAppState } = makeSession()
    await renderBoard(session)

    act(() => {
      provider.emitSynced()
      canvas.onColorCommit!('#00aa00')
      canvas.onChange!([], { viewBackgroundColor: '#ffffff' }, {})
    })

    expect(handleLocalAppState).toHaveBeenNthCalledWith(1, { viewBackgroundColor: '#00aa00' })
    expect(handleLocalAppState).toHaveBeenNthCalledWith(2, { viewBackgroundColor: '#ffffff' })
  })
})

describe('BoardShell — Octo context-menu integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canvas.onChange = null
    canvas.onContextMenu = null
    canvas.onColorCommit = null
    canvas.renderDefaultMainMenu = undefined
    canvas.appState.selectedElementIds = {}
    canvas.appState.editingLinearElement = null
    canvas.elements = []
    canvas.availableActions.clear()
    canvas.executeAction.mockReset()
    canvas.executeAction.mockReturnValue(true)
    canvas.executeActionWithHostFeedback.mockReset()
    canvas.executeActionWithHostFeedback.mockResolvedValue(true)
    octoToast.success.mockReset()
    octoToast.error.mockReset()
  })

  it('owns ordinary canvas right-click, filters by action availability, and syncs actions through onChange', async () => {
    const { session, handleLocalChange } = makeSession(true, 'writer')
    canvas.availableActions.add('paste')
    await renderBoard(session)

    expect(canvas.renderDefaultMainMenu).toBe(false)
    expect(screen.queryByTestId('main-menu-trigger')).toBeNull()
    expect(canvas.onContextMenu).toBeTruthy()

    canvas.executeActionWithHostFeedback.mockImplementation(async (name: string) => {
      canvas.onChange?.([{ id: 'pasted', version: 1 }], canvas.appState, {})
      return name === 'paste'
    })
    act(() => {
      canvas.onContextMenu?.({
        event: new MouseEvent('contextmenu', { clientX: 80, clientY: 90 }),
        type: 'canvas',
        sceneX: 120,
        sceneY: 140,
        selectedElementIds: {},
      })
    })

    const menu = await screen.findByRole('menu')
    expect(menu.textContent).toContain('docs.board.comment.contextMenu')
    expect(menu.textContent).toContain('docs.board.contextMenu.paste')
    expect(menu.textContent).not.toContain('docs.board.contextMenu.selectAll')

    fireEvent.click(screen.getByRole('menuitem', { name: /docs\.board\.contextMenu\.paste/ }))
    await vi.waitFor(() => {
      expect(canvas.executeActionWithHostFeedback).toHaveBeenCalledWith('paste')
      expect(handleLocalChange).toHaveBeenCalledWith([{ id: 'pasted', version: 1 }], {})
      expect(octoToast.success).toHaveBeenCalledWith('docs.board.contextMenu.pasteSuccess')
      expect(screen.queryByRole('menu')).toBeNull()
    })
    expect(canvas.executeAction).not.toHaveBeenCalled()
  })

  it('keeps the menu open and reports a rejected context-menu paste', async () => {
    const { session } = makeSession(true, 'writer')
    canvas.availableActions.add('paste')
    canvas.executeActionWithHostFeedback.mockResolvedValue(false)
    await renderBoard(session)

    act(() => {
      canvas.onContextMenu?.({
        event: new MouseEvent('contextmenu', { clientX: 80, clientY: 90 }),
        type: 'canvas',
        sceneX: 120,
        sceneY: 140,
        selectedElementIds: {},
      })
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: /docs\.board\.contextMenu\.paste/ }))

    await vi.waitFor(() => {
      expect(octoToast.error).toHaveBeenCalledWith('docs.board.contextMenu.pasteFailed')
    })
    expect(octoToast.success).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('keeps the menu open and reports a context-menu paste exception', async () => {
    const { session } = makeSession(true, 'writer')
    canvas.availableActions.add('paste')
    canvas.executeActionWithHostFeedback.mockRejectedValue(new Error('clipboard denied'))
    await renderBoard(session)

    act(() => {
      canvas.onContextMenu?.({
        event: new MouseEvent('contextmenu', { clientX: 80, clientY: 90 }),
        type: 'canvas',
        sceneX: 120,
        sceneY: 140,
        selectedElementIds: {},
      })
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: /docs\.board\.contextMenu\.paste/ }))

    await vi.waitFor(() => {
      expect(octoToast.error).toHaveBeenCalledWith('docs.board.contextMenu.pasteFailed')
    })
    expect(octoToast.success).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('uses the post-hit-test element selection for an Alt+right-click comment anchor', async () => {
    const { session } = makeSession(true, 'writer')
    canvas.appState.selectedElementIds = { 'bound-text': true }
    canvas.elements = [
      { id: 'shape-1', type: 'rectangle', x: 20, y: 30, width: 100, height: 60, isDeleted: false },
      { id: 'bound-text', type: 'text', x: 40, y: 50, width: 20, height: 10, containerId: 'shape-1', isDeleted: false },
    ]
    canvas.availableActions.add('copy')
    await renderBoard(session)

    act(() => {
      canvas.onContextMenu?.({
        event: new MouseEvent('contextmenu', { clientX: 160, clientY: 170, altKey: true }),
        type: 'element',
        sceneX: 55,
        sceneY: 60,
        selectedElementIds: { 'bound-text': true },
      })
    })

    const menu = await screen.findByRole('menu')
    expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(1)
    expect(menu.textContent).toContain('docs.board.comment.contextMenu')
    expect(menu.textContent).not.toContain('docs.board.contextMenu.copy')

    fireEvent.click(screen.getByRole('menuitem', { name: /docs\.board\.comment\.contextMenu/ }))
    const target = document.querySelector('.octo-board-inline-comment-target')
    expect(target?.textContent).toContain('docs.board.comment.element')
    expect(target?.textContent).toContain('docs.board.comment.elementTypes.rectangle')
  })

  it('shows one host-owned success only after an asynchronous PNG copy completes', async () => {
    const { session } = makeSession(true, 'writer')
    canvas.availableActions.add('copyAsPng')
    let completeCopy!: (value: boolean) => void
    canvas.executeActionWithHostFeedback.mockReturnValue(new Promise((resolve) => {
      completeCopy = resolve
    }))
    await renderBoard(session)

    act(() => {
      canvas.onContextMenu?.({
        event: new MouseEvent('contextmenu', { clientX: 80, clientY: 90 }),
        type: 'canvas',
        sceneX: 120,
        sceneY: 140,
        selectedElementIds: {},
      })
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: /docs\.board\.contextMenu\.copyAsPng/ }))

    expect(canvas.executeActionWithHostFeedback).toHaveBeenCalledWith('copyAsPng')
    expect(octoToast.success).not.toHaveBeenCalled()
    await act(async () => { completeCopy(true) })
    expect(octoToast.success).toHaveBeenCalledWith('docs.board.contextMenu.copySuccessFormat')
    expect(octoToast.error).not.toHaveBeenCalled()
  })

  it('routes asynchronous SVG copy failures to the host error toast', async () => {
    const { session } = makeSession(true, 'writer')
    canvas.availableActions.add('copyAsSvg')
    canvas.executeActionWithHostFeedback.mockRejectedValue(new Error('clipboard denied'))
    await renderBoard(session)

    act(() => {
      canvas.onContextMenu?.({
        event: new MouseEvent('contextmenu', { clientX: 80, clientY: 90 }),
        type: 'canvas',
        sceneX: 120,
        sceneY: 140,
        selectedElementIds: {},
      })
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: /docs\.board\.contextMenu\.copyAsSvg/ }))

    await vi.waitFor(() => {
      expect(octoToast.error).toHaveBeenCalledWith('docs.board.contextMenu.copyFailedFormat')
    })
    expect(octoToast.success).not.toHaveBeenCalled()
  })

  it('copies successfully before deleting for a safe context-menu cut', async () => {
    const { session } = makeSession(true, 'writer')
    canvas.appState.selectedElementIds = { 'shape-1': true }
    canvas.elements = [
      { id: 'shape-1', type: 'rectangle', x: 20, y: 30, width: 100, height: 60, version: 3, versionNonce: 30, isDeleted: false },
    ]
    canvas.availableActions.add('copy')
    canvas.availableActions.add('deleteSelectedElements')
    let completeCopy!: (value: boolean) => void
    canvas.executeActionWithHostFeedback.mockImplementation((name: string) => name === 'copy'
      ? new Promise((resolve) => { completeCopy = resolve })
      : Promise.resolve(true))
    await renderBoard(session)

    act(() => {
      canvas.onContextMenu?.({
        event: new MouseEvent('contextmenu', { clientX: 160, clientY: 170 }),
        type: 'element',
        sceneX: 55,
        sceneY: 60,
        selectedElementIds: { 'shape-1': true },
      })
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: /^docs\.board\.contextMenu\.cut⌘X$/ }))

    expect(canvas.executeActionWithHostFeedback).toHaveBeenCalledWith('copy')
    expect(canvas.executeActionWithHostFeedback).not.toHaveBeenCalledWith('deleteSelectedElements')
    await act(async () => { completeCopy(true) })
    expect(canvas.executeActionWithHostFeedback).toHaveBeenCalledWith('deleteSelectedElements')
    expect(canvas.executeAction).not.toHaveBeenCalled()
    expect(octoToast.success).toHaveBeenCalledWith('docs.board.contextMenu.cutSuccess')
    expect(octoToast.error).not.toHaveBeenCalled()
  })

  it('hides context-menu cut while a linear element is being point-edited', async () => {
    const { session } = makeSession(true, 'writer')
    canvas.appState.selectedElementIds = { 'line-1': true }
    canvas.appState.editingLinearElement = { elementId: 'line-1' }
    canvas.elements = [
      { id: 'line-1', type: 'line', x: 20, y: 30, width: 100, height: 60, version: 3, versionNonce: 30, isDeleted: false },
    ]
    canvas.availableActions.add('copy')
    canvas.availableActions.add('deleteSelectedElements')
    await renderBoard(session)

    act(() => {
      canvas.onContextMenu?.({
        event: new MouseEvent('contextmenu', { clientX: 160, clientY: 170 }),
        type: 'element',
        sceneX: 55,
        sceneY: 60,
        selectedElementIds: { 'line-1': true },
      })
    })

    const menu = await screen.findByRole('menu')
    expect(menu.textContent).not.toContain('docs.board.contextMenu.cut')
  })

  it('does not delete when point editing starts while clipboard copy is pending', async () => {
    const { session } = makeSession(true, 'writer')
    canvas.appState.selectedElementIds = { 'line-1': true }
    canvas.elements = [
      { id: 'line-1', type: 'line', x: 20, y: 30, width: 100, height: 60, version: 3, versionNonce: 30, isDeleted: false },
    ]
    canvas.availableActions.add('copy')
    canvas.availableActions.add('deleteSelectedElements')
    let completeCopy!: (value: boolean) => void
    canvas.executeActionWithHostFeedback.mockReturnValue(new Promise((resolve) => {
      completeCopy = resolve
    }))
    await renderBoard(session)

    act(() => {
      canvas.onContextMenu?.({
        event: new MouseEvent('contextmenu', { clientX: 160, clientY: 170 }),
        type: 'element',
        sceneX: 55,
        sceneY: 60,
        selectedElementIds: { 'line-1': true },
      })
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: /^docs\.board\.contextMenu\.cut⌘X$/ }))

    canvas.appState.editingLinearElement = { elementId: 'line-1' }
    await act(async () => { completeCopy(true) })

    expect(canvas.executeActionWithHostFeedback).not.toHaveBeenCalledWith('deleteSelectedElements')
    expect(octoToast.error).toHaveBeenCalledWith('docs.board.contextMenu.cutSelectionChanged')
    expect(octoToast.success).not.toHaveBeenCalled()
  })

  it('does not delete when a selected element revision changes while clipboard copy is pending', async () => {
    const { session } = makeSession(true, 'writer')
    canvas.appState.selectedElementIds = { 'shape-1': true }
    canvas.elements = [
      { id: 'shape-1', type: 'rectangle', x: 20, y: 30, width: 100, height: 60, version: 3, versionNonce: 30, isDeleted: false },
    ]
    canvas.availableActions.add('copy')
    canvas.availableActions.add('deleteSelectedElements')
    let completeCopy!: (value: boolean) => void
    canvas.executeActionWithHostFeedback.mockReturnValue(new Promise((resolve) => {
      completeCopy = resolve
    }))
    await renderBoard(session)

    act(() => {
      canvas.onContextMenu?.({
        event: new MouseEvent('contextmenu', { clientX: 160, clientY: 170 }),
        type: 'element',
        sceneX: 55,
        sceneY: 60,
        selectedElementIds: { 'shape-1': true },
      })
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: /^docs\.board\.contextMenu\.cut⌘X$/ }))

    canvas.elements = [
      { id: 'shape-1', type: 'rectangle', x: 80, y: 90, width: 100, height: 60, version: 4, versionNonce: 40, isDeleted: false },
    ]
    await act(async () => { completeCopy(true) })

    expect(canvas.executeActionWithHostFeedback).not.toHaveBeenCalledWith('deleteSelectedElements')
    expect(octoToast.error).toHaveBeenCalledWith('docs.board.contextMenu.cutSelectionChanged')
    expect(octoToast.success).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'bound text',
      selected: { id: 'shape-1', type: 'rectangle', boundElements: [{ id: 'text-1', type: 'text' }] },
      related: { id: 'text-1', type: 'text', containerId: 'shape-1' },
    },
    {
      name: 'frame descendant',
      selected: { id: 'frame-1', type: 'frame' },
      related: { id: 'child-1', type: 'rectangle', frameId: 'frame-1' },
    },
    {
      name: 'bound elbow arrow',
      selected: { id: 'shape-1', type: 'rectangle', boundElements: [{ id: 'arrow-1', type: 'arrow' }] },
      related: {
        id: 'arrow-1',
        type: 'arrow',
        elbowed: true,
        startBinding: { elementId: 'shape-1' },
        endBinding: null,
      },
    },
  ])('does not delete when a related $name revision changes while clipboard copy is pending', async ({ selected, related }) => {
    const { session } = makeSession(true, 'writer')
    canvas.appState.selectedElementIds = { [selected.id]: true }
    canvas.elements = [
      { ...selected, x: 20, y: 30, width: 100, height: 60, version: 3, versionNonce: 30, isDeleted: false },
      { ...related, x: 30, y: 40, width: 40, height: 20, version: 5, versionNonce: 50, isDeleted: false },
    ]
    canvas.availableActions.add('copy')
    canvas.availableActions.add('deleteSelectedElements')
    let completeCopy!: (value: boolean) => void
    canvas.executeActionWithHostFeedback.mockReturnValue(new Promise((resolve) => {
      completeCopy = resolve
    }))
    await renderBoard(session)

    act(() => {
      canvas.onContextMenu?.({
        event: new MouseEvent('contextmenu', { clientX: 160, clientY: 170 }),
        type: 'element',
        sceneX: 55,
        sceneY: 60,
        selectedElementIds: { [selected.id]: true },
      })
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: /^docs\.board\.contextMenu\.cut⌘X$/ }))

    canvas.elements = [
      canvas.elements[0],
      { ...canvas.elements[1], version: 6, versionNonce: 60 },
    ]
    await act(async () => { completeCopy(true) })

    expect(canvas.executeActionWithHostFeedback).not.toHaveBeenCalledWith('deleteSelectedElements')
    expect(octoToast.error).toHaveBeenCalledWith('docs.board.contextMenu.cutSelectionChanged')
    expect(octoToast.success).not.toHaveBeenCalled()
  })

  it.each([
    ['returns false', () => Promise.resolve(false)],
    ['throws', () => { throw new Error('delete threw') }],
    ['rejects asynchronously', () => Promise.reject(new Error('delete rejected'))],
  ])('does not report cut success when deletion %s', async (_case, deleteResult) => {
    const { session } = makeSession(true, 'writer')
    canvas.appState.selectedElementIds = { 'shape-1': true }
    canvas.elements = [
      { id: 'shape-1', type: 'rectangle', x: 20, y: 30, width: 100, height: 60, version: 3, versionNonce: 30, isDeleted: false },
    ]
    canvas.availableActions.add('copy')
    canvas.availableActions.add('deleteSelectedElements')
    canvas.executeActionWithHostFeedback.mockImplementation((name: string) => name === 'copy'
      ? Promise.resolve(true)
      : deleteResult())
    await renderBoard(session)

    act(() => {
      canvas.onContextMenu?.({
        event: new MouseEvent('contextmenu', { clientX: 160, clientY: 170 }),
        type: 'element',
        sceneX: 55,
        sceneY: 60,
        selectedElementIds: { 'shape-1': true },
      })
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: /^docs\.board\.contextMenu\.cut⌘X$/ }))

    await vi.waitFor(() => {
      expect(octoToast.error).toHaveBeenCalledWith('docs.board.contextMenu.cutDeleteFailed')
    })
    expect(octoToast.success).not.toHaveBeenCalled()
  })

  it('keeps the selected elements when context-menu cut cannot write the clipboard', async () => {
    const { session } = makeSession(true, 'writer')
    canvas.appState.selectedElementIds = { 'shape-1': true }
    canvas.elements = [
      { id: 'shape-1', type: 'rectangle', x: 20, y: 30, width: 100, height: 60, isDeleted: false },
    ]
    canvas.availableActions.add('copy')
    canvas.availableActions.add('deleteSelectedElements')
    canvas.executeActionWithHostFeedback.mockRejectedValue(new Error('clipboard denied'))
    await renderBoard(session)

    act(() => {
      canvas.onContextMenu?.({
        event: new MouseEvent('contextmenu', { clientX: 160, clientY: 170 }),
        type: 'element',
        sceneX: 55,
        sceneY: 60,
        selectedElementIds: { 'shape-1': true },
      })
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: /^docs\.board\.contextMenu\.cut⌘X$/ }))

    await vi.waitFor(() => {
      expect(octoToast.error).toHaveBeenCalledWith('docs.board.contextMenu.cutFailed')
    })
    expect(canvas.executeActionWithHostFeedback).not.toHaveBeenCalledWith('deleteSelectedElements')
    expect(canvas.appState.selectedElementIds).toEqual({ 'shape-1': true })
    expect(octoToast.success).not.toHaveBeenCalled()
  })

  it.each([
    ['copyStyles', 'docs.board.contextMenu.copyStylesSuccess'],
    ['addToLibrary', 'docs.board.contextMenu.addToLibrarySuccess'],
  ])('routes %s feedback through the host toast and suppresses the native result toast', async (action, successMessage) => {
    const { session } = makeSession(true, 'writer')
    canvas.appState.selectedElementIds = { 'shape-1': true }
    canvas.elements = [
      { id: 'shape-1', type: 'rectangle', x: 20, y: 30, width: 100, height: 60, isDeleted: false },
    ]
    canvas.availableActions.add(action)
    await renderBoard(session)

    act(() => {
      canvas.onContextMenu?.({
        event: new MouseEvent('contextmenu', { clientX: 160, clientY: 170 }),
        type: 'element',
        sceneX: 55,
        sceneY: 60,
        selectedElementIds: { 'shape-1': true },
      })
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp(`docs\\.board\\.contextMenu\\.${action}`) }))

    await vi.waitFor(() => {
      expect(canvas.executeActionWithHostFeedback).toHaveBeenCalledWith(action)
      expect(octoToast.success).toHaveBeenCalledWith(successMessage)
    })
    expect(canvas.executeAction).not.toHaveBeenCalled()
    expect(octoToast.error).not.toHaveBeenCalled()
  })

  it('routes host-owned style feedback failures to the top error toast', async () => {
    const { session } = makeSession(true, 'writer')
    canvas.appState.selectedElementIds = { 'shape-1': true }
    canvas.elements = [
      { id: 'shape-1', type: 'rectangle', x: 20, y: 30, width: 100, height: 60, isDeleted: false },
    ]
    canvas.availableActions.add('copyStyles')
    canvas.executeActionWithHostFeedback.mockRejectedValue(new Error('style copy failed'))
    await renderBoard(session)

    act(() => {
      canvas.onContextMenu?.({
        event: new MouseEvent('contextmenu', { clientX: 160, clientY: 170 }),
        type: 'element',
        sceneX: 55,
        sceneY: 60,
        selectedElementIds: { 'shape-1': true },
      })
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: /docs\.board\.contextMenu\.copyStyles/ }))

    await vi.waitFor(() => {
      expect(octoToast.error).toHaveBeenCalledWith('docs.board.contextMenu.copyStylesFailed')
    })
    expect(octoToast.success).not.toHaveBeenCalled()
  })

  it('keeps a reader’s safe copy/export/link actions while hiding comment + mutation actions', async () => {
    const { session } = makeSession(true, 'reader')
    canvas.appState.selectedElementIds = { 'shape-1': true }
    canvas.elements = [
      { id: 'shape-1', type: 'rectangle', x: 20, y: 30, width: 100, height: 60, isDeleted: false },
    ]
    for (const action of [
      'copy',
      'copyAsPng',
      'copyAsSvg',
      'copyText',
      'copyElementLink',
      'cut',
      'duplicateSelection',
      'deleteSelectedElements',
    ]) {
      canvas.availableActions.add(action)
    }
    await renderBoard(session)

    act(() => {
      canvas.onContextMenu?.({
        event: new MouseEvent('contextmenu', { clientX: 160, clientY: 170 }),
        type: 'element',
        sceneX: 55,
        sceneY: 60,
        selectedElementIds: { 'shape-1': true },
      })
    })

    const menu = await screen.findByRole('menu')
    // A reader may VIEW comments but not create them: the comment entry is gone (canComment=false).
    expect(menu.textContent).not.toContain('docs.board.comment.contextMenu')
    for (const action of ['copy', 'copyAsPng', 'copyAsSvg', 'copyText', 'copyElementLink']) {
      expect(menu.textContent).toContain(`docs.board.contextMenu.${action}`)
    }
    expect(menu.textContent).not.toContain('docs.board.contextMenu.cut')
    expect(menu.textContent).not.toContain('docs.board.contextMenu.duplicate')
    expect(menu.textContent).not.toContain('docs.board.contextMenu.delete')

    fireEvent.click(screen.getByRole('menuitem', { name: /^docs\.board\.contextMenu\.copy⌘C$/ }))
    expect(canvas.executeActionWithHostFeedback).toHaveBeenCalledWith('copy')
    expect(canvas.executeAction).not.toHaveBeenCalled()
    expect(document.querySelector('.octo-board-feedback')).toBeNull()
  })
})
