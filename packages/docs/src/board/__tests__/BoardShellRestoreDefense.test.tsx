import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { BoardTerminal } from '../collab/index.ts'
import type { WhiteboardSession } from '../collab/connect.ts'
import { setWKApp } from '../../octoweb/index.ts'
import { createMockWKApp } from '../../octoweb/mock.ts'

// XIN-795 ④ FE depth defence. `BoardShell.initialElements` restores the initially-loaded / cold-reopen
// scene DURING RENDER, outside the collab binding's guarded applyRemote path and outside the
// BoardErrorBoundary (which only wraps the <Excalidraw> subtree). A structurally-invalid persisted
// order key (e.g. the synthetic `r00000003` a since-fixed BE repair produced) makes Excalidraw's real
// `restoreElements` THROW. Before the fix that throw propagated straight out of BoardShell and tore
// down the whole host tree; the fix wraps the restore in try/catch and degrades to an empty initial
// scene so the canvas still mounts (the later observe→applyRemote path can repaint).
//
// This Excalidraw stand-in reproduces that throw: restoreElements rejects any element whose `index`
// fails the jitterbug structural rule, exactly as the real library does.
function isJitterbugValid(index: unknown): boolean {
  if (typeof index !== 'string' || !/^[0-9A-Za-z]+$/.test(index)) return false
  const head = index.charAt(0)
  let intLen = 0
  if (head >= 'a' && head <= 'z') intLen = head.charCodeAt(0) - 97 + 2
  else if (head >= 'A' && head <= 'Z') intLen = 90 - head.charCodeAt(0) + 2
  return intLen > 0 && intLen <= index.length
}

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
    restoreElements: (els: readonly unknown[] | null | undefined) => {
      const arr = els ? [...els] : []
      for (const el of arr) {
        // Mirror the real jitterbug throw on a structurally-invalid `index`.
        if (el && typeof el === 'object' && !isJitterbugValid((el as { index?: unknown }).index)) {
          throw new Error('invalid order key: ' + String((el as { index?: unknown }).index))
        }
      }
      return arr
    },
    reconcileElements: (local: readonly unknown[]) => [...local],
    loadLibraryFromBlob: async () => [],
    serializeLibraryAsJSON: () => '[]',
  }
})
vi.mock('@excalidraw/excalidraw/index.css', () => ({}))
vi.mock('../../members/useMemberNames.ts', () => ({ useMemberNames: () => new Map<string, string>() }))

// Imported AFTER the mocks so the mocked modules are in place.
import { BoardShell } from '../BoardShell.tsx'

function makeAwareness() {
  return {
    clientID: 1,
    getStates: () => new Map(),
    setLocalStateField: () => {},
    on: () => {},
    off: () => {},
  }
}

/** Admin session whose Y.Doc snapshot carries an element with a structurally-invalid order key. */
function makeSessionWithInvalidIndex(): WhiteboardSession {
  const binding = {
    setApi: () => {},
    setRenderAdapter: () => {},
    setFileSync: () => {},
    handleLocalChange: () => {},
    // Cold-reopen seed for BoardShell.initialElements: a single invalid-index element.
    snapshotElements: () => [{ id: 'bad', type: 'rectangle', index: 'r00000003' }] as unknown[],
  }
  return {
    getRole: () => 'admin',
    subscribeRole: () => () => {},
    subscribeTerminal: (_cb: (t: BoardTerminal) => void) => () => {},
    binding,
    provider: { awareness: makeAwareness(), isSynced: true, on: () => {}, off: () => {} },
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

describe('BoardShell restore depth defence (XIN-795 ④)', () => {
  it('degrades to an empty initial scene instead of crashing the shell when restore throws on an invalid key', async () => {
    wk.apiClient.responder = (method: string, url: string) => {
      if (method === 'get' && url === '/docs/board-1') {
        return { data: { docId: 'board-1', title: 'Board', ownerId: 'u_owner' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(
      <BoardShell
        docId="board-1"
        title="Board"
        space="s1"
        collabSession={makeSessionWithInvalidIndex()}
        collab
      />,
    )

    // The canvas mounts: BoardShell caught the restore throw and fed Excalidraw an empty scene rather
    // than letting the throw unmount the host tree. Before the fix this render threw and no canvas
    // appeared.
    expect(await screen.findByTestId('excalidraw-canvas')).toBeTruthy()
  })
})
