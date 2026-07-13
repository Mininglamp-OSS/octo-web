import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { BoardTerminal } from '../collab/index.ts'
import type { WhiteboardSession } from '../collab/connect.ts'

// Capture the live `onChange` the shell passes to the canvas so a test can drive an edit (the debounce
// path). The holder lives in vi.hoisted so the (hoisted) vi.mock factory below can populate it.
const canvas = vi.hoisted(() => ({
  onChange: null as null | ((els: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => void),
}))

// Stand-in for Excalidraw's client-only dynamic import — a marker div plus the imperative API, and it
// forwards `onChange` into the holder so the test can fire an edit while the canvas is editable.
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
    excalidrawAPI?.({ updateScene: () => {}, getAppState: () => ({}) })
    canvas.onChange = onChange ?? null
    return <div data-testid="excalidraw-canvas">{children}</div>
  }
  const MainMenu = (() => null) as unknown as { DefaultItems: Record<string, unknown> }
  MainMenu.DefaultItems = {}
  return {
    Excalidraw,
    MainMenu,
    restoreElements: (els: readonly unknown[] | null | undefined) => (els ? [...els] : []),
    reconcileElements: (local: readonly unknown[]) => [...local],
    // The shell captures this off the same dynamic import to power the library import button; vitest
    // module mocks throw on access to an undeclared export, so it must be present even though this
    // suite never exercises the import path.
    loadLibraryFromBlob: async () => [],
    serializeLibraryAsJSON: () => '[]',
  }
})
vi.mock('@excalidraw/excalidraw/index.css', () => ({}))

// Spy on the local-mirror seam so the test can assert the ORDER of writes: a clear must never be
// followed by a re-persist. The clearBoardScene / persistBoardScene names mirror the real module.
const store = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock('../boardStore.ts', () => ({
  loadBoardScene: () => null,
  persistBoardScene: (..._args: unknown[]) => {
    store.calls.push('persist')
    return true
  },
  clearBoardScene: (..._args: unknown[]) => {
    store.calls.push('clear')
  },
}))

import { BoardShell } from '../BoardShell.tsx'

/** Minimal WhiteboardSession stub exposing only the surface BoardShell reads, plus a terminal hook. */
function makeSession(initialRole: 'writer' | 'reader' = 'writer'): {
  session: WhiteboardSession
  fireTerminal: (t: BoardTerminal) => void
} {
  let terminalCb: ((t: BoardTerminal) => void) | null = null
  const binding = {
    setApi: () => {},
    setRenderAdapter: () => {},
    setFileSync: () => {},
    handleLocalChange: () => {},
    snapshotElements: () => [] as unknown[],
  }
  const session = {
    getRole: () => initialRole,
    subscribeRole: () => () => {},
    subscribeTerminal: (cb: (t: BoardTerminal) => void) => {
      terminalCb = cb
      return () => {
        terminalCb = null
      }
    },
    binding,
    provider: undefined,
  } as unknown as WhiteboardSession
  return { session, fireTerminal: (t: BoardTerminal) => terminalCb?.(t) }
}

describe('BoardShell — pending save is cancelled on terminal clear (P1-1 re-persist race)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.calls = []
    canvas.onChange = null
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not re-persist the cleared scene mirror after a revoke fires the pending debounce', async () => {
    const { session, fireTerminal } = makeSession('writer')
    render(<BoardShell docId="doc-1" title="Shared board" space="s1" collabSession={session} collab />)

    // Wait for the async Excalidraw chunk to mount and hand us the editable `onChange`.
    await screen.findByTestId('excalidraw-canvas')
    expect(canvas.onChange).toBeTruthy()

    // Edit just before the revoke: this arms the SAVE_DEBOUNCE_MS timer and stashes latestScene.
    act(() => {
      canvas.onChange!([{ id: 'shape-1' }], {}, {})
    })
    // The debounce has NOT elapsed yet — no save has happened.
    expect(store.calls).toEqual([])

    // Runtime access loss (connect.ts showForbidden → notifyTerminal({ kind: 'deleted' })): the shell
    // clears the mirror and must also cancel the armed saveTimer + null latestScene.
    act(() => {
      fireTerminal({ kind: 'deleted' })
    })
    expect(store.calls).toContain('clear')

    // Let well past the debounce window elapse. At HEAD the still-armed timer fires here and
    // re-persists the wiped scene ('clear' then 'persist'); with the fix the timer was cancelled.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 800))
    })

    // The cleared mirror must NOT be re-persisted by a late debounce.
    expect(store.calls).not.toContain('persist')
    expect(store.calls).toEqual(['clear'])
  })
})
