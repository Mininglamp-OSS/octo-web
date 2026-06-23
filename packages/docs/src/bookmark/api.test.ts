import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp, type MockApiClient } from '../octoweb/mock.ts'
import { fetchLinkCard, type LinkCard } from './api.ts'

let api: MockApiClient

beforeEach(() => {
  const wk = createMockWKApp()
  api = wk.apiClient
  setWKApp(wk)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('bookmark API — link-card (SCHEMA-SPEC §15, bare-relative docs path)', () => {
  it('POSTs to /docs/{docId}/link-card with { url } and maps the exact field set', async () => {
    const full: LinkCard = {
      url: 'https://example.com/post',
      title: 'Example Post',
      description: 'A description of the post.',
      image: 'https://img.example.com/og.png',
      siteName: 'Example',
      fetchedAt: '2026-06-23T10:00:00Z',
    }
    api.responder = () => ({ data: full, status: 200 })

    const card = await fetchLinkCard('d_1', 'https://example.com/post')

    // The contract field set is mapped EXACTLY — same names, same values, no aliases.
    expect(card).toEqual(full)
    expect(Object.keys(card).sort()).toEqual(
      ['description', 'fetchedAt', 'image', 'siteName', 'title', 'url'].sort(),
    )
    expect(api.calls[0]).toMatchObject({
      method: 'post',
      url: '/docs/d_1/link-card',
      body: { url: 'https://example.com/post' },
    })
  })

  it('degrades gracefully when the backend omits fields (missing → null)', async () => {
    // Only url + title resolved; the rest are absent on the wire.
    api.responder = () => ({
      data: { url: 'https://example.com/x', title: 'Just a title' },
      status: 200,
    })

    const card = await fetchLinkCard('d_1', 'https://example.com/x')

    expect(card).toEqual({
      url: 'https://example.com/x',
      title: 'Just a title',
      description: null,
      image: null,
      siteName: null,
      fetchedAt: null,
    })
  })

  it('echoes the requested url when the backend response omits url entirely', async () => {
    api.responder = () => ({ data: {}, status: 200 })
    const card = await fetchLinkCard('d_2', 'https://no-meta.example.com')
    expect(card.url).toBe('https://no-meta.example.com')
    expect(card.title).toBeNull()
    expect(card.image).toBeNull()
  })
})
