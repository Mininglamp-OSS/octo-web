import { afterEach, describe, expect, it, vi } from 'vitest'
import { addGrant, type HtmlGrantRole } from './htmlGrantsApi.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('htmlGrantsApi', () => {
  it.each<HtmlGrantRole>(['reader', 'commenter', 'writer'])('sends the HTML grant role %s', async (role) => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true } as Response))
    vi.stubGlobal('fetch', fetchSpy)
    await addGrant('doc', 'user', role)
    const init = fetchSpy.mock.calls[0]?.[1]
    expect(JSON.parse(String(init?.body))).toEqual({ uid: 'user', role })
  })

  it('excludes admin from the HTML grant contract at compile time', () => {
    // @ts-expect-error HTML grants never mint administrators.
    const invalid: HtmlGrantRole = 'admin'
    expect(invalid).toBe('admin')
  })
})
