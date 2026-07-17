import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { BoardTerminal } from '../collab/index.ts'
import type { WhiteboardSession } from '../collab/connect.ts'
import { setWKApp } from '../../octoweb/index.ts'
import { createMockWKApp } from '../../octoweb/mock.ts'

// XIN-1306 regression: the board's "forward to chat" must send the LIVE title, not the static
// `title` prop. DocTitle fetches the real title on mount and surfaces it via onTitleLoaded;
// BoardShell lifts it into `currentTitle` and forwards that. An empty title falls back to the
// board-specific "未命名画板" (docs.board.untitled), not the generic doc key. Mirrors the
// EditorShell live-title test.
//
// Excalidraw stand-in (same shape as BoardShellHeader.test): hands the imperative API up once from
// a mount effect so BoardShell's excalidrawApi state settles without an update loop.
vi.mock('@excalidraw/excalidraw', async () => {
  const { useEffect } = await import('react')
  const api = { updateScene: () => {}, getAppState: () => ({}), updateLibrary: async () => [] }
  const Excalidraw = ({
    children,
    excalidrawAPI,
  }: {
    children?: ReactNode
    excalidrawAPI?: (api: unknown) => void
  }) => {
    useEffect(() => {
      excalidrawAPI?.(api)
    }, [excalidrawAPI])
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

import { BoardShell } from '../BoardShell.tsx'

/** Minimal awareness double (PresenceBar + the board presence effect touch only this surface). */
function makeAwareness() {
  return {
    clientID: 1,
    getStates: () => new Map(),
    setLocalStateField: () => {},
    on: () => {},
    off: () => {},
  }
}

/** Session stub exposing just the surface BoardShell reads: an authoritative role + a provider. */
function makeSession(role: 'admin' | 'writer' | 'reader'): WhiteboardSession {
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
    subscribeTerminal: (_cb: (t: BoardTerminal) => void) => () => {},
    binding,
    provider: {
      awareness: makeAwareness(),
      isSynced: true,
      on: () => {},
      off: () => {},
    },
  } as unknown as WhiteboardSession
}

let wk: ReturnType<typeof createMockWKApp>

beforeEach(() => {
  wk = createMockWKApp()
  setWKApp(wk)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('BoardShell — forward-to-chat sends the live title, not the stale prop (XIN-1306)', () => {
  it('forwards the real title after DocTitle fetches it (currentTitle), not the static title prop', async () => {
    // The board's real title differs from the prop the shell was opened with.
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/doc-1') {
        return { data: { docId: 'doc-1', title: 'Live Board Title' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(
      <BoardShell
        docId="doc-1"
        title="Stale Prop Title"
        space="s1"
        collabSession={makeSession('admin')}
        collab
      />,
    )

    await screen.findByTestId('excalidraw-canvas')
    // The header shows the fetched (live) title once DocTitle's mount fetch resolves — proving
    // onTitleLoaded fired and BoardShell lifted it into currentTitle.
    await waitFor(() => expect(screen.getByText('Live Board Title')).toBeTruthy())

    fireEvent.click(await screen.findByTitle('docs.forward.entry'))

    await waitFor(() => expect(wk.openDocForwardCalls.length).toBe(1))
    expect(wk.openDocForwardCalls[0].title).toBe('Live Board Title')
    expect(wk.openDocForwardCalls[0].title).not.toBe('Stale Prop Title')
  })

  it('falls back to the board-specific "未命名画板" key when the live title is empty', async () => {
    // An untitled board: the fetched title is empty, so currentTitle stays empty.
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/doc-1') {
        return { data: { docId: 'doc-1', title: '' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(
      <BoardShell docId="doc-1" title="" space="s1" collabSession={makeSession('admin')} collab />,
    )

    await screen.findByTestId('excalidraw-canvas')
    fireEvent.click(await screen.findByTitle('docs.forward.entry'))

    await waitFor(() => expect(wk.openDocForwardCalls.length).toBe(1))
    // The board fallback key (t() stub returns the key unchanged), NOT the generic doc key
    // docs.state.untitled that startDocForward would otherwise apply to an empty title.
    expect(wk.openDocForwardCalls[0].title).toBe('docs.board.untitled')
    expect(wk.openDocForwardCalls[0].title).not.toBe('docs.state.untitled')
  })
})
