import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { BoardTerminal } from '../collab/index.ts'
import type { WhiteboardSession } from '../collab/connect.ts'

// Excalidraw stand-in (mirrors BoardShellTerminal.test.tsx): a marker div so a test can assert
// whether the canvas is mounted, forwarding the imperative API as the real component does.
vi.mock('@excalidraw/excalidraw', () => {
  const Excalidraw = ({
    children,
    excalidrawAPI,
  }: {
    children?: ReactNode
    excalidrawAPI?: (api: unknown) => void
  }) => {
    excalidrawAPI?.({ updateScene: () => {}, getAppState: () => ({}) })
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

// The live access recheck (P1 hot path) calls getDoc on the collab path. Drive its outcome so the
// test can reproduce a runtime board deletion / revoke while the page is open. getUserName is a
// benign stub (the header's ≡ menu resolves the creator name through it).
const getDoc = vi.fn()
vi.mock('../../pages/docsApi.ts', () => ({
  getDoc: (...args: unknown[]) => getDoc(...args),
  getUserName: async () => '',
}))

import { BoardShell, BOARD_ACCESS_RECHECK_MS } from '../BoardShell.tsx'

/**
 * Minimal WhiteboardSession stub — the same shape BoardShellTerminal.test.tsx uses. It exposes only
 * the surface BoardShell reads, and (unlike that test) never fires a terminal over the socket: the
 * point here is that the LIVE socket stays silent (a passive viewer is never kicked), so teardown
 * must come from the access recheck, not from a subscribeTerminal callback. `provider: undefined`
 * keeps the presence effect inert.
 */
function makeSilentSession(role: 'writer' | 'reader' = 'reader'): WhiteboardSession {
  const binding = {
    setApi: () => {},
    setRenderAdapter: () => {},
    setFileSync: () => {},
    handleLocalChange: () => {},
    snapshotElements: () => [] as unknown[],
  }
  return {
    getRole: () => role,
    subscribeRole: () => () => {},
    // Socket never surfaces a terminal — mirrors the real backend for an idle viewer.
    subscribeTerminal: (_cb: (t: BoardTerminal) => void) => () => {},
    binding,
    provider: undefined,
  } as unknown as WhiteboardSession
}

const err = (status: number) => Object.assign(new Error(`http ${status}`), { response: { status } })

describe('BoardShell live standalone teardown (P1 hot path — no socket signal)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('tears the canvas down when the open board is deleted (recheck 404) with no socket close', async () => {
    // Access is intact at mount, then the board is deleted elsewhere → the next recheck 404s.
    getDoc.mockResolvedValueOnce({ docId: 'd_b1' }).mockRejectedValue(err(404))

    render(
      <BoardShell docId="d_b1" title="Shared board" space="s1" collabSession={makeSilentSession()} collab />,
    )

    const canvas = await vi.waitFor(() => screen.getByTestId('excalidraw-canvas'))
    expect(canvas).toBeTruthy()

    // No socket terminal ever fires; advancing past the recheck interval is the only teardown path.
    await vi.advanceTimersByTimeAsync(BOARD_ACCESS_RECHECK_MS + 100)

    await vi.waitFor(() => {
      expect(screen.queryByTestId('excalidraw-canvas')).toBeNull()
    })
    expect(screen.getByText('docs.error.permission.notFound')).toBeTruthy()
  })

  it('tears the canvas down on a runtime access revoke (recheck 403 → deleted screen)', async () => {
    getDoc.mockResolvedValueOnce({ docId: 'd_b2' }).mockRejectedValue(err(403))

    render(
      <BoardShell docId="d_b2" title="Shared board" space="s1" collabSession={makeSilentSession()} collab />,
    )
    await vi.waitFor(() => screen.getByTestId('excalidraw-canvas'))

    await vi.advanceTimersByTimeAsync(BOARD_ACCESS_RECHECK_MS + 100)

    await vi.waitFor(() => {
      expect(screen.queryByTestId('excalidraw-canvas')).toBeNull()
    })
    expect(screen.getByText('docs.error.permission.deleted')).toBeTruthy()
  })

  it('keeps the canvas mounted while access stays intact (recheck 200) and on a transient blip (5xx)', async () => {
    // A 200 keeps the board; a later 5xx / offline blip must NOT tear a live canvas down.
    getDoc.mockResolvedValueOnce({ docId: 'd_b3' }).mockRejectedValueOnce(err(500)).mockResolvedValue({ docId: 'd_b3' })

    render(
      <BoardShell docId="d_b3" title="Shared board" space="s1" collabSession={makeSilentSession()} collab />,
    )
    await vi.waitFor(() => screen.getByTestId('excalidraw-canvas'))

    await vi.advanceTimersByTimeAsync(BOARD_ACCESS_RECHECK_MS * 2 + 100)

    expect(screen.getByTestId('excalidraw-canvas')).toBeTruthy()
    expect(screen.queryByText('docs.error.permission.deleted')).toBeNull()
    expect(screen.queryByText('docs.error.permission.notFound')).toBeNull()
  })
})
