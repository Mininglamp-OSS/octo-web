import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { listComments, createComment, formatCommentTime } from './htmlDocComments.ts'

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
  it('GETs <base>/comments?slug&version with credentials and returns data', async () => {
    const spy = stubFetch(() =>
      jsonResponse({ data: [{ id: 'c1', text: 'hi', replies: [] }] }),
    )
    const roots = await listComments('my-slug', 'v3')
    expect(roots).toHaveLength(1)
    expect(roots[0].id).toBe('c1')
    // Hit the octo-doc /comments endpoint (resolveOctoDocBase), NOT /api/v1.
    expect(String(spy.mock.calls[0][0])).toBe('https://od.test/comments?slug=my-slug&version=v3')
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

describe('createComment (octo-doc backend)', () => {
  it('POSTs <base>/comments with {slug,text,version,anchor} and credentials', async () => {
    const spy = stubFetch(() => jsonResponse({ id: 'new1' }))
    const res = await createComment('my-slug', {
      text: 'please fix',
      version: 'v3',
      anchor: { kind: 'element', aid: 'a42', selector: '[data-odoc-aid="a42"]', label: 'p' },
    })
    expect(res.id).toBe('new1')
    expect(String(spy.mock.calls[0][0])).toBe('https://od.test/comments')
    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({
      slug: 'my-slug',
      text: 'please fix',
      version: 'v3',
      anchor: { kind: 'element', aid: 'a42' },
    })
    // No parent_id when not a reply.
    expect(body.parent_id).toBeUndefined()
  })

  it('drops anchor when parentId is set (exclusive reply contract)', async () => {
    const spy = stubFetch(() => jsonResponse({ id: 'r2' }))
    await createComment('s', {
      text: 'reply',
      version: 'latest',
      parentId: 'c1',
      anchor: { kind: 'element', aid: 'a1', selector: '[data-odoc-aid="a1"]' },
    })
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string)
    expect(body.parent_id).toBe('c1')
    expect(body.anchor).toBeUndefined()
  })

  it('includes parent_id and omits anchor for a reply', async () => {
    const spy = stubFetch(() => jsonResponse({ id: 'r1' }))
    await createComment('s', { text: 'reply', version: 'latest', parentId: 'c1' })
    const body = JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body))
    expect(body.parent_id).toBe('c1')
    expect(body.anchor).toBeUndefined()
  })

  it('throws on a non-ok response', async () => {
    stubFetch(() => jsonResponse(null, false, 500))
    await expect(createComment('s', { text: 'x', version: 'latest' })).rejects.toThrow()
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
