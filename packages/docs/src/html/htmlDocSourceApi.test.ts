import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getVersionSource, getDiff } from './htmlDocSourceApi.ts'

// Source + diff live in the SAME separate octo-doc backend as comments/versions — raw credentialed
// fetch with the octo `token` header. Stub the global fetch and assert URL / credentials / token.
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

beforeEach(() => {
  ;(window as unknown as { __OCTO_DOC_BASE__?: string }).__OCTO_DOC_BASE__ = 'https://od.test'
})
afterEach(() => {
  delete (window as unknown as { __OCTO_DOC_BASE__?: unknown }).__OCTO_DOC_BASE__
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getVersionSource', () => {
  it('GETs <base>/v1/docs/{slug}/versions/{version}/source as text (credentialed)', async () => {
    const spy = stubFetch(() => htmlResponse('<h1>src</h1>'))
    const text = await getVersionSource('my-slug', 3)
    expect(text).toBe('<h1>src</h1>')
    expect(String(spy.mock.calls[0][0])).toBe('https://od.test/v1/docs/my-slug/versions/3/source')
    expect(spy.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
  })

  it('encodes slug + version in the path', async () => {
    const spy = stubFetch(() => htmlResponse('x'))
    await getVersionSource('a/b', 'v/2')
    expect(String(spy.mock.calls[0][0])).toBe('https://od.test/v1/docs/a%2Fb/versions/v%2F2/source')
  })

  it('forwards an AbortSignal so a stale request can be cancelled', async () => {
    const spy = stubFetch(() => htmlResponse('x'))
    const ctrl = new AbortController()
    await getVersionSource('s', 1, ctrl.signal)
    expect(spy.mock.calls[0][1]).toMatchObject({ signal: ctrl.signal })
  })

  it('throws on a non-ok response', async () => {
    stubFetch(() => htmlResponse('nope', false, 404))
    await expect(getVersionSource('s', 1)).rejects.toThrow()
  })
})

describe('getDiff', () => {
  it('GETs <base>/v1/docs/{slug}/diff?from&to and parses data', async () => {
    const spy = stubFetch(() =>
      jsonResponse({
        data: {
          from: 2,
          to: 3,
          changes: [{ op: 'replace', aid: 'a1', old_text: 'x', new_text: 'y' }],
          html_diff: [{ op: 'equal', old_ln: 1, new_ln: 1, text: '<p>a</p>' }],
        },
      }),
    )
    const d = await getDiff('slug', 2, 3)
    expect(String(spy.mock.calls[0][0])).toBe('https://od.test/v1/docs/slug/diff?from=2&to=3')
    expect(spy.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
    expect(d.from).toBe(2)
    expect(d.to).toBe(3)
    expect(d.changes).toHaveLength(1)
    expect(d.html_diff).toHaveLength(1)
  })

  it('fails soft on shape drift — missing changes → empty array, numbers from args', async () => {
    stubFetch(() => jsonResponse({ data: {} }))
    const d = await getDiff('slug', 5, 6)
    expect(d).toMatchObject({ from: 5, to: 6, changes: [] })
    expect(d.html_diff).toBeUndefined()
  })

  it('throws on a non-ok response', async () => {
    stubFetch(() => jsonResponse(null, false, 403))
    await expect(getDiff('s', 1, 2)).rejects.toThrow()
  })
})
