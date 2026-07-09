import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { WhiteboardSession } from '../collab/connect.ts'

// Capture the `viewModeEnabled` prop the shell hands the canvas on each render so the test can
// assert editability directly (true === read-only). Lives in vi.hoisted so the hoisted vi.mock
// factory can populate it.
const canvas = vi.hoisted(() => ({
  viewModeEnabled: undefined as boolean | undefined,
}))

vi.mock('@excalidraw/excalidraw', () => {
  // We do NOT invoke `excalidrawAPI` here: this suite only inspects `viewModeEnabled`, and handing
  // back a fresh API object on every render would drive `setExcalidrawApi` into a render loop. The
  // gated presence/binding effects simply no-op while the API stays null, which is fine here.
  const Excalidraw = ({
    children,
    viewModeEnabled,
  }: {
    children?: ReactNode
    viewModeEnabled?: boolean
  }) => {
    canvas.viewModeEnabled = viewModeEnabled
    return <div data-testid="excalidraw-canvas">{children}</div>
  }
  const MainMenu = (() => null) as unknown as { DefaultItems: Record<string, unknown> }
  MainMenu.DefaultItems = {}
  return {
    Excalidraw,
    MainMenu,
    restoreElements: (els: readonly unknown[] | null | undefined) => (els ? [...els] : []),
    reconcileElements: (local: readonly unknown[]) => [...local],
    loadLibraryFromBlob: async () => [],
    serializeLibraryAsJSON: () => '[]',
  }
})
vi.mock('@excalidraw/excalidraw/index.css', () => ({}))
vi.mock('../boardStore.ts', () => ({
  loadBoardScene: () => null,
  persistBoardScene: () => true,
  clearBoardScene: () => {},
  forgetBoard: () => {},
}))

import { BoardShell } from '../BoardShell.tsx'

/** Minimal WhiteboardSession stub exposing only the surface BoardShell reads. */
function makeSession(role: 'writer' | 'reader' = 'writer'): WhiteboardSession {
  return {
    getRole: () => role,
    subscribeRole: () => () => {},
    subscribeTerminal: () => () => {},
    binding: {
      setApi: () => {},
      setRenderAdapter: () => {},
      setFileSync: () => {},
      handleLocalChange: () => {},
      snapshotElements: () => [] as unknown[],
    },
    provider: undefined,
  } as unknown as WhiteboardSession
}

describe('BoardShell — fail-closed editability across an account-switch re-prime (yujiawei P1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    canvas.viewModeEnabled = undefined
  })

  it('keeps the canvas read-only while collabSession is null even if a prior writer role is still set', async () => {
    // A writer session is attached: the board is editable.
    const { rerender } = render(
      <BoardShell docId="doc-1" title="Shared board" space="s1" collabSession={makeSession('writer')} collab />,
    )
    await screen.findByTestId('excalidraw-canvas')
    expect(canvas.viewModeEnabled).toBe(false)

    // Account switch: the shell stays mounted (BoardSession is keyed by docId only) while
    // useWhiteboardSession re-primes, so collabSession transitions through null. The previous
    // account's `role='writer'` is still shell state — the canvas must NOT stay editable during
    // this window. Before the fix `readOnly` read only `role`, leaving viewModeEnabled=false here.
    await act(async () => {
      rerender(<BoardShell docId="doc-1" title="Shared board" space="s1" collabSession={undefined} collab />)
    })
    expect(canvas.viewModeEnabled).toBe(true)
  })
})
