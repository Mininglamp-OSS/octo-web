import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { WhiteboardSession } from '../collab/connect.ts'

// Capture the `viewModeEnabled` prop the shell hands the canvas on each render so the test can
// assert editability directly (true === read-only). Lives in vi.hoisted so the hoisted vi.mock
// factory can populate it.
type TestScene = {
  elements: unknown[]
  appState: Record<string, unknown>
  files: Record<string, unknown>
}

const canvas = vi.hoisted(() => ({
  viewModeEnabled: undefined as boolean | undefined,
  // Record initialData once per component mount, matching Excalidraw's one-shot consumption.
  mounts: [] as Array<{ elements?: readonly unknown[]; files?: Record<string, unknown> } | undefined>,
  onChange: null as null | ((elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => void),
}))

const boardStore = vi.hoisted(() => ({
  scenes: new Map<string, TestScene>(),
  loads: [] as Array<{ docId: string; uid?: string }>,
}))

vi.mock('@excalidraw/excalidraw', async () => {
  const { useEffect } = await import('react')
  // We do NOT invoke `excalidrawAPI` here: this suite only inspects `viewModeEnabled`, and handing
  // back a fresh API object on every render would drive `setExcalidrawApi` into a render loop. The
  // gated presence/binding effects simply no-op while the API stays null, which is fine here.
  const Excalidraw = ({
    children,
    viewModeEnabled,
    initialData,
    onChange,
  }: {
    children?: ReactNode
    viewModeEnabled?: boolean
    initialData?: { elements?: readonly unknown[]; files?: Record<string, unknown> }
    onChange?: (elements: readonly unknown[], appState: Record<string, unknown>, files: Record<string, unknown>) => void
  }) => {
    canvas.viewModeEnabled = viewModeEnabled
    useEffect(() => {
      canvas.mounts.push(initialData)
      return () => {
        canvas.onChange = null
      }
    }, [])
    useEffect(() => {
      canvas.onChange = onChange ?? null
    }, [onChange])
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
    mutateElement: (element: Record<string, unknown>, updates: Record<string, unknown>) => Object.assign(element, updates),
    loadLibraryFromBlob: async () => [],
    serializeLibraryAsJSON: () => '[]',
    serializeAsJSON: () => '{}',
  }
})
vi.mock('@excalidraw/excalidraw/index.css', () => ({}))
vi.mock('../boardStore.ts', () => ({
  loadBoardScene: (docId: string, uid?: string) => {
    boardStore.loads.push({ docId, uid })
    return boardStore.scenes.get(`${uid ?? 'anonymous'}::${docId}`) ?? null
  },
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
    canvas.mounts = []
    canvas.onChange = null
    boardStore.scenes.clear()
    boardStore.loads = []
  })

  it('mounts an imported scene only after access and forwards its first change into Yjs', async () => {
    const importedElement = { id: 'imported-1', type: 'rectangle', version: 1 }
    const importedFile = { id: 'file-1', dataURL: 'data:image/png;base64,AA==' }
    boardStore.scenes.set('u_importer::imported-board', {
      elements: [importedElement],
      appState: { viewBackgroundColor: '#f8f8f8' },
      files: { 'file-1': importedFile },
    })
    const session = makeSession('writer')
    const handleLocalChange = vi.spyOn(session.binding, 'handleLocalChange')

    render(
      <BoardShell
        docId="imported-board"
        title="Imported board"
        space="s1"
        collabSession={session}
        collab
        user={{ id: 'u_importer', name: 'Importer' }}
      />,
    )

    await screen.findByTestId('excalidraw-canvas')
    expect(canvas.mounts.at(-1)?.elements).toEqual([importedElement])
    expect(canvas.mounts.at(-1)?.files).toEqual({ 'file-1': importedFile })

    act(() => {
      canvas.onChange?.([importedElement], { viewBackgroundColor: '#f8f8f8' }, { 'file-1': importedFile })
    })
    expect(handleLocalChange).toHaveBeenCalledWith([importedElement], { 'file-1': importedFile })
  })

  it('isolates one-shot imported scenes across the complete A → null → B account switch', async () => {
    const aElement = { id: 'a-private', type: 'rectangle', version: 1 }
    const bElement = { id: 'b-private', type: 'diamond', version: 1 }
    boardStore.scenes.set('u_a::doc-1', { elements: [aElement], appState: {}, files: {} })
    boardStore.scenes.set('u_b::doc-1', { elements: [bElement], appState: {}, files: {} })

    const sessionA = makeSession('writer')
    const sessionB = makeSession('writer')
    const bindingA = vi.spyOn(sessionA.binding, 'handleLocalChange')
    const bindingB = vi.spyOn(sessionB.binding, 'handleLocalChange')
    const { rerender } = render(
      <BoardShell
        docId="doc-1"
        title="Shared board"
        space="s1"
        collabSession={sessionA}
        collab
        user={{ id: 'u_a', name: 'A' }}
      />,
    )
    await screen.findByTestId('excalidraw-canvas')
    expect(canvas.mounts).toHaveLength(1)
    expect(canvas.mounts[0]?.elements).toEqual([aElement])

    // Account switch: BoardShell stays mounted while the session passes through null. The old
    // canvas must unmount and no new uid-scoped scene may be read before B is authorized.
    await act(async () => {
      rerender(
        <BoardShell
          docId="doc-1"
          title="Shared board"
          space="s1"
          collabSession={undefined}
          collab
          user={{ id: 'u_b', name: 'B' }}
        />,
      )
    })
    expect(screen.queryByTestId('excalidraw-canvas')).toBeNull()
    expect(screen.getByText('docs.state.loading')).toBeTruthy()
    expect(boardStore.loads).toEqual([{ docId: 'doc-1', uid: 'u_a' }])

    await act(async () => {
      rerender(
        <BoardShell
          docId="doc-1"
          title="Shared board"
          space="s1"
          collabSession={sessionB}
          collab
          user={{ id: 'u_b', name: 'B' }}
        />,
      )
    })
    await screen.findByTestId('excalidraw-canvas')
    expect(canvas.mounts).toHaveLength(2)
    expect(canvas.mounts[1]?.elements).toEqual([bElement])
    expect(canvas.mounts[1]?.elements).not.toContainEqual(aElement)
    expect(boardStore.loads).toEqual([
      { docId: 'doc-1', uid: 'u_a' },
      { docId: 'doc-1', uid: 'u_b' },
    ])

    act(() => {
      canvas.onChange?.([bElement], {}, {})
    })
    expect(bindingB).toHaveBeenCalledWith([bElement], {})
    expect(bindingB).not.toHaveBeenCalledWith(expect.arrayContaining([aElement]), expect.anything())
    expect(bindingA).not.toHaveBeenCalled()
  })
})
