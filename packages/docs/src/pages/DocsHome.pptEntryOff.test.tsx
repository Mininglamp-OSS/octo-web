import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'

// ── "New slides" entry hidden by default (PPT_ENTRY_ENABLED default OFF) ─────
// The html_ppt create entry is no longer offered in the "+ 新建文档" dropdown: it is not rendered at
// all, so it cannot be clicked and no deck can be minted from the docs list. This file exercises the
// SHIPPED default (no config mock override) — DocsHome.test.tsx pins the entry ON to keep covering
// the create wiring that stays in the codebase behind the flag.
import { DocsHome } from './DocsHome.tsx'

// Heavy child boundaries replaced with markers (same rationale as DocsHome.test.tsx).
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

const realLocation = window.location

describe('DocsHome — "New slides" entry hidden (PPT_ENTRY_ENABLED default OFF)', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    window.localStorage.clear()
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { origin: 'https://app.example.com', search: '', assign: vi.fn() },
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

  it('does not render the "New slides" item in the new-document dropdown', async () => {
    const wk = createMockWKApp()
    wk.apiClient.responder = (method: string, url: string) => {
      if (method === 'get' && url.startsWith('/docs')) return { data: { total: 0, items: [] }, status: 200 }
      return { data: {}, status: 200 }
    }
    setWKApp(wk)

    render(<DocsHome />)

    fireEvent.click(screen.getByLabelText('docs.list.newMenu'))

    // The peer entries stay exactly as they are — only the slides entry is gone.
    await waitFor(() => expect(screen.getByText('docs.list.newBoard')).toBeTruthy())
    expect(screen.getByText('docs.sheet.new')).toBeTruthy()
    expect(screen.getByText('docs.list.newHtml')).toBeTruthy()
    expect(screen.queryByText('docs.list.newPpt')).toBeNull()
    expect(screen.queryByRole('button', { name: 'docs.list.newPpt' })).toBeNull()

    // Nothing PPT-related can be opened or created from the list.
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.queryByText('docs.ppt.createComingSoon')).toBeNull()
    expect(wk.apiClient.calls.some((c) => c.method === 'post' && c.url === '/ppt/docs')).toBe(false)
  })
})
