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
import { EditorShell, exportDownloadName } from './EditorShell.tsx'

let wk: ReturnType<typeof createMockWKApp>
let createdAnchors: HTMLAnchorElement[]

beforeEach(() => {
  wk = createMockWKApp()
  setWKApp(wk)
  exportSpy.mockClear()
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

    fireEvent.click(screen.getByTitle('docs.toolbar.exportMarkdown'))

    await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(createdAnchors.length).toBeGreaterThan(0))
    const a = createdAnchors[createdAnchors.length - 1]
    expect(a.download).toBe('Live Title.md')
    expect(a.download).not.toBe('Stale Prop Title.md')
  })
})
