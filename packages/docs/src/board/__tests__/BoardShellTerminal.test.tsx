import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { BoardTerminal } from '../collab/index.ts'
import type { WhiteboardSession } from '../collab/connect.ts'

// A stand-in for Excalidraw's client-only dynamic import. The real component touches window/DOM
// and pulls a heavy chunk; here we render a marker div so a test can assert whether the canvas is
// mounted, and forward the imperative API (mirrors the real `excalidrawAPI` prop) so BoardShell's
// gated binding effect wires up as it would in production.
vi.mock('@excalidraw/excalidraw', () => {
  const Excalidraw = ({
    children,
    excalidrawAPI,
  }: {
    children?: ReactNode
    excalidrawAPI?: (api: unknown) => void
  }) => {
    excalidrawAPI?.({ updateScene: () => {}, getAppState: () => ({}) })
    return (
      <div data-testid="excalidraw-canvas">
        {children}
      </div>
    )
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
// Side-effect stylesheet import — no-op in jsdom.
vi.mock('@excalidraw/excalidraw/index.css', () => ({}))

import { BoardShell } from '../BoardShell.tsx'

/**
 * Minimal WhiteboardSession stub. It exposes only the surface BoardShell reads (role +
 * terminal subscriptions and a no-op binding) and hands the test a `fireTerminal` hook so it can
 * drive a runtime terminal transition (4403 revoke / delete) the way the collab socket would.
 */
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
    // No provider → the presence effect no-ops (this test is not about presence).
    provider: undefined,
  } as unknown as WhiteboardSession
  return {
    session,
    fireTerminal: (t: BoardTerminal) => terminalCb?.(t),
  }
}

describe('BoardShell terminal teardown (standalone share page)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('tears down the canvas and shows the terminal screen on a runtime 4403 revoke', async () => {
    const { session, fireTerminal } = makeSession('writer')

    // Standalone share page: BoardSession supplies NO onBack/onExit/onDeleted (there is no
    // resident list to return to), so the terminal effect's returnToList is undefined and cannot
    // navigate away — the render branch is the only thing that can remove the revoked content.
    render(
      <BoardShell docId="doc-1" title="Shared board" space="s1" collabSession={session} collab />,
    )

    // The Excalidraw chunk loads asynchronously; wait for the canvas to mount.
    const canvas = await screen.findByTestId('excalidraw-canvas')
    expect(canvas).toBeTruthy()

    // Runtime access loss (connect.ts showForbidden → notifyTerminal({ kind: 'deleted' })).
    act(() => {
      fireTerminal({ kind: 'deleted' })
    })

    // The canvas must be gone from the DOM (unmounted), not merely read-only, and the shared
    // terminal screen must be shown in its place.
    await waitFor(() => {
      expect(screen.queryByTestId('excalidraw-canvas')).toBeNull()
    })
    expect(screen.getByText('docs.error.permission.deleted')).toBeTruthy()
  })

  it('keeps the canvas mounted while access is intact', async () => {
    const { session } = makeSession('writer')
    render(
      <BoardShell docId="doc-2" title="Shared board" space="s1" collabSession={session} collab />,
    )
    expect(await screen.findByTestId('excalidraw-canvas')).toBeTruthy()
    expect(screen.queryByText('docs.error.permission.deleted')).toBeNull()
  })
})
