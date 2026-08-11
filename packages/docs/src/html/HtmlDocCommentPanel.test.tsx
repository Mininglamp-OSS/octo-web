import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import { HtmlDocCommentPanel } from './HtmlDocCommentPanel.tsx'

// 输入框换成了共享的 MentionComposer(tiptap)—— 原来的裸 textarea 打不出
// `@[user:uid:label]` token,后端解析不到 mention,「@Bot 让它改文档」这条路等于没入口。
// tiptap 在 jsdom 里不响应 fireEvent.change,所以照 BoardCommentPanel.test.tsx 的既有
// 做法把它桩成 textarea。**必须转发 placeholder**:下面的用例全靠它定位输入框。
vi.mock('../mentions/MentionComposer.tsx', () => ({
  MentionComposer: ({
    initialBody = '',
    placeholder,
    onChange,
  }: {
    initialBody?: string
    placeholder?: string
    onChange: (body: string) => void
  }) => (
    <textarea
      className="octo-comment-input"
      placeholder={placeholder}
      defaultValue={initialBody}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

let wk: ReturnType<typeof createMockWKApp>

// 创建走 docs-backend 的转发路由(apiClient),不再是裸 fetch;读仍然直连 octo-doc。
// 所以这里桩数据层的 createComment,断言「面板交出去的参数」—— 那才是这些用例真正的主题。
// 传输本身由 htmlDocComments.test.ts 覆盖。
// 显式标注入参类型:不标的话 vi.fn 会把 mock.calls 推成空元组,读 calls[0]![1] 直接 TS2493。
const createCommentMock = vi.hoisted(() =>
  vi.fn<(slug: string, input: Record<string, unknown>) => Promise<{ id: string }>>(async () => ({
    id: 'new1',
  })),
)
vi.mock('./htmlDocComments.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./htmlDocComments.ts')>()),
  createComment: createCommentMock,
}))

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
  createCommentMock.mockClear()
  createCommentMock.mockResolvedValue({ id: 'new1' })
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
  it('ignores an older comment response after the viewed version changes', async () => {
    let resolveOld!: (value: Response) => void
    let resolveNew!: (value: Response) => void
    const oldResponse = new Promise<Response>((resolve) => { resolveOld = resolve })
    const newResponse = new Promise<Response>((resolve) => { resolveNew = resolve })
    stubFetch((url) => String(url).includes('version=v1') ? oldResponse : newResponse)
    const { rerender } = render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v1" />)
    rerender(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v2" />)
    resolveNew(jsonResponse({ data: [{ id: 'new', text: 'new version', replies: [] }] }))
    await waitFor(() => expect(screen.getByText('new version')).toBeTruthy())
    resolveOld(jsonResponse({ data: [{ id: 'old', text: 'stale version', replies: [] }] }))
    await Promise.resolve()
    expect(screen.queryByText('stale version')).toBeNull()
    expect(screen.getByText('new version')).toBeTruthy()
  })

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
    render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v1" />)
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
    render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v1" />)

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
    render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v1" resolveAnchorText={resolveAnchorText} />)

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

  it('shows a localized lost-anchor label and preserves the backend label', async () => {
    stubFetch(() =>
      jsonResponse({
        data: [
          {
            id: 'c1',
            text: 'comment whose target disappeared',
            anchor: { kind: 'lost', reason: 'no_candidate', label: 'table' },
            replies: [],
          },
        ],
      })
    )
    render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v1" />)

    await waitFor(() => expect(screen.getByText('comment whose target disappeared')).toBeTruthy())
    expect(screen.getByText('docs.comment.anchorLostWithLabel')).toBeTruthy()
  })

  it('shows an unknown-anchor label for an unsupported wire kind', async () => {
    stubFetch(() =>
      jsonResponse({
        data: [
          {
            id: 'c1',
            text: 'comment with a future anchor kind',
            anchor: { kind: 'future-anchor' },
            replies: [],
          },
        ],
      })
    )
    render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v1" />)

    await waitFor(() => expect(screen.getByText('comment with a future anchor kind')).toBeTruthy())
    expect(screen.getByText('docs.comment.anchorUnknown')).toBeTruthy()
    expect(screen.queryByText('undefined')).toBeNull()
  })

  it('does not render a quote block for a doc-level comment', async () => {
    stubFetch(() =>
      jsonResponse({
        data: [{ id: 'c1', text: 'doc-level note', anchor: null, replies: [] }],
      })
    )
    render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v1" />)

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
        listVersion="v2"
        mutationVersion={2}
        mayComment
        pendingAnchor={{ kind: 'text', text: 'selected words' }}
      />
    )
    await waitFor(() => expect(screen.getByPlaceholderText('docs.comment.placeholder')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('docs.comment.placeholder'), {
      target: { value: 'my new comment' },
    })
    fireEvent.click(screen.getByText('docs.comment.send'))

    await waitFor(() => expect(createCommentMock).toHaveBeenCalled())
    expect(createCommentMock.mock.calls[0]![0]).toBe('my-slug')
    expect(createCommentMock.mock.calls[0]![1]).toMatchObject({
      text: 'my new comment',
      version: 2,
      anchor: { kind: 'text', text: 'selected words' },
    })
  })

  it.each([
    ['missing', undefined],
    ['zero', 0],
    ['fractional', 1.5],
  ])('does not POST and shows an error when the rendered version is %s', async (_label, mutationVersion) => {
    const spy = stubFetch(() => jsonResponse({ data: [] }))
    render(
      <HtmlDocCommentPanel
        docId="d1"
        space="sp"
        slug="s"
        listVersion="latest"
        mutationVersion={mutationVersion}
        mayComment
      />
    )

    await waitFor(() => expect(screen.getByPlaceholderText('docs.comment.placeholder')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('docs.comment.placeholder'), {
      target: { value: 'must not post' },
    })
    fireEvent.click(screen.getByText('docs.comment.send'))

    expect(screen.getByRole('alert').textContent).toContain('docs.comment.errorVersion')
    expect(spy.mock.calls.some((call) => (call[1] as RequestInit)?.method === 'POST')).toBe(false)
  })

  it('shows the composer target and emits an explicit clear-anchor action', async () => {
    const onClearPendingAnchor = vi.fn()
    stubFetch(() => jsonResponse({ data: [] }))
    render(
      <HtmlDocCommentPanel
        docId="d1"
        space="sp"
        slug="s"
        listVersion="v1"
        mayComment
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
    render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v1" mayComment />)

    await waitFor(() => expect(screen.getByTestId('pending-anchor')).toBeTruthy())

    expect(screen.getByTestId('pending-anchor').textContent).toContain('docs.comment.wholeDoc')
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
    render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v1" />)

    await waitFor(() => expect(screen.getByText('root with author')).toBeTruthy())
    // Display name prefers author.name, falls back to login.
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('u_bob')).toBeTruthy()
    // Times rendered to the minute (local tz → assert the shape, not an absolute value).
    const times = screen.getAllByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(times.length).toBeGreaterThanOrEqual(2)
  })
})
describe('HtmlDocCommentPanel — four-role capability gating', () => {
  it('reader (mayComment=false): list renders, composer/send/reply hidden, read-only hint shown', async () => {
    stubFetch(() =>
      jsonResponse({ data: [{ id: 'c1', text: 'reader sees this thread', replies: [] }] })
    )
    render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v1" mayComment={false} />)
    await waitFor(() => expect(screen.getByText('reader sees this thread')).toBeTruthy())
    // No composer textarea, no send button, no reply button.
    expect(screen.queryByPlaceholderText('docs.comment.placeholder')).toBeNull()
    expect(screen.queryByText('docs.comment.send')).toBeNull()
    expect(screen.queryByText('docs.comment.reply')).toBeNull()
    // The read-only hint replaces the composer.
    expect(screen.getByText('docs.comment.readOnlyHint')).toBeTruthy()
  })

  it('commenter (mayComment): composer and per-thread reply button are available', async () => {
    stubFetch(() =>
      jsonResponse({ data: [{ id: 'c1', text: 'a thread to reply to', replies: [] }] })
    )
    render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v1" mayComment />)
    await waitFor(() => expect(screen.getByText('a thread to reply to')).toBeTruthy())
    expect(screen.getByPlaceholderText('docs.comment.placeholder')).toBeTruthy()
    expect(screen.getByText('docs.comment.send')).toBeTruthy()
    // Reply affordance present; read-only hint absent.
    expect(screen.getByText('docs.comment.reply')).toBeTruthy()
    expect(screen.queryByText('docs.comment.readOnlyHint')).toBeNull()
  })

  it('reply posts with parentId + concrete version and NO anchor', async () => {
    const spy = stubFetch((url, init) => {
      if ((init?.method ?? 'GET') === 'POST') return jsonResponse({ id: 'r-new' })
      return jsonResponse({ data: [{ id: 'c1', text: 'root thread', replies: [] }] })
    })
    render(
      <HtmlDocCommentPanel
        docId="d1"
        space="sp"
        slug="reply-slug"
        listVersion="latest"
        mutationVersion={7}
        mayComment
      />
    )
    await waitFor(() => expect(screen.getByText('root thread')).toBeTruthy())
    // Open the reply composer for the thread.
    fireEvent.click(screen.getByText('docs.comment.reply'))
    const box = await waitFor(() => screen.getByPlaceholderText('docs.comment.replyPlaceholder'))
    fireEvent.change(box, { target: { value: 'my reply text' } })
    // The reply's own submit button (there are now two 'reply' labels: the toggle + submit).
    const replyButtons = screen.getAllByText('docs.comment.reply')
    fireEvent.click(replyButtons[replyButtons.length - 1])

    await waitFor(() => expect(createCommentMock).toHaveBeenCalled())
    expect(createCommentMock.mock.calls[0]![0]).toBe('reply-slug')
    const input = createCommentMock.mock.calls[0]![1] as Record<string, unknown>
    expect(input).toMatchObject({ text: 'my reply text', version: 7, parentId: 'c1' })
    // 回复不带 anchor —— 这条互斥契约由数据层最终落成 body,面板这一层只负责不传它。
    expect(input.anchor).toBeUndefined()
  })

  it('reply does not POST when the mutation version is not a concrete positive integer', async () => {
    const spy = stubFetch((url, init) => {
      if ((init?.method ?? 'GET') === 'POST') return jsonResponse({ id: 'r-new' })
      return jsonResponse({ data: [{ id: 'c1', text: 'root thread', replies: [] }] })
    })
    render(
      <HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="latest" mayComment />
    )
    await waitFor(() => expect(screen.getByText('root thread')).toBeTruthy())
    fireEvent.click(screen.getByText('docs.comment.reply'))
    const box = await waitFor(() => screen.getByPlaceholderText('docs.comment.replyPlaceholder'))
    fireEvent.change(box, { target: { value: 'must not post' } })
    const replyButtons = screen.getAllByText('docs.comment.reply')
    fireEvent.click(replyButtons[replyButtons.length - 1])
    expect(screen.getByRole('alert').textContent).toContain('docs.comment.errorVersion')
    expect(spy.mock.calls.some((c) => (c[1] as RequestInit)?.method === 'POST')).toBe(false)
  })
})

// ── 评论栏与文档/表格统一后的结构 ──────────────────────────────────────────────
// 这一组钉的是「统一」这件事本身:Bot 的答复要套上「AI 修改」卡片(和表格同一个组件),
// 而 HTML 特有的引用块**不能**被顺手换掉 —— 用户明确要求只有引用部分保持原样。
//
// 为什么必须桩 useSpaceBotUids:卡片的前提是「知道谁是 Bot」。真实 hook 要拉名册,
// jsdom 里首帧恒为空集合,那时判定 fail closed(不出卡片)—— 那是对的行为,
// 但它会让这些用例永远看不到卡片,测不到东西。
vi.mock('../members/botUids.ts', () => ({
  useSpaceBotUids: () => new Set(['bot_1']),
  getSpaceBotUids: async () => new Set(['bot_1']),
}))

describe('HtmlDocCommentPanel — 与文档/表格统一的结构', () => {
  const BOT = 'bot_1'

  function botThreadFixture(replies: unknown[]) {
    return jsonResponse({
      data: [
        {
          id: 'c1',
          text: `@[user:${BOT}:test11] 把这段扩展一下`,
          author: { login: 'human_1', name: '测试用户2' },
          created_at: new Date().toISOString(),
          anchor: { kind: 'text', text: '被引用的原文' },
          replies,
        },
      ],
    })
  }

  it('Bot 的答复套上「AI 修改」卡片,且卡片留在原位', async () => {
    stubFetch(() =>
      botThreadFixture([
        { id: 'r1', text: '已扩展完成', author: { login: 'odoc-agent', name: 'odoc-agent', kind: 'agent' }, created_at: new Date().toISOString() },
      ])
    )
    const { container } = render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v1" />)
    await waitFor(() => expect(screen.getByText('已扩展完成')).toBeTruthy())
    const card = container.querySelector('.octo-agent-execution')
    expect(card).toBeTruthy()
    // 卡片**包住**那条回复,而不是浮在串顶上 —— 提到顶部会打乱时序(文档侧翻过两次车)。
    expect(card!.textContent).toContain('已扩展完成')
  })

  it('人类之间的对话不套 AI 卡片', async () => {
    // 误判的代价不对称:少一张卡片只是少个提示,多一张就是把人的讨论说成「AI 修改」。
    stubFetch(() =>
      jsonResponse({
        data: [
          {
            id: 'c1',
            text: '这段是不是写错了',
            author: { login: 'human_1' },
            created_at: new Date().toISOString(),
            replies: [{ id: 'r1', text: '我看看', author: { login: 'human_2' }, created_at: new Date().toISOString() }],
          },
        ],
      })
    )
    const { container } = render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v1" />)
    await waitFor(() => expect(screen.getByText('我看看')).toBeTruthy())
    expect(container.querySelector('.octo-agent-execution')).toBeNull()
  })

  it('@ 了 Bot 但还没回话时,串尾挂一张等待中的卡片', async () => {
    stubFetch(() => botThreadFixture([]))
    const { container } = render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v1" />)
    await waitFor(() => expect(container.querySelector('.octo-agent-execution')).toBeTruthy())
  })

  it('★ HTML 特有的引用块保持原样,没被换成表格那个单行 chip', async () => {
    // 用户明确要求「唯一不要变的是 html 引用的部分」。表格的 .octo-comment-quote 是单行
    // ellipsis,套上去会把三行引用压成一行。
    stubFetch(() => botThreadFixture([]))
    const { container } = render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v1" />)
    await waitFor(() => expect(screen.getByTestId('comment-quote')).toBeTruthy())
    expect(container.querySelector('.octo-html-doc-comment-quote')).toBeTruthy()
    expect(container.querySelector('.octo-comment-quote')).toBeNull()
  })

  it('串、正文、操作区、底部输入区都用共享的 class', async () => {
    stubFetch(() => botThreadFixture([]))
    const { container } = render(
      <HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v1" mutationVersion={1} mayComment />
    )
    await waitFor(() => expect(container.querySelector('.octo-comment-thread')).toBeTruthy())
    for (const cls of [
      '.octo-comment-list',
      '.octo-comment-thread',
      '.octo-comment-body',
      '.octo-comment-head',
      '.octo-comment-actions',
      '.octo-drawer-comment-composer',
      '.octo-drawer-comment-input-wrap',
      '.octo-drawer-comment-actions',
      '.octo-comment-submit',
    ]) {
      expect(container.querySelector(cls), `缺少 ${cls}`).toBeTruthy()
    }
  })

  it('不放「解决」按钮 —— HTML 后端改不了 status,放了就是个死按钮', async () => {
    // PATCH /v1/comments 只接受 anchor,没有 resolve 能力。要补得先加后端接口。
    stubFetch(() => botThreadFixture([]))
    render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v1" mayComment mayEdit />)
    await waitFor(() => expect(screen.getByTestId('html-doc-comment')).toBeTruthy())
    expect(screen.queryByText('docs.comment.resolve')).toBeNull()
  })
})

// ── 右键删除评论 ────────────────────────────────────────────────────────────────
// 与文档/表格一致:删除只在右键菜单里,不占正文旁边的位置。
// 权限规则照后端 authorizeOwnCommentMutation:自己的评论,或 writer+ 能删别人的。
// 前端算这个只为决定显不显示菜单项 —— 判定权在后端,算错也只是多一个会 403 的入口。
describe('HtmlDocCommentPanel — 右键删除', () => {
  function oneComment(authorLogin: string) {
    return jsonResponse({
      data: [{
        id: 'c1', text: '待删除的评论',
        author: { login: authorLogin, name: authorLogin },
        created_at: '2026-08-10T06:00:00Z', replies: [],
      }],
    })
  }

  /** 右键正文块,返回弹出的菜单元素(没弹出则为 null)。 */
  function rightClickBody(container: HTMLElement): HTMLElement | null {
    const body = container.querySelector('.octo-comment-body') as HTMLElement
    expect(body).toBeTruthy()
    fireEvent.contextMenu(body)
    return document.querySelector('.octo-comment-ctx-menu') as HTMLElement | null
  }

  it('自己的评论:右键出现删除项', async () => {
    // createMockWKApp 里当前用户是 u_self。
    stubFetch(() => oneComment('u_self'))
    const { container } = render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v1" />)
    await waitFor(() => expect(screen.getByText('待删除的评论')).toBeTruthy())

    expect(rightClickBody(container)).toBeTruthy()
    expect(screen.getByText('docs.comment.delete')).toBeTruthy()
  })

  it('别人的评论 + 无编辑权:不给删除项', async () => {
    stubFetch(() => oneComment('someone_else'))
    const { container } = render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v1" />)
    await waitFor(() => expect(screen.getByText('待删除的评论')).toBeTruthy())

    rightClickBody(container)
    expect(screen.queryByText('docs.comment.delete')).toBeNull()
  })

  it('别人的评论 + writer/admin(mayEdit):可以删', async () => {
    stubFetch(() => oneComment('someone_else'))
    const { container } = render(
      <HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v1" mayEdit />
    )
    await waitFor(() => expect(screen.getByText('待删除的评论')).toBeTruthy())

    rightClickBody(container)
    expect(screen.getByText('docs.comment.delete')).toBeTruthy()
  })

  it('点删除会打 DELETE 并重新拉列表', async () => {
    const spy = stubFetch((url, init) => {
      if ((init as RequestInit)?.method === 'DELETE') return jsonResponse({ data: {} })
      return oneComment('u_self')
    })
    const { container } = render(<HtmlDocCommentPanel docId="d1" space="sp" slug="s" listVersion="v1" />)
    await waitFor(() => expect(screen.getByText('待删除的评论')).toBeTruthy())

    rightClickBody(container)
    fireEvent.click(screen.getByText('docs.comment.delete'))

    await waitFor(() => {
      const del = spy.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'DELETE')
      expect(del).toBeTruthy()
      // 走的是 octo-doc 直连(带 slug + id 的 query),不绕 docs-backend ——
      // 删除没有 mention 要识别,绕一跳只是多一个会漂的契约。
      expect(String(del![0])).toContain('slug=s')
      expect(String(del![0])).toContain('id=c1')
    })
    // 删完要重新拉,否则被删的那条还留在界面上。
    await waitFor(() => {
      const gets = spy.mock.calls.filter((c) => (c[1] as RequestInit)?.method !== 'DELETE')
      expect(gets.length).toBeGreaterThan(1)
    })
  })
})
