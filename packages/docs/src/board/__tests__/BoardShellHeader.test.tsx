import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { BoardTerminal } from '../collab/index.ts'
import type { WhiteboardSession } from '../collab/connect.ts'

// Excalidraw stand-in. Real Excalidraw hands the imperative API up ONCE, with a stable handle; the
// mock mirrors that (a stable object, delivered from a mount effect) so BoardShell's excalidrawApi
// state settles. A naive render-time `excalidrawAPI?.({...})` would hand up a fresh object every
// render and, combined with the provider-driven presence state, spin an update loop. loadLibraryFromBlob
// is exported because BoardShell reads it off the import.
vi.mock('@excalidraw/excalidraw', async () => {
  const { useEffect } = await import('react')
  const api = { updateScene: () => {}, getAppState: () => ({}), updateLibrary: async () => [] }
  const Excalidraw = ({
    children,
    excalidrawAPI,
    UIOptions,
    renderDefaultMainMenu = true,
  }: {
    children?: ReactNode
    excalidrawAPI?: (api: unknown) => void
    UIOptions?: { tools?: Record<string, boolean> }
    renderDefaultMainMenu?: boolean
  }) => {
    useEffect(() => {
      excalidrawAPI?.(api)
    }, [excalidrawAPI])
    return (
      <div data-testid="excalidraw-canvas" data-ui-tools={JSON.stringify(UIOptions?.tools ?? {})}>
        {renderDefaultMainMenu && <button data-testid="main-menu-trigger" type="button">Menu</button>}
        {children}
      </div>
    )
  }
  const menuItem = (name: string) => () => <span data-item={name} />
  const MainMenu = (({ children }: { children?: ReactNode }) => (
    <div data-menu="root">{children}</div>
  )) as unknown as {
    DefaultItems: Record<string, () => ReactNode>
    Separator: () => ReactNode
  }
  MainMenu.DefaultItems = {
    LoadScene: menuItem('LoadScene'),
    SaveToActiveFile: menuItem('SaveToActiveFile'),
    Export: menuItem('Export'),
    SaveAsImage: menuItem('SaveAsImage'),
    SearchMenu: menuItem('SearchMenu'),
    Help: menuItem('Help'),
    ClearCanvas: menuItem('ClearCanvas'),
    ToggleTheme: menuItem('ToggleTheme'),
    ChangeCanvasBackground: menuItem('ChangeCanvasBackground'),
  }
  MainMenu.Separator = menuItem('Separator')
  return {
    FONT_FAMILY: {},
    Excalidraw,
    MainMenu,
    restoreElements: (els: readonly unknown[] | null | undefined) => (els ? [...els] : []),
    reconcileElements: (local: readonly unknown[]) => [...local],
    redrawTextBoundingBox: () => {},
    mutateElement: (element: Record<string, unknown>, updates: Record<string, unknown>) => Object.assign(element, updates),
    loadLibraryFromBlob: async () => [],
    serializeLibraryAsJSON: () => '[]',
    serializeAsJSON: () => '{}',
    exportToBlob: async () => new Blob(),
  }
})
vi.mock('@excalidraw/excalidraw/index.css', () => ({}))

import { BoardShell } from '../BoardShell.tsx'

/** Minimal awareness double: PresenceBar reads getStates()/subscribes; the board presence effect
 *  also writes local state + reads clientID. Only the surface those touch is implemented. */
function makeAwareness() {
  return {
    clientID: 1,
    getStates: () => new Map(),
    setLocalStateField: () => {},
    on: () => {},
    off: () => {},
  }
}

/**
 * Session stub with a provider (so the presence bar renders) and a role. Only the surface BoardShell
 * reads is implemented.
 */
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

describe('BoardShell header alignment with the doc header (XIN-601 item 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the presence bar and the ≡ more menu, and drops the standalone delete button', async () => {
    render(
      <BoardShell docId="doc-1" title="Shared board" space="s1" collabSession={makeSession('admin')} collab />,
    )

    await screen.findByTestId('excalidraw-canvas')

    // Presence cluster mirrors the doc header.
    await waitFor(() => expect(document.querySelector('.octo-presence-bar')).not.toBeNull())
    // Low-frequency / destructive actions collapse behind the ≡ "more" menu…
    const moreBtn = document.querySelector<HTMLButtonElement>('.octo-doc-more-btn')
    expect(moreBtn).not.toBeNull()
    // …so the old always-visible standalone delete button is gone from the header.
    expect(document.querySelector('.octo-doc-delete-btn')).toBeNull()
  })

  it('does not render the Excalidraw upper-left MainMenu entry', async () => {
    render(
      <BoardShell docId="doc-1" title="Shared board" space="s1" collabSession={makeSession('admin')} collab />,
    )

    const canvas = await screen.findByTestId('excalidraw-canvas')
    expect(canvas.querySelector('[data-menu="root"]')).toBeNull()
    expect(canvas.querySelector('[data-testid="main-menu-trigger"]')).toBeNull()
  })

  it('collapses delete into the ≡ menu as the destructive row for a manage role', async () => {
    render(
      <BoardShell docId="doc-1" title="Shared board" space="s1" collabSession={makeSession('admin')} collab />,
    )
    await screen.findByTestId('excalidraw-canvas')

    const moreBtn = document.querySelector<HTMLButtonElement>('.octo-doc-more-btn')!
    act(() => moreBtn.click())

    // The delete row lives in the menu's danger group, not the header.
    await waitFor(() =>
      expect(document.querySelector('.octo-doc-more-item.is-danger')).not.toBeNull(),
    )
  })

  it('omits the delete row for a non-manage (reader) role', async () => {
    render(
      <BoardShell docId="doc-1" title="Shared board" space="s1" collabSession={makeSession('reader')} collab />,
    )
    await screen.findByTestId('excalidraw-canvas')

    const moreBtn = document.querySelector<HTMLButtonElement>('.octo-doc-more-btn')!
    act(() => moreBtn.click())

    // Menu opens, but a reader sees no destructive delete row.
    await waitFor(() => expect(document.querySelector('.octo-doc-more-panel')).not.toBeNull())
    expect(document.querySelector('.octo-doc-more-item.is-danger')).toBeNull()
  })

  it('shows an "Open in new page" row in the ≡ menu when onOpenInNewPage is wired (XIN-621 ②)', async () => {
    const onOpenInNewPage = vi.fn()
    render(
      <BoardShell
        docId="doc-1"
        title="Shared board"
        space="s1"
        collabSession={makeSession('reader')}
        collab
        onOpenInNewPage={onOpenInNewPage}
      />,
    )
    await screen.findByTestId('excalidraw-canvas')

    const moreBtn = document.querySelector<HTMLButtonElement>('.octo-doc-more-btn')!
    act(() => moreBtn.click())

    await waitFor(() => expect(document.querySelector('.octo-doc-more-panel')).not.toBeNull())
    const row = [...document.querySelectorAll<HTMLElement>('.octo-doc-more-item')].find((el) =>
      (el.textContent ?? '').includes('docs.standalone.openInNewPage'),
    )
    expect(row).toBeTruthy()
    act(() => row!.click())
    expect(onOpenInNewPage).toHaveBeenCalledTimes(1)
  })

  it('renders no "Open in new page" row when the handler is omitted (standalone path)', async () => {
    render(
      <BoardShell docId="doc-1" title="Shared board" space="s1" collabSession={makeSession('admin')} collab />,
    )
    await screen.findByTestId('excalidraw-canvas')

    const moreBtn = document.querySelector<HTMLButtonElement>('.octo-doc-more-btn')!
    act(() => moreBtn.click())

    await waitFor(() => expect(document.querySelector('.octo-doc-more-panel')).not.toBeNull())
    const hasOpenRow = [...document.querySelectorAll<HTMLElement>('.octo-doc-more-item')].some((el) =>
      (el.textContent ?? '').includes('docs.standalone.openInNewPage'),
    )
    expect(hasOpenRow).toBe(false)
  })
})
