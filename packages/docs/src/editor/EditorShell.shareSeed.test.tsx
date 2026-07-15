import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'

// #64 shareSeed race regression (#788 third-review blocker B1).
//
// EditorShell owns `shareSeed`, seeded once from the page-load getDoc (Writer A) and refreshed by
// the panel's commit callback (Writer B). Before the fix these two async writers had no ordering
// guard: a SLOW getDoc could resolve AFTER a commit and clobber the just-committed scope back to
// its stale pre-edit value. Reopening the panel then re-adopts EditorShell's (now-stale) seed and
// confidently shows "Restricted" for a document that is actually Anyone-in-Space.
//
// This test drives that exact interleaving at the EditorShell level: getDoc is a manually
// controlled deferred, so we can commit first and resolve the page-load read second. The panel is
// stubbed to (a) expose EditorShell's current `shareSeed` and (b) fire `onShareCommitted` on
// demand — the seed lifecycle inside EditorShell is what is under test here (the panel-side
// authoritativeRef guard is covered separately by ShareScopePanel.test.tsx).

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
vi.mock('../access-request/useAccessRequests.ts', () => ({ useAccessRequests: () => 0 }))
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

// Stub MemberPanel: surface EditorShell's current shareSeed and let the test fire onShareCommitted.
// Reopening the real panel re-seeds from exactly this prop, so asserting the prop value is asserting
// what a reopened panel would confidently display.
vi.mock('../members/MemberPanel.tsx', () => ({
  MemberPanel: (props: {
    shareSeed?: { shareScope?: string; shareRole?: string }
    onShareCommitted?: (next: { shareScope: string; shareRole: string }) => void
  }) => (
    <div>
      <span data-testid="seed-scope">{props.shareSeed?.shareScope ?? 'none'}</span>
      <span data-testid="seed-role">{props.shareSeed?.shareRole ?? 'none'}</span>
      <button
        type="button"
        onClick={() => props.onShareCommitted?.({ shareScope: 'anyone_in_space', shareRole: 'edit' })}
      >
        commit-anyone
      </button>
    </div>
  ),
}))

// getDoc is a manually resolved deferred so the test controls the getDoc-vs-commit ordering.
// EditorShell AND its DocTitle child both call getDoc, so collect every pending resolver and
// settle them all with the same meta when the test decides the page-load read has "landed".
let pendingGetDoc: Array<(meta: unknown) => void> = []
const resolveGetDoc = (meta: unknown) => {
  for (const resolve of pendingGetDoc.splice(0)) resolve(meta)
}
vi.mock('../pages/docsApi.ts', async (importActual) => {
  const actual = await importActual<typeof import('../pages/docsApi.ts')>()
  return {
    ...actual,
    getDoc: vi.fn(
      () =>
        new Promise((resolve) => {
          pendingGetDoc.push(resolve)
        }),
    ),
    getUserName: vi.fn(() => Promise.resolve(undefined)),
  }
})

// Imported AFTER the mocks so the mocked modules are in place.
import { EditorShell } from './EditorShell.tsx'

beforeEach(() => {
  pendingGetDoc = []
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const membersButton = () => screen.getByRole('button', { name: /docs\.toolbar\.members/ })

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

describe('EditorShell — shareSeed getDoc-vs-commit race guard (B1)', () => {
  it('does not let a late getDoc clobber a just-committed shareSeed', async () => {
    renderShell()
    await waitFor(() => expect(membersButton()).toBeTruthy())

    // Open the members panel and commit a scope change to Anyone-in-Space while getDoc is still
    // in flight (Writer B lands first).
    fireEvent.click(membersButton())
    fireEvent.click(screen.getByText('commit-anyone'))
    await waitFor(() => expect(screen.getByTestId('seed-scope').textContent).toBe('anyone_in_space'))

    // The slow page-load getDoc NOW resolves with the pre-edit meta (Writer A lands second).
    resolveGetDoc({ docId: 'd_1', ownerId: 'u_self', shareScope: 'restricted', shareRole: 'read' })

    // The committed value must survive: a late getDoc must never revert the seed to the stale
    // "restricted" scope that a reopened panel would then display.
    await waitFor(() => expect(screen.getByTestId('seed-role').textContent).toBe('edit'))
    expect(screen.getByTestId('seed-scope').textContent).toBe('anyone_in_space')
  })

  it('still adopts the page-load getDoc seed when no commit has happened', async () => {
    renderShell()
    await waitFor(() => expect(membersButton()).toBeTruthy())

    // No commit: the page-load read is the only (and authoritative) writer and must populate the seed.
    resolveGetDoc({ docId: 'd_1', ownerId: 'u_self', shareScope: 'anyone_in_space', shareRole: 'read' })

    fireEvent.click(membersButton())
    await waitFor(() => expect(screen.getByTestId('seed-scope').textContent).toBe('anyone_in_space'))
    expect(screen.getByTestId('seed-role').textContent).toBe('read')
  })
})
