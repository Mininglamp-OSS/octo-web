import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import { HtmlDocCommentPanel } from './HtmlDocCommentPanel.tsx'

let wk: ReturnType<typeof createMockWKApp>

function stubFetch(impl: (url: string, init?: RequestInit) => unknown) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(impl(String(input), init))
  ) as unknown as typeof fetch
  vi.stubGlobal('fetch', spy)
  return spy as unknown as ReturnType<typeof vi.fn>
}
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

beforeEach(() => {
  ;(window as unknown as { __OCTO_DOC_BASE__?: string }).__OCTO_DOC_BASE__ = 'https://od.test'
  wk = createMockWKApp({ uid: 'u_self', token: 't' })
  setWKApp(wk)
})
afterEach(() => {
  delete (window as unknown as { __OCTO_DOC_BASE__?: unknown }).__OCTO_DOC_BASE__
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('HtmlDocCommentPanel — list + compose (octo-doc data layer)', () => {
  it('renders the fetched comment threads with anchor labels', async () => {
    stubFetch(() =>
      jsonResponse({
        data: [
          {
            id: 'c1',
            text: 'first comment',
            anchor: {
              kind: 'element',
              aid: 'a7',
              selector: '[data-odoc-aid="a7"]',
              label: 'p',
            },
            replies: [{ id: 'r1', text: 'a reply' }],
          },
        ],
      })
    )
    render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" version="v1" />)
    await waitFor(() => expect(screen.getByText('first comment')).toBeTruthy())
    expect(screen.getByText('a reply')).toBeTruthy()
    // Anchor label shows the aid.
    expect(screen.getByText(/#a7/)).toBeTruthy()
  })

  it('shows the selected source text for a text-anchored comment', async () => {
    stubFetch(() =>
      jsonResponse({
        data: [
          {
            id: 'c1',
            text: 'please revise this',
            anchor: { kind: 'text', text: 'Original selected words' },
            replies: [],
          },
        ],
      })
    )
    render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" version="v1" />)

    await waitFor(() => expect(screen.getByText('please revise this')).toBeTruthy())
    expect(screen.getByTestId('comment-quote').textContent).toBe('Original selected words')
  })

  it('shows resolved source text for an element-anchored comment', async () => {
    const resolveAnchorText = vi.fn(() => 'Paragraph text from iframe')
    stubFetch(() =>
      jsonResponse({
        data: [
          {
            id: 'c1',
            text: 'comment on paragraph',
            anchor: {
              kind: 'element',
              aid: 'a7',
              selector: '[data-odoc-aid="a7"]',
              label: 'p',
            },
            replies: [],
          },
        ],
      })
    )
    render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" version="v1" resolveAnchorText={resolveAnchorText} />)

    await waitFor(() => expect(screen.getByText('comment on paragraph')).toBeTruthy())
    expect(resolveAnchorText).toHaveBeenCalledWith({
      kind: 'element',
      aid: 'a7',
      selector: '[data-odoc-aid="a7"]',
      label: 'p',
    })
    expect(screen.getByTestId('comment-quote').textContent).toBe('Paragraph text from iframe')
    expect(screen.queryByText(/#a7/)).toBeNull()
  })

  it('does not render a quote block for a doc-level comment', async () => {
    stubFetch(() =>
      jsonResponse({
        data: [{ id: 'c1', text: 'doc-level note', anchor: null, replies: [] }],
      })
    )
    render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" version="v1" />)

    await waitFor(() => expect(screen.getByText('doc-level note')).toBeTruthy())
    expect(screen.queryByTestId('comment-quote')).toBeNull()
  })

  it('posts a comment through the data layer (createComment) with the pending anchor', async () => {
    const spy = stubFetch((url, init) => {
      if ((init?.method ?? 'GET') === 'POST') return jsonResponse({ id: 'new1' })
      return jsonResponse({ data: [] })
    })
    render(
      <HtmlDocCommentPanel
        docId="d1"
        space="sp"
        slug="my-slug"
        version="v2"
        pendingAnchor={{ kind: 'text', text: 'selected words' }}
      />
    )
    await waitFor(() => expect(screen.getByPlaceholderText('docs.comment.placeholder')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('docs.comment.placeholder'), {
      target: { value: 'my new comment' },
    })
    fireEvent.click(screen.getByText('docs.comment.send'))

    await waitFor(() => {
      const post = spy.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'POST')
      expect(post).toBeTruthy()
    })
    const post = spy.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'POST') as unknown as [
      string,
      RequestInit
    ]
    expect(String(post[0])).toBe('https://od.test/v1/comments')
    const body = JSON.parse(String(post[1].body))
    expect(body).toMatchObject({
      slug: 'my-slug',
      text: 'my new comment',
      version: 'v2',
      anchor: { kind: 'text', text: 'selected words' },
    })
  })

  it('shows the composer target and emits an explicit clear-anchor action', async () => {
    const onClearPendingAnchor = vi.fn()
    stubFetch(() => jsonResponse({ data: [] }))
    render(
      <HtmlDocCommentPanel
        docId="d1"
        space="sp"
        slug="s"
        version="v1"
        pendingAnchor={{ kind: 'text', text: 'selected words' }}
        onClearPendingAnchor={onClearPendingAnchor}
      />
    )

    await waitFor(() => expect(screen.getByTestId('pending-anchor')).toBeTruthy())
    expect(screen.getByTestId('pending-anchor').textContent).toContain('docs.comment.targetAnchor')
    expect(screen.getByTestId('pending-anchor').textContent).toContain('selected words')

    fireEvent.click(screen.getByText('docs.comment.clearAnchor'))

    expect(onClearPendingAnchor).toHaveBeenCalledTimes(1)
  })

  it('shows doc-level target state when there is no pending anchor', async () => {
    stubFetch(() => jsonResponse({ data: [] }))
    render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" version="v1" />)

    await waitFor(() => expect(screen.getByTestId('pending-anchor')).toBeTruthy())

    expect(screen.getByTestId('pending-anchor').textContent).toContain('docs.comment.targetDoc')
  })

  it('renders author name + formatted time for a root comment and its reply', async () => {
    stubFetch(() =>
      jsonResponse({
        data: [
          {
            id: 'c1',
            text: 'root with author',
            anchor: null,
            author: { login: 'u_alice', name: 'Alice' },
            created_at: '2026-07-15T04:09:00Z',
            replies: [
              {
                id: 'r1',
                text: 'reply with login only',
                author: { login: 'u_bob' },
                created_at: '2026-07-15T05:30:00Z',
              },
            ],
          },
        ],
      })
    )
    render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" version="v1" />)

    await waitFor(() => expect(screen.getByText('root with author')).toBeTruthy())
    // Display name prefers author.name, falls back to login.
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('u_bob')).toBeTruthy()
    // Times rendered to the minute (local tz → assert the shape, not an absolute value).
    const times = screen.getAllByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(times.length).toBeGreaterThanOrEqual(2)
  })
})

describe('HtmlDocCommentPanel — "让 AI 处理" (trigger mode C, explicit)', () => {
  it('forwards a correctly-built instruction via openDocForward when available', async () => {
    stubFetch(() =>
      jsonResponse({
        data: [
          {
            id: 'c9',
            text: 'make this formal',
            anchor: {
              kind: 'element',
              aid: 'a3',
              selector: '[data-odoc-aid="a3"]',
            },
            replies: [],
          },
        ],
      })
    )
    render(<HtmlDocCommentPanel docId="d1" space="sp" slug="the-slug" version="v5" isAuthor />)
    await waitFor(() => expect(screen.getByText('make this formal')).toBeTruthy())

    const btn = screen.getByText('docs.comment.handleWithAI') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)

    expect(wk.openDocForwardCalls).toHaveLength(1)
    const call = wk.openDocForwardCalls[0]
    expect(call.docId).toBe('d1')
    expect(call.canGrant).toBe(false)
    expect(call.title).toContain('make this formal')
    expect(call.link).toContain('commentId=c9')
    expect(call.link).toContain('aid=a3')
    expect(call.link).toContain('slug=the-slug')
  })

  it('disables "让 AI 处理" when the forward bridge is unavailable (standalone /d/ page)', async () => {
    // Remove the forward surface: no openDocForward override AND no baseContext.showConversationSelect.
    const noForward = wk as unknown as {
      openDocForward?: unknown
      shared: { baseContext?: unknown }
    }
    delete noForward.openDocForward
    noForward.shared.baseContext = undefined
    setWKApp(wk)

    stubFetch(() => jsonResponse({ data: [{ id: 'c1', text: 'x', replies: [] }] }))
    render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" version="v1" isAuthor />)
    await waitFor(() => expect(screen.getByText('x')).toBeTruthy())

    const btn = screen.getByText('docs.comment.handleWithAI') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.click(btn)
    // No forward attempted even if clicked.
    expect(wk.openDocForwardCalls).toHaveLength(0)
  })

  it('hides "让 AI 处理" from non-authors (read-only viewers): button not rendered at all', async () => {
    stubFetch(() => jsonResponse({ data: [{ id: 'c1', text: 'viewer sees no AI btn', replies: [] }] }))
    render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" version="v1" isAuthor={false} />)
    await waitFor(() => expect(screen.getByText('viewer sees no AI btn')).toBeTruthy())
    expect(screen.queryByText('docs.comment.handleWithAI')).toBeNull()
  })

  it('renders "让 AI 处理" for authors', async () => {
    stubFetch(() => jsonResponse({ data: [{ id: 'c1', text: 'author sees AI btn', replies: [] }] }))
    render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" version="v1" isAuthor />)
    await waitFor(() => expect(screen.getByText('author sees AI btn')).toBeTruthy())
    expect(screen.getByText('docs.comment.handleWithAI')).toBeTruthy()
  })
})
