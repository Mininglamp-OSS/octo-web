import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import type { WhiteboardSession } from '../collab/connect.ts'

const canvas = vi.hoisted(() => ({
  onChange: null as
    | null
    | ((els: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => void),
  onColorCommit: null as null | ((color: string) => void),
}))

vi.mock('@excalidraw/excalidraw', () => {
  const Excalidraw = ({
    children,
    excalidrawAPI,
    onChange,
  }: {
    children?: ReactNode
    excalidrawAPI?: (api: unknown) => void
    onChange?: (els: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => void
  }) => {
    useEffect(() => {
      excalidrawAPI?.({ updateScene: () => {}, getAppState: () => ({}) })
      canvas.onChange = onChange ?? null
      return () => { canvas.onChange = null }
    }, [excalidrawAPI, onChange])
    return <div data-testid="excalidraw-canvas">{children}</div>
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
  loadBoardScene: () => null,
  persistBoardScene: () => true,
  clearBoardScene: () => {},
}))

import { BoardShell } from '../BoardShell.tsx'

function makeSession(initiallySynced = false): {
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
    getRole: () => 'writer' as const,
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
  expect(canvas.onChange).toBeTruthy()
  expect(canvas.onColorCommit).toBeTruthy()
}

describe('BoardShell — provider-gated canvas background convergence (PR #1161 P1-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canvas.onChange = null
    canvas.onColorCommit = null
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
