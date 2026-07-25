import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { listVersions } from './htmlDocVersions.ts'
import { deleteDoc } from './htmlDocAdmin.ts'

// octo-doc versions/admin live in the SAME separate backend as comments — reached by raw
// credentialed fetch. Stub the global fetch and assert URL (PATH slug) / credentials / method.
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

describe('listVersions (octo-doc backend)', () => {
  it('GETs <base>/v1/docs/{slug}/versions and parses data.data.versions', async () => {
    const spy = stubFetch(() =>
      jsonResponse({
        data: {
          slug: 'my-slug',
          title: 'Doc',
          versions: [
            { n: 3, created_at: '2026-07-15T04:00:00Z' },
            { n: 2, created_at: '2026-07-14T04:00:00Z' },
          ],
        },
      }),
    )
    const versions = await listVersions('my-slug')
    expect(versions).toHaveLength(2)
    expect(versions[0]).toMatchObject({ n: 3 })
    // PATH slug, not a query param; credentialed.
    expect(String(spy.mock.calls[0][0])).toBe('https://od.test/v1/docs/my-slug/versions')
    expect(spy.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
  })

  it('encodes the slug in the path', async () => {
    const spy = stubFetch(() => jsonResponse({ data: { versions: [] } }))
    await listVersions('a/b?c')
    expect(String(spy.mock.calls[0][0])).toBe('https://od.test/v1/docs/a%2Fb%3Fc/versions')
  })

  it('returns [] when the payload has no versions', async () => {
    stubFetch(() => jsonResponse({ data: {} }))
    expect(await listVersions('s')).toEqual([])
  })

  it('throws on a non-ok response', async () => {
    stubFetch(() => jsonResponse(null, false, 403))
    await expect(listVersions('s')).rejects.toThrow()
  })
})

describe('deleteDoc (octo-doc backend)', () => {
  it('DELETEs <base>/v1/docs/{slug} with credentials', async () => {
    const spy = stubFetch(() => jsonResponse({}, true, 204))
    await deleteDoc('my-slug')
    expect(String(spy.mock.calls[0][0])).toBe('https://od.test/v1/docs/my-slug')
    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('DELETE')
    expect(init.credentials).toBe('include')
  })

  it('throws on a non-ok response', async () => {
    stubFetch(() => jsonResponse(null, false, 500))
    await expect(deleteDoc('s')).rejects.toThrow()
  })
})
