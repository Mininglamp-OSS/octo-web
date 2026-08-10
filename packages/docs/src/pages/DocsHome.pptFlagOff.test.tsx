import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'

// ── R2-F1 P2-4: the PPT_CREATE_ENABLED rollback branch has coverage ──────────
// The flag is read once at module scope in config.ts. With it OFF, DocsHome must fall back to the R1
// "coming soon" notice (an acceptance item) and must NOT mount the live four-template picker — that
// is the emergency rollback path, and it was previously untested. This file mocks config.ts with the
// flag OFF (keeping every other config export real via importActual) so the whole file exercises the
// OFF build without disturbing the flag-ON assertions in DocsHome.test.tsx.
vi.mock('../config.ts', async () => {
  const actual = await vi.importActual<typeof import('../config.ts')>('../config.ts')
  // PPT_ENTRY_ENABLED is pinned ON so the caret-menu entry exists to click; this file is about the
  // PPT_CREATE_ENABLED rollback branch, which is a different gate (see config.ts).
  return { ...actual, PPT_CREATE_ENABLED: false, PPT_ENTRY_ENABLED: true }
})

// Heavy child boundaries replaced with markers (same rationale as DocsHome.test.tsx): the editor /
// board / sheet / html / ppt shells pull Tiptap/Yjs/Univer/WebSocket runtimes we do not need for a
// list-only render.
vi.mock('../editor/EditorShell.tsx', () => ({
  EditorShell: (props: { docId: string }) => <div data-testid="editor-shell">{props.docId}</div>,
}))
vi.mock('../board/BoardSession.tsx', () => ({
  BoardSession: (props: { docId: string }) => <div data-testid="board-shell">{props.docId}</div>,
}))
vi.mock('../sheet/SheetView.tsx', () => ({
  SheetView: (props: { docId: string }) => <div data-testid="sheet-view">{props.docId}</div>,
}))
vi.mock('../html/HtmlDocView.tsx', () => ({
  HtmlDocView: (props: { docId: string }) => <div data-testid="html-doc-view">{props.docId}</div>,
}))
vi.mock('../ppt/PptDocView.tsx', () => ({
  PptDocView: (props: { docId: string }) => <div data-testid="ppt-doc-view">{props.docId}</div>,
}))
vi.mock('../html-create/DocsBotConversation.tsx', () => ({
  DocsBotConversation: () => <div data-testid="bot-chat" />,
}))

// Imported AFTER the config mock is registered so DocsHome closes over the OFF flag.
import { DocsHome } from './DocsHome.tsx'

const realLocation = window.location

describe('DocsHome — PPT_CREATE_ENABLED OFF (R1 coming-soon rollback, P2-4)', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    window.localStorage.clear()
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { search: '', assign: vi.fn() },
    })
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
    vi.spyOn(window.history, 'pushState').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: realLocation,
    })
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it('opens the R1 "coming soon" notice — never the live template picker — when the flag is OFF', async () => {
    const wk = createMockWKApp()
    wk.apiClient.responder = (method: string, url: string) => {
      if (method === 'get' && url.startsWith('/docs')) return { data: { total: 0, items: [] }, status: 200 }
      return { data: {}, status: 200 }
    }
    setWKApp(wk)

    render(<DocsHome />)

    // Open the split "New" dropdown and choose "New slides".
    fireEvent.click(screen.getByLabelText('docs.list.newMenu'))
    fireEvent.click(screen.getByText('docs.list.newPpt'))

    // Flag OFF → the coming-soon notice shows and the create endpoint is never hit.
    await waitFor(() => expect(screen.getByText('docs.ppt.createComingSoon')).toBeTruthy())
    // The live picker (radiogroup of four template cards) must NOT render.
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    // Nothing is created server-side either.
    expect(wk.apiClient.calls.some((c) => c.method === 'post' && c.url === '/ppt/docs')).toBe(false)
  })
})
