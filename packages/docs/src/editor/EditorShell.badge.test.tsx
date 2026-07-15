import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'

// Badge-desync regression (feature #511 re-review blocker): the Members-button red-dot count and
// the member panel's pending-request list must be driven by ONE shared useAccessRequests instance.
// Before the fix EditorShell and MemberPanel each held their own instance, so approving/denying in
// the panel updated the panel list but left the toolbar badge showing the stale count.
//
// This test keeps MemberPanel / PendingRequests / useAccessRequests REAL (they are the wiring under
// test) and stubs only the heavy collaboration UI + the REST layer.

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

// Stub presentational children that take the live editor/provider — not under test here.
vi.mock('@tiptap/react', () => ({ EditorContent: () => null }))
vi.mock('./Toolbar.tsx', () => ({ Toolbar: () => null, EditorBubbleMenu: () => null }))
vi.mock('./TableControls.tsx', () => ({ TableContextMenu: () => null }))
vi.mock('./Outline.tsx', () => ({ Outline: () => null }))
vi.mock('./StatusBar.tsx', () => ({ StatusBar: () => null }))
vi.mock('./PresenceBar.tsx', () => ({ PresenceBar: () => null }))
vi.mock('../comments/CommentBubble.tsx', () => ({ CommentBubble: () => null }))
vi.mock('../comments/CommentPanel.tsx', () => ({ CommentPanel: () => null }))
vi.mock('../versions/VersionPanel.tsx', () => ({ VersionPanel: () => null }))
vi.mock('../comments/useDocComments.ts', () => ({
  useDocComments: () => ({ threads: [], createRoot: vi.fn() }),
}))
vi.mock('../comments/useCommentHighlights.ts', () => ({ useCommentHighlights: () => undefined }))
vi.mock('../members/useMemberNames.ts', () => ({ useMemberNames: () => new Map<string, string>() }))
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
import { EditorShell } from './EditorShell.tsx'

let wk: ReturnType<typeof createMockWKApp>
let pending: Array<{ requestId: string; uid: string }>

// The Members toolbar button (its accessible name contains the localized "members" key).
const membersButton = () => screen.getByRole('button', { name: /docs\.toolbar\.members/ })
const toolbarBadge = () => membersButton().querySelector('.octo-access-badge')?.textContent ?? null

beforeEach(() => {
  pending = [
    { requestId: 'r1', uid: 'u1' },
    { requestId: 'r2', uid: 'u2' },
  ]
  wk = createMockWKApp()
  setWKApp(wk)
  wk.apiClient.responder = (method, url) => {
    if (method === 'get' && url === '/docs/d_1') {
      return { data: { docId: 'd_1', title: 'Doc', ownerId: 'u_self' }, status: 200 }
    }
    // Pull-based pending list (reflects the current mutable `pending`).
    if (method === 'get' && url.includes('/access-requests') && url.includes('status=pending')) {
      return { data: { items: pending.slice() }, status: 200 }
    }
    // Approve / deny remove the row server-side; the next pending fetch returns the smaller set.
    const approve = url.match(/\/access-requests\/([^/]+)\/approve$/)
    const deny = url.match(/\/access-requests\/([^/]+)\/deny$/)
    if (method === 'post' && (approve || deny)) {
      const id = (approve ?? deny)![1]
      pending = pending.filter((p) => p.requestId !== id)
      return { data: {}, status: 200 }
    }
    if (method === 'get' && url.endsWith('/members')) return { data: { items: [] }, status: 200 }
    if (method === 'get' && url.endsWith('/invites')) return { data: { items: [] }, status: 200 }
    return { data: {}, status: 200 }
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderShell() {
  render(
    <EditorShell
      docId="d_1"
      title="Doc"
      space="s_1"
      folder="f_1"
      doc="d_1"
      uid="u_self"
      user={{ id: 'u_self', name: 'Self' }}
    />,
  )
}

describe('EditorShell — badge / panel share one access-request instance (badge-desync fix)', () => {
  it('updates the toolbar badge count after approving in the panel', async () => {
    renderShell()

    // Badge reflects the two pending requests before the panel is even opened.
    await waitFor(() => expect(toolbarBadge()).toBe('2'))

    // Open the Members modal and approve the first request.
    fireEvent.click(membersButton())
    await waitFor(() => expect(screen.getAllByText('docs.forward.approve').length).toBe(2))
    fireEvent.click(screen.getAllByText('docs.forward.approve')[0])

    // The SHARED instance re-fetches → panel list shrinks AND the toolbar badge follows to 1.
    await waitFor(() => expect(screen.getAllByText('docs.forward.approve').length).toBe(1))
    await waitFor(() => expect(toolbarBadge()).toBe('1'))
  })

  it('clears the toolbar badge once every request is denied', async () => {
    renderShell()
    await waitFor(() => expect(toolbarBadge()).toBe('2'))

    fireEvent.click(membersButton())
    await waitFor(() => expect(screen.getAllByText('docs.forward.deny').length).toBe(2))

    fireEvent.click(screen.getAllByText('docs.forward.deny')[0])
    await waitFor(() => expect(screen.getAllByText('docs.forward.deny').length).toBe(1))
    await waitFor(() => expect(toolbarBadge()).toBe('1'))

    fireEvent.click(screen.getAllByText('docs.forward.deny')[0])
    // Count hits 0 → the badge span is no longer rendered at all.
    await waitFor(() => expect(toolbarBadge()).toBeNull())
  })
})
