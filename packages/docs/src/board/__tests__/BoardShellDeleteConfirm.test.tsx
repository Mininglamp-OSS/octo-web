import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { BoardTerminal } from '../collab/index.ts'
import type { WhiteboardSession } from '../collab/connect.ts'

// Excalidraw stand-in (same shape as the other BoardShell tests): hands the imperative API up ONCE
// from a mount effect so the excalidrawApi state settles instead of spinning an update loop.
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

// Force the delete flow into its "awaiting confirmation" state so the confirm UI renders without
// having to drive the ≡ menu → requestDelete click. Keeps the assertion on the UI shape, not the
// hook's internals (which are covered by useDocDelete's own tests).
vi.mock('../../editor/useDocDelete.ts', () => ({
  useDocDelete: () => ({
    confirming: true,
    deleting: false,
    error: null,
    requestDelete: vi.fn(),
    cancel: vi.fn(),
    confirm: vi.fn(),
  }),
}))

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

describe('BoardShell doc-level delete confirm (XIN-892)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the shared centered ConfirmModal, not the legacy inline banner', async () => {
    render(
      <BoardShell docId="doc-1" title="Shared board" space="s1" collabSession={makeSession('admin')} collab />,
    )
    await screen.findByTestId('excalidraw-canvas')

    // The delete confirm is the shared centered modal (same component the doc + sheet use)…
    expect(document.querySelector('.octo-confirm-overlay')).not.toBeNull()
    expect(document.querySelector('.octo-confirm-modal')).not.toBeNull()
    // …and the early top-of-page inline banner is gone.
    expect(document.querySelector('.octo-docs-delete-confirm')).toBeNull()
  })

  it('uses board-specific wording (not the document phrasing)', async () => {
    render(
      <BoardShell docId="doc-1" title="Shared board" space="s1" collabSession={makeSession('admin')} collab />,
    )
    await screen.findByTestId('excalidraw-canvas')

    const modal = document.querySelector('.octo-confirm-modal')!
    expect(modal.querySelector('.octo-confirm-title')?.textContent).toBe('docs.board.deleteConfirmTitle')
    expect(modal.querySelector('.octo-confirm-message')?.textContent).toBe('docs.board.deleteConfirm')
    // Confirm / cancel reuse the generic delete labels.
    expect(modal.textContent).toContain('docs.doc.delete')
    expect(modal.textContent).toContain('docs.doc.deleteCancel')
  })
})
