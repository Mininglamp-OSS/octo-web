import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { listComments, createComment, formatCommentTime } from './htmlDocComments.ts'
import { setWKApp, getWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'

// octo-doc comments live in a SEPARATE backend (same deployment as the published HTML), reached
// by raw credentialed fetch — so we stub the global fetch and assert URL/credentials/body, NOT
// the octoweb apiClient.
function stubFetch(impl: (url: string, init?: RequestInit) => unknown) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(impl(String(input), init)),
  ) as unknown as typeof fetch
  vi.stubGlobal('fetch', spy)
  return spy as unknown as ReturnType<typeof vi.fn>
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

beforeEach(() => {
  ;(window as unknown as { __OCTO_DOC_BASE__?: string }).__OCTO_DOC_BASE__ = 'https://od.test'
})
afterEach(() => {
  delete (window as unknown as { __OCTO_DOC_BASE__?: unknown }).__OCTO_DOC_BASE__
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('listComments (octo-doc backend)', () => {
  it('GETs <base>/v1/comments?slug&version with credentials and returns data', async () => {
    const spy = stubFetch(() =>
      jsonResponse({ data: [{ id: 'c1', text: 'hi', replies: [] }] }),
    )
    const roots = await listComments('my-slug', 'v3')
    expect(roots).toHaveLength(1)
    expect(roots[0].id).toBe('c1')
    // Hit the octo-doc /v1/comments endpoint (resolveOctoDocBase), NOT /api/v1.
    expect(String(spy.mock.calls[0][0])).toBe('https://od.test/v1/comments?slug=my-slug&version=v3')
    expect(spy.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
  })

  it('returns [] when the payload has no roots', async () => {
    stubFetch(() => jsonResponse({}))
    expect(await listComments('s', 'latest')).toEqual([])
  })

  it('throws on a non-ok response', async () => {
    stubFetch(() => jsonResponse(null, false, 403))
    await expect(listComments('s', 'latest')).rejects.toThrow()
  })
})

describe('createComment — 走 docs-backend 的转发路由', () => {
  // 创建**不再直连 octo-doc**:必须让 docs-backend 在链路上,否则没人识别 @bot、没人入队,
  // HTML 文档永远等不到 Bot(见 htmlDocComments.ts createComment 的说明)。
  // 读仍然直连,所以上面 listComments 那几条继续断言裸 fetch。
  function stubApiPost(impl: (path: string, body: unknown) => unknown) {
    const post = vi.fn(async (path: string, body: unknown) => ({ data: impl(path, body) }))
    setWKApp(createMockWKApp() as never)
    const wk = getWKApp() as unknown as { apiClient: { post: typeof post } }
    wk.apiClient.post = post
    return post
  }

  it('POSTs /docs/html/<slug>/comments with {text,version,anchor}', async () => {
    const post = stubApiPost(() => ({ id: 'new1' }))
    const res = await createComment('my-slug', {
      text: 'please fix',
      version: 3,
      anchor: { kind: 'element', aid: 'a42', selector: '[data-odoc-aid="a42"]', label: 'p' },
    })
    expect(res.id).toBe('new1')
    expect(post.mock.calls[0]![0]).toBe('/docs/html/my-slug/comments')
    const body = post.mock.calls[0]![1] as Record<string, unknown>
    expect(body).toMatchObject({
      text: 'please fix',
      version: 3,
      anchor: { kind: 'element', aid: 'a42' },
    })
    expect(body.parent_id).toBeUndefined()
  })

  it('percent-encodes the slug into the path', async () => {
    // slug 进了 URL 路径,不编码的话带 / 或 # 的 slug 会把路由切错。
    const post = stubApiPost(() => ({ id: 'x' }))
    await createComment('a/b c', { text: 't', version: 1 })
    expect(post.mock.calls[0]![0]).toBe('/docs/html/a%2Fb%20c/comments')
  })

  it('drops anchor when parentId is set (exclusive reply contract)', async () => {
    // 这条契约没变,只是换了传输:回复只带 parent_id,根评论只带 anchor,
    // 绝不能同时出现(octo-doc 会按歧义拒掉)。
    const post = stubApiPost(() => ({ id: 'r2' }))
    await createComment('s', {
      text: 'reply',
      version: 4,
      parentId: 'c1',
      anchor: { kind: 'element', aid: 'a1', selector: '[data-odoc-aid="a1"]' },
    })
    const body = post.mock.calls[0]![1] as Record<string, unknown>
    expect(body.parent_id).toBe('c1')
    expect(body.anchor).toBeUndefined()
  })

  it('includes parent_id and omits anchor for a reply', async () => {
    const post = stubApiPost(() => ({ id: 'r1' }))
    await createComment('s', { text: 'reply', version: 4, parentId: 'c1' })
    const body = post.mock.calls[0]![1] as Record<string, unknown>
    expect(body.parent_id).toBe('c1')
    expect(body.anchor).toBeUndefined()
  })

  it('propagates a failure instead of swallowing it', async () => {
    // apiClient 对非 2xx 自己抛。这条钉住我们没有把它吞成「成功但没 id」——
    // 那会让用户以为评论发出去了。
    setWKApp(createMockWKApp() as never)
    const wk = getWKApp() as unknown as { apiClient: { post: unknown } }
    wk.apiClient.post = vi.fn(async () => {
      throw new Error('403')
    })
    await expect(createComment('s', { text: 'x', version: 4 })).rejects.toThrow()
  })
})

describe('formatCommentTime', () => {
  it('formats an ISO timestamp as YYYY-MM-DD HH:mm (local, zero-padded)', () => {
    // Local-time formatting: derive the expected string from the same Date so the assertion
    // is timezone-independent.
    const iso = '2026-07-15T04:09:00Z'
    const d = new Date(iso)
    const p = (n: number) => String(n).padStart(2, '0')
    const expected = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    expect(formatCommentTime(iso)).toBe(expected)
    // Minute/hour are zero-padded to two digits.
    expect(formatCommentTime(iso)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('returns "" for empty / null / unparseable input (so the caller drops the time)', () => {
    expect(formatCommentTime(undefined)).toBe('')
    expect(formatCommentTime(null)).toBe('')
    expect(formatCommentTime('')).toBe('')
    expect(formatCommentTime('not-a-date')).toBe('')
  })
})
