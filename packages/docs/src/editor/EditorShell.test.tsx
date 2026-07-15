import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'

// Batch 8 item 1: the Markdown export filename must use the CURRENT (fetched / edited) document
// title, not the stale `title` prop passed into EditorShell. DocTitle fetches the real title on
// mount and surfaces it via onTitleLoaded; EditorShell lifts it to `currentTitle` and the export
// handler builds the filename from that.
//
// The editor shell mounts a lot of heavy collaboration UI (Tiptap, Yjs, presence, panels) that is
// irrelevant to this behavior, so we stub those seams and drive a fake editor instance.

const fakeEditor = {
  getJSON: () => ({ type: 'doc', content: [] }),
  storage: { octoCommentHighlight: {} as { onActivate?: ((id: number) => void) | null } },
}

vi.mock('../collab/useCollabEditor.ts', () => ({
  useCollabEditor: () => ({
    instance: { editor: fakeEditor, provider: {} },
    ready: true,
    role: 'admin',
    connState: 'connected',
    terminal: { kind: 'none' },
  }),
}))

// Capture the markdown the handler serializes; the body content is irrelevant here.
const exportSpy = vi.fn(async (..._args: unknown[]) => '# exported\n')
vi.mock('../export/markdown.ts', () => ({
  exportDocToMarkdown: (...args: unknown[]) => exportSpy(...args),
}))

// Stub the presentational children that take the live editor/provider — they are not under test.
vi.mock('@tiptap/react', () => ({ EditorContent: () => null }))
vi.mock('./Toolbar.tsx', () => ({ Toolbar: () => null, EditorBubbleMenu: () => null }))
vi.mock('./TableControls.tsx', () => ({ TableContextMenu: () => null }))
vi.mock('./Outline.tsx', () => ({ Outline: () => null }))
vi.mock('./StatusBar.tsx', () => ({ StatusBar: () => null }))
vi.mock('./PresenceBar.tsx', () => ({ PresenceBar: () => null }))
vi.mock('../comments/CommentBubble.tsx', () => ({ CommentBubble: () => null }))
vi.mock('../comments/CommentPanel.tsx', () => ({ CommentPanel: () => null }))
vi.mock('../versions/VersionPanel.tsx', () => ({ VersionPanel: () => null }))
vi.mock('../members/MemberPanel.tsx', () => ({ MemberPanel: () => null }))
vi.mock('../comments/useDocComments.ts', () => ({
  useDocComments: () => ({ threads: [], createRoot: vi.fn() }),
}))
vi.mock('../comments/useCommentHighlights.ts', () => ({ useCommentHighlights: () => undefined }))
// useMemberNames drives the creator-name resolution's PRIMARY source (the space-member map). Kept
// as an overridable hoisted spy so a test can seed the map with the owner (XIN-392 P2-1) and assert
// the standalone nickname-only path bypasses it. Defaults to an empty map, reset in beforeEach.
const { useMemberNamesMock } = vi.hoisted(() => ({
  useMemberNamesMock: vi.fn(() => new Map<string, string>()),
}))
vi.mock('../members/useMemberNames.ts', () => ({ useMemberNames: useMemberNamesMock }))
vi.mock('./useDocDelete.ts', () => ({
  useDocDelete: () => ({
    confirming: false,
    deleting: false,
    error: null,
    requestDelete: vi.fn(),
    cancel: vi.fn(),
    confirm: vi.fn(),
  }),
}))

// Imported AFTER the mocks so the mocked modules are in place.
import { EditorShell, exportDownloadName } from './EditorShell.tsx'

let wk: ReturnType<typeof createMockWKApp>
let createdAnchors: HTMLAnchorElement[]

beforeEach(() => {
  wk = createMockWKApp()
  setWKApp(wk)
  exportSpy.mockClear()
  useMemberNamesMock.mockReset()
  useMemberNamesMock.mockReturnValue(new Map<string, string>())
  fakeEditor.storage.octoCommentHighlight = {}
  // jsdom has no object-URL impl; the export handler creates + revokes one.
  ;(URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:mock'
  ;(URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {}
  // Capture every <a> the handler builds so we can read the download filename.
  createdAnchors = []
  const realCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = realCreate(tag)
    if (tag === 'a') createdAnchors.push(el as HTMLAnchorElement)
    return el
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('exportDownloadName (item 1)', () => {
  it('uses the given title, trimmed', () => {
    expect(exportDownloadName('  My Doc  ')).toBe('My Doc')
  })
  it('falls back to the untitled placeholder, then "document", only when empty', () => {
    // The t() stub returns the key unchanged, so an empty title falls back to the key (non-empty).
    expect(exportDownloadName('')).toBe('docs.state.untitled')
    expect(exportDownloadName(null)).toBe('docs.state.untitled')
  })
})

describe('EditorShell — export filename uses the live title, not the stale prop (item 1)', () => {
  it('downloads as <live title>.md after DocTitle fetches the real title', async () => {
    // The doc's real title differs from the prop the shell was opened with.
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_1') {
        return { data: { docId: 'd_1', title: 'Live Title', ownerId: 'u_self' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }

    render(
      <EditorShell
        docId="d_1"
        title="Stale Prop Title"
        space="s_1"
        folder="f_1"
        doc="d_1"
        uid="u_self"
        user={{ id: 'u_self', name: 'Self' }}
      />,
    )

    // The header shows the fetched (live) title once the mount fetch resolves.
    await waitFor(() => expect(screen.getByText('Live Title')).toBeTruthy())

    // Export moved into the header ≡ "more" menu: open it, then trigger the export row.
    fireEvent.click(screen.getByTitle('docs.toolbar.more'))
    fireEvent.click(screen.getByText('docs.toolbar.exportMarkdown'))

    await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(createdAnchors.length).toBeGreaterThan(0))
    const a = createdAnchors[createdAnchors.length - 1]
    expect(a.download).toBe('Live Title.md')
    expect(a.download).not.toBe('Stale Prop Title.md')
  })
})

// #512 AC-8 non-regression: the standalone deep-link page reuses EditorShell and injects a Back
// control (onBack) + "Copy link" (headerRight). The IN-SHELL path passes neither,
// and must be completely unaffected by the new props.
describe('EditorShell — header injection props (#512 AC-8)', () => {
  const baseProps = {
    docId: 'd_1',
    title: 'Doc',
    space: 's_1',
    folder: 'f_1',
    doc: 'd_1',
    uid: 'u_self',
    user: { id: 'u_self', name: 'Self' },
  }

  it('in-shell (no onBack / no headerRight): renders no header back control, header unchanged', () => {
    render(<EditorShell {...baseProps} />)
    // No header back button when onBack is omitted.
    expect(screen.queryByTitle('docs.list.back')).toBeNull()
    // The low-frequency controls now live behind the ≡ "more" menu, not as resident buttons.
    expect(screen.getByTitle('docs.toolbar.more')).toBeTruthy()
    fireEvent.click(screen.getByTitle('docs.toolbar.more'))
    expect(screen.getByText('docs.toolbar.exportMarkdown')).toBeTruthy()
    expect(screen.getByText('docs.toolbar.history')).toBeTruthy()
  })

  it('standalone: renders the injected headerRight content alongside the built-in controls', () => {
    render(
      <EditorShell
        {...baseProps}
        onBack={() => {}}
        headerRight={<button type="button">INJECTED_ACTIONS</button>}
      />,
    )
    // The injected standalone chrome appears...
    expect(screen.getByText('INJECTED_ACTIONS')).toBeTruthy()
    // ...the back control shows when onBack is provided...
    expect(screen.getByTitle('docs.list.back')).toBeTruthy()
    // ...and the built-in controls are still reachable via the ≡ menu (parity preserved).
    fireEvent.click(screen.getByTitle('docs.toolbar.more'))
    expect(screen.getByText('docs.toolbar.exportMarkdown')).toBeTruthy()
  })
})

// #512 title-bar tidy-up: the header ≡ "more" menu collapses the low-frequency actions behind one
// affordance, with a creator + created-on head. role is 'admin' (see the useCollabEditor mock), so
// the destructive delete row is present.
describe('EditorShell — header "more" (≡) menu', () => {
  const baseProps = {
    docId: 'd_1',
    title: 'Doc',
    space: 's_1',
    folder: 'f_1',
    doc: 'd_1',
    uid: 'u_self',
    user: { id: 'u_self', name: 'Self' },
  }

  it('collapses history / export / delete behind ≡; delete is a danger row, pinned last', () => {
    render(<EditorShell {...baseProps} />)
    // Closed by default: no rows visible.
    expect(screen.queryByText('docs.toolbar.exportMarkdown')).toBeNull()
    fireEvent.click(screen.getByTitle('docs.toolbar.more'))

    const historyRow = screen.getByText('docs.toolbar.history').closest('button')!
    const exportRow = screen.getByText('docs.toolbar.exportMarkdown').closest('button')!
    const deleteRow = screen.getByText('docs.doc.deleteEntry').closest('button')!
    expect(historyRow).toBeTruthy()
    expect(exportRow).toBeTruthy()
    // Delete is the danger row.
    expect(deleteRow.className).toContain('is-danger')
    // Order: history precedes export precedes delete in the DOM.
    expect(historyRow.compareDocumentPosition(exportRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(exportRow.compareDocumentPosition(deleteRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the "open in new page" row (first) only when onOpenInNewPage is wired', () => {
    const onOpenInNewPage = vi.fn()
    const { rerender } = render(<EditorShell {...baseProps} />)
    fireEvent.click(screen.getByTitle('docs.toolbar.more'))
    // In-shell handler absent → no open-in-new-page row.
    expect(screen.queryByText('docs.standalone.openInNewPage')).toBeNull()

    // Wire the handler; the menu stays open across the rerender and now shows the row first.
    rerender(<EditorShell {...baseProps} onOpenInNewPage={onOpenInNewPage} />)
    const openRow = screen.getByText('docs.standalone.openInNewPage')
    fireEvent.click(openRow)
    expect(onOpenInNewPage).toHaveBeenCalledTimes(1)
  })

  it('renders the creator + created-on head from the doc meta', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_1') {
        return {
          data: { docId: 'd_1', title: 'Doc', ownerId: 'u_owner', createdAt: '2026-07-02T14:00:45Z' },
          status: 200,
        }
      }
      if (method === 'get' && url === '/users/u_owner') {
        return { data: { name: 'Alice' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }
    render(<EditorShell {...baseProps} />)
    // Wait for the owner-name resolution to land, then open the menu.
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.url === '/users/u_owner')).toBe(true))
    fireEvent.click(screen.getByTitle('docs.toolbar.more'))
    await waitFor(() => expect(screen.getByText('Alice')).toBeTruthy())
    // Created-on line uses the lexical YYYY-MM-DD slice (no timezone drift).
    expect(screen.getByText(/2026-07-02/)).toBeTruthy()
  })

  it('P2-1: standalone (creatorNicknameOnly) SKIPS the member map even when it holds a real name', async () => {
    // Simulate the future backend that fills the space-member display name with a VERIFIED real
    // name. On the externally shared standalone surface this must never reach a link holder — the
    // creator name has to resolve through the nickname-only getUserName path, not the member map.
    useMemberNamesMock.mockReturnValue(new Map([['u_owner', 'Real Legal Name']]))
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_1') {
        return { data: { docId: 'd_1', title: 'Doc', ownerId: 'u_owner' }, status: 200 }
      }
      if (method === 'get' && url === '/users/u_owner') {
        // Nickname-only fetch: real_name present but must be ignored (preferRealName:false).
        return { data: { name: 'Nick', real_name: 'Real Legal Name' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }
    render(<EditorShell {...baseProps} creatorNicknameOnly />)
    // The nickname-only resolver is called despite the member map already holding a name.
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.url === '/users/u_owner')).toBe(true))
    fireEvent.click(screen.getByTitle('docs.toolbar.more'))
    await waitFor(() => expect(screen.getByText('Nick')).toBeTruthy())
    // The verified real name from the member map never surfaces on the shared surface.
    expect(screen.queryByText('Real Legal Name')).toBeNull()
  })

  it('P2-1: in-shell (creatorNicknameOnly unset) still uses the member map first, no /users fetch', async () => {
    // Unchanged in-shell behavior: the already-loaded member map is the free primary source, so the
    // creator name comes straight from it and getUserName is never called.
    useMemberNamesMock.mockReturnValue(new Map([['u_owner', 'Member Name']]))
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d_1') {
        return { data: { docId: 'd_1', title: 'Doc', ownerId: 'u_owner' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }
    render(<EditorShell {...baseProps} />)
    // Wait for the doc meta (ownerId) to land so the creator effect has run.
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.url === '/docs/d_1')).toBe(true))
    fireEvent.click(screen.getByTitle('docs.toolbar.more'))
    await waitFor(() => expect(screen.getByText('Member Name')).toBeTruthy())
    // Member map hit → the /users/:uid fallback is never reached in-shell.
    expect(wk.apiClient.calls.some((c) => c.url === '/users/u_owner')).toBe(false)
  })
})

// XIN-490 gap1: the "Forward to chat" entry lands its payload on the host's
// baseContext.showConversationSelect (openDocForward). On the standalone /d/:docId page WKBase is
// not mounted, so that surface is absent and a click would be a SILENT no-op. The button must gate
// its render on the surface's availability (canForwardToChat) — shown in-shell, hidden where the
// host can't actually forward — so it never renders as a dead control.
describe('EditorShell — forward-to-chat entry gating (XIN-490 gap1)', () => {
  const baseProps = {
    docId: 'd_1',
    title: 'Doc',
    space: 's_1',
    folder: 'f_1',
    doc: 'd_1',
    uid: 'u_self',
    user: { id: 'u_self', name: 'Self' },
  }

  it('renders the forward entry when the host exposes the conversation-select surface', () => {
    // The default mock provides an openDocForward override — the surface openDocForward() delegates
    // to — so forwarding is reachable and the entry shows (in-shell parity, non-regression).
    render(<EditorShell {...baseProps} />)
    expect(screen.getByTitle('docs.forward.entry')).toBeTruthy()
  })

  it('hides the forward entry when the host lacks the forward surface (standalone /d/:docId)', () => {
    // Simulate the standalone mount: no openDocForward override AND no baseContext — exactly the
    // WKBase-less surface where a forward click would silently no-op. The entry must not render.
    const noForward = createMockWKApp()
    delete (noForward as { openDocForward?: unknown }).openDocForward
    setWKApp(noForward)
    render(<EditorShell {...baseProps} />)
    expect(screen.queryByTitle('docs.forward.entry')).toBeNull()
    // The other reader+ controls (comments) still render — only the forward entry is gated.
    expect(screen.getByTitle('docs.toolbar.comments')).toBeTruthy()
  })
})
