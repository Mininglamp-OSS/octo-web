import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getVersionSource, getDiff } from './htmlDocSourceApi.ts'

function stubFetch(impl: (url: string, init?: RequestInit) => unknown) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(impl(String(input), init)),
  ) as unknown as typeof fetch
  vi.stubGlobal('fetch', spy)
  return spy as unknown as ReturnType<typeof vi.fn>
}
function htmlResponse(body: string, ok = true, status = 200): Response {
  return { ok, status, text: async () => body } as unknown as Response
}
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

const backendDiff = {
  from: 2,
  to: 3,
  summary: { added: 1, removed: 0, modified: 1 },
  changes: [
    {
      kind: 'modified',
      before_aid: 'old-aid',
      after_aid: 'new-aid',
      dom_path: '/html[1]/body[1]/p[1]',
      before_path: '/html[1]/body[1]/p[1]',
      after_path: '/html[1]/body[1]/p[1]',
      before_html: '<p data-odoc-aid="old-aid">old</p>',
      after_html: '<p data-odoc-aid="new-aid">new</p>',
    },
    {
      kind: 'added',
      after_aid: 'added-aid',
      dom_path: '/html[1]/body[1]/p[2]',
      after_path: '/html[1]/body[1]/p[2]',
      after_html: '<p data-odoc-aid="added-aid">added</p>',
    },
  ],
  code_hunks: [
    {
      old_start: 1,
      old_lines: 2,
      new_start: 1,
      new_lines: 3,
      lines: [' <html>', '-<p>old</p>', '+<p>new</p>', '+<p>added</p>'],
    },
  ],
}

beforeEach(() => {
  ;(window as unknown as { __OCTO_DOC_BASE__?: string }).__OCTO_DOC_BASE__ = 'https://od.test'
})
afterEach(() => {
  delete (window as unknown as { __OCTO_DOC_BASE__?: unknown }).__OCTO_DOC_BASE__
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getVersionSource', () => {
  it('uses browser-native caching and keeps the credentialed source request', async () => {
    const spy = stubFetch(() => htmlResponse('<h1>src</h1>'))
    expect(await getVersionSource('my-slug', 3)).toBe('<h1>src</h1>')
    expect(String(spy.mock.calls[0][0])).toBe('https://od.test/v1/docs/my-slug/versions/3/source')
    expect(spy.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
    expect((spy.mock.calls[0][1] as RequestInit).cache).toBeUndefined()
  })

  it('revalidates latest with browser no-cache', async () => {
    const spy = stubFetch(() => htmlResponse('<h1>latest</h1>'))
    await getVersionSource('my-slug', 'latest')
    expect((spy.mock.calls[0][1] as RequestInit).cache).toBe('no-cache')
  })

  it('encodes the path and forwards AbortSignal', async () => {
    const spy = stubFetch(() => htmlResponse('x'))
    const controller = new AbortController()
    await getVersionSource('a/b', 'v/2', controller.signal)
    expect(String(spy.mock.calls[0][0])).toBe('https://od.test/v1/docs/a%2Fb/versions/v%2F2/source')
    expect(spy.mock.calls[0][1]).toMatchObject({ signal: controller.signal })
  })

  it('throws on a non-ok response', async () => {
    stubFetch(() => htmlResponse('nope', false, 404))
    await expect(getVersionSource('s', 1)).rejects.toThrow()
  })
})

describe('getDiff', () => {
  it('parses the real VersionDiff wire shape inside a data envelope', async () => {
    const spy = stubFetch(() => jsonResponse({ data: backendDiff }))
    const result = await getDiff('slug', 2, 3)
    expect(String(spy.mock.calls[0][0])).toBe('https://od.test/v1/docs/slug/diff?from=2&to=3')
    expect(result).toEqual(backendDiff)
  })

  it('also accepts the VersionDiff object without an envelope', async () => {
    stubFetch(() => jsonResponse(backendDiff))
    await expect(getDiff('slug', 2, 3)).resolves.toEqual(backendDiff)
  })

  it('rejects contract drift instead of silently returning empty changes', async () => {
    stubFetch(() => jsonResponse({ data: { from: 2, to: 3, changes: [] } }))
    await expect(getDiff('slug', 2, 3)).rejects.toThrow('missing summary')
  })

  it('rejects invalid change locators', async () => {
    stubFetch(() =>
      jsonResponse({
        data: {
          ...backendDiff,
          changes: [{ kind: 'modified', dom_path: '/html[1]/body[1]/p[1]' }],
        },
      }),
    )
    await expect(getDiff('slug', 2, 3)).rejects.toThrow('missing old locator')
  })

  it('throws on a non-ok response', async () => {
    stubFetch(() => jsonResponse(null, false, 403))
    await expect(getDiff('s', 1, 2)).rejects.toThrow()
  })
})
