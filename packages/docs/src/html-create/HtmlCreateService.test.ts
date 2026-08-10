import { afterEach, describe, expect, it, vi } from 'vitest'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import {
  buildBlankHtml,
  buildModifyHtmlPrompt,
  createBlankHtml,
  createUnpredictableSlug,
  persistModifyHtmlPrompt,
  readModifyHtmlPrompt,
} from './HtmlCreateService.ts'

describe('HtmlCreateService helpers', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('builds minimal valid HTML and escapes the title', () => {
    expect(buildBlankHtml('A < B & "quoted"')).toBe(
      '<!doctype html><html><head><meta charset="utf-8"><title>A &lt; B &amp; &quot;quoted&quot;</title></head><body></body></html>',
    )
  })

  it('uses cryptographic randomness for an unpredictable slug', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.set([0, 1, 2, 3, 250, 251, 252, 253, 16, 17, 18, 19, 20, 21, 22, 23])
      return bytes
    })
    vi.stubGlobal('crypto', { getRandomValues })
    const slug = createUnpredictableSlug()
    expect(getRandomValues).toHaveBeenCalledTimes(1)
    expect(slug).toMatch(/^html-[a-f0-9]{32}$/)
  })

  it('generates a copyable prompt with the real identifiers and user request', () => {
    const prompt = buildModifyHtmlPrompt({ docId: 'doc-real', name: 'Launch', requirements: 'Add a signup button', slug: 'html-abc' })
    expect(prompt).toContain('修改当前 HTML')
    expect(prompt).toContain('doc_id：doc-real')
    expect(prompt).toContain('HTML 名称：Launch')
    expect(prompt).toContain('slug：html-abc')
    expect(prompt).toContain('Add a signup button')
    expect(prompt).not.toContain('私聊')
    expect(prompt).not.toContain('Bot')
  })

  it('isolates persisted prompts by account', () => {
    const wk = createMockWKApp({ uid: 'u1', token: 'tok' })
    setWKApp(wk)
    persistModifyHtmlPrompt('space-1', 'doc-1', 'private prompt')
    expect(readModifyHtmlPrompt('space-1', 'doc-1')).toBe('private prompt')
    wk.loginInfo.uid = 'u2'
    expect(readModifyHtmlPrompt('space-1', 'doc-1')).toBeNull()
  })
})

describe('createBlankHtml', () => {
  it('POSTs the current space and blank v1 through the module Service boundary', async () => {
    const wk = createMockWKApp()
    wk.loginInfo = { uid: 'u1', token: 'tok' }
    setWKApp(wk)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { slug: 'html-server', version: 1, registered: true, status: 'published', doc_id: 'd_html' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => (bytes.fill(7), bytes) })

    await expect(createBlankHtml({ name: '<Hello>', requirements: 'Later', spaceId: 'space-9' })).resolves.toEqual({
      kind: 'published', docId: 'd_html', slug: 'html-server', version: 1,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/docs-html/v1/docs')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', token: 'tok' })
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ title: '<Hello>', mount_type: 'space', space_id: 'space-9' })
    expect(body.slug).toMatch(/^html-/)
    expect(body.html).toContain('<title>&lt;Hello&gt;</title>')
  })

  it('returns a terminal registration_failed result without issuing another POST', async () => {
    const wk = createMockWKApp()
    setWKApp(wk)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { slug: 'already-published', version: 1, registered: false, status: 'registration_failed' } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(1) })
    await expect(createBlankHtml({ name: 'Name', requirements: '', spaceId: 's' })).resolves.toEqual({
      kind: 'registration_failed', slug: 'already-published', version: 1,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    { registered: false, status: 'published', doc_id: 'd' },
    { registered: true, status: 'published', doc_id: '' },
    { registered: true, status: 'other', doc_id: 'd' },
  ])('rejects incomplete success data: %j', async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { slug: 's', version: 1, ...data } }) }))
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(1) })
    await expect(createBlankHtml({ name: 'Name', requirements: '', spaceId: 'space' })).rejects.toThrow('invalid publish response')
  })
})
