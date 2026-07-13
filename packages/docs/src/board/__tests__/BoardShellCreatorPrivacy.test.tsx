import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { BoardTerminal } from '../collab/index.ts'
import type { WhiteboardSession } from '../collab/connect.ts'
import { setWKApp } from '../../octoweb/index.ts'
import { createMockWKApp } from '../../octoweb/mock.ts'

// Excalidraw stand-in (same shape the other BoardShell tests use): hands the imperative API up once
// from a mount effect so BoardShell's excalidrawApi state settles without spinning an update loop.
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

// useMemberNames drives the creator-name resolution's PRIMARY source (the space-member map). Kept as
// an overridable hoisted spy so a test can seed the map with the owner and assert that the standalone
// nickname-only path bypasses it (XIN-392 P2-1, mirroring the EditorShell coverage).
const { useMemberNamesMock } = vi.hoisted(() => ({
  useMemberNamesMock: vi.fn(() => new Map<string, string>()),
}))
vi.mock('../../members/useMemberNames.ts', () => ({ useMemberNames: useMemberNamesMock }))

// Imported AFTER the mocks so the mocked modules are in place.
import { BoardShell } from '../BoardShell.tsx'

/** Minimal awareness double for PresenceBar / the board presence effect. */
function makeAwareness() {
  return {
    clientID: 1,
    getStates: () => new Map(),
    setLocalStateField: () => {},
    on: () => {},
    off: () => {},
  }
}

/** Session stub with a provider (so the presence bar renders) and a role. */
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
  useMemberNamesMock.mockReset()
  useMemberNamesMock.mockReturnValue(new Map<string, string>())
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('BoardShell creator-name privacy on the shared surface (XIN-392 P2-1)', () => {
  it('standalone (creatorNicknameOnly) resolves nickname-only and never leaks the creator real_name', async () => {
    // Simulate the future backend that fills the space-member display name with a VERIFIED real
    // name. On the externally shared standalone board this must never reach a link holder — the
    // creator name has to resolve through the nickname-only getUserName path, not the member map.
    useMemberNamesMock.mockReturnValue(new Map([['u_owner', 'Real Legal Name']]))
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/board-1') {
        return { data: { docId: 'board-1', title: 'Board', ownerId: 'u_owner' }, status: 200 }
      }
      if (method === 'get' && url === '/users/u_owner') {
        // Nickname-only fetch: real_name present but must be ignored (preferRealName:false).
        return { data: { name: 'Nick', real_name: 'Real Legal Name' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(
      <BoardShell
        docId="board-1"
        title="Board"
        space="s1"
        collabSession={makeSession('admin')}
        collab
        creatorNicknameOnly
      />,
    )
    await screen.findByTestId('excalidraw-canvas')

    // The nickname-only resolver is called despite the member map already holding a name.
    await waitFor(() =>
      expect(wk.apiClient.calls.some((c) => c.url === '/users/u_owner')).toBe(true),
    )

    // Open the ≡ more menu, where the creator head renders.
    const moreBtn = document.querySelector<HTMLButtonElement>('.octo-doc-more-btn')!
    act(() => moreBtn.click())

    await waitFor(() => expect(screen.getByText('Nick')).toBeTruthy())
    // The verified real name from the member map never surfaces on the shared surface.
    expect(screen.queryByText('Real Legal Name')).toBeNull()
  })

  it('in-app (creatorNicknameOnly unset) still uses the member map first, no /users fetch', async () => {
    // Unchanged in-app behavior: the already-loaded member map is the free primary source, so the
    // creator name comes straight from it and getUserName is never called.
    useMemberNamesMock.mockReturnValue(new Map([['u_owner', 'Member Name']]))
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/board-1') {
        return { data: { docId: 'board-1', title: 'Board', ownerId: 'u_owner' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(
      <BoardShell docId="board-1" title="Board" space="s1" collabSession={makeSession('admin')} collab />,
    )
    await screen.findByTestId('excalidraw-canvas')

    // Wait for the doc meta (ownerId) to land so the creator effect has run.
    await waitFor(() =>
      expect(wk.apiClient.calls.some((c) => c.url === '/docs/board-1')).toBe(true),
    )

    const moreBtn = document.querySelector<HTMLButtonElement>('.octo-doc-more-btn')!
    act(() => moreBtn.click())

    await waitFor(() => expect(screen.getByText('Member Name')).toBeTruthy())
    // Member map hit → the /users/:uid fallback is never reached in-app.
    expect(wk.apiClient.calls.some((c) => c.url === '/users/u_owner')).toBe(false)
  })
})
