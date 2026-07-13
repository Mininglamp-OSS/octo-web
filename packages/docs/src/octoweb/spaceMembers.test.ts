import { describe, it, expect, beforeEach } from 'vitest'
import { setWKApp, getSpaceMembers, fetchAllSpaceMembers, fetchSpaceBotNames } from './index.ts'
import { createMockWKApp } from './mock.ts'

// Seam spike acceptance (#7): prove the docs package can reach the host's space-member source
// through the octoweb seam and get back member NAMES (not just uids). The mock injects fake
// members WITH names; the docs-side accessor must hand back `{ uid, name }` pairs.
describe('octoweb space-member seam', () => {
  let wk: ReturnType<typeof createMockWKApp>

  beforeEach(() => {
    wk = createMockWKApp()
    setWKApp(wk)
  })

  it('getSpaceMembers returns {uid, name} pairs from the injected host source', async () => {
    wk.spaceMembers.push(
      { uid: 'u_alice', name: 'Alice' },
      { uid: 'u_bob', name: 'Bob' },
    )
    const page = await getSpaceMembers('s_1', 1, 50)
    expect(page).toEqual([
      { uid: 'u_alice', name: 'Alice' },
      { uid: 'u_bob', name: 'Bob' },
    ])
  })

  it('falls back to the uid when a member has no display name', async () => {
    wk.spaceMembers.push({ uid: 'u_noname', name: '' })
    const page = await getSpaceMembers('s_1', 1, 50)
    expect(page).toEqual([{ uid: 'u_noname', name: 'u_noname' }])
  })

  it('fetchAllSpaceMembers loops pages (size 50) until exhausted', async () => {
    // 120 members -> three pages (50 + 50 + 20). The seam must aggregate all of them.
    for (let i = 0; i < 120; i++) {
      wk.spaceMembers.push({ uid: `u_${i}`, name: `User ${i}` })
    }
    const all = await fetchAllSpaceMembers('s_1')
    expect(all).toHaveLength(120)
    expect(all[0]).toEqual({ uid: 'u_0', name: 'User 0' })
    expect(all[119]).toEqual({ uid: 'u_119', name: 'User 119' })
  })

  it('returns an empty list for a blank space id without touching the host', async () => {
    expect(await fetchAllSpaceMembers('')).toEqual([])
  })

  it('carries avatar + isBot through when present, omitting them otherwise', async () => {
    wk.spaceMembers.push(
      { uid: 'u_plain', name: 'Plain' },
      { uid: 'u_bot', name: 'Bot', avatar: 'https://cdn/x.png', isBot: true },
    )
    const page = await getSpaceMembers('s_1', 1, 50)
    // Plain member: no avatar / isBot noise.
    expect(page[0]).toEqual({ uid: 'u_plain', name: 'Plain' })
    // Rich member: avatar + isBot preserved.
    expect(page[1]).toEqual({ uid: 'u_bot', name: 'Bot', avatar: 'https://cdn/x.png', isBot: true })
  })
})

// #60: the space-member source filters out non-self-created bots, so their names come from the
// single non-viewer-scoped `GET /robot/space_bots?space_id=` request instead.
describe('octoweb fetchSpaceBotNames seam', () => {
  let wk: ReturnType<typeof createMockWKApp>

  beforeEach(() => {
    wk = createMockWKApp()
    setWKApp(wk)
  })

  it('issues one space_bots request and maps {uid, name} pairs', async () => {
    wk.apiClient.responder = (_m, url) =>
      url.startsWith('/robot/space_bots')
        ? { data: [{ uid: 'bot1', name: 'Helper' }, { uid: 'bot2', name: 'Scribe' }], status: 200 }
        : { data: {}, status: 200 }
    const bots = await fetchSpaceBotNames('s_1')
    expect(bots).toEqual([
      { uid: 'bot1', name: 'Helper' },
      { uid: 'bot2', name: 'Scribe' },
    ])
    const calls = wk.apiClient.calls.filter((c) => c.url.startsWith('/robot/space_bots'))
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/robot/space_bots?space_id=s_1')
  })

  it('falls back to the uid for a bot with no name and skips entries without a uid', async () => {
    wk.apiClient.responder = () => ({
      data: [{ uid: 'bot1', name: '' }, { name: 'ghost' }],
      status: 200,
    })
    const bots = await fetchSpaceBotNames('s_1')
    expect(bots).toEqual([{ uid: 'bot1', name: 'bot1' }])
  })

  it('returns an empty list for a non-array body', async () => {
    wk.apiClient.responder = () => ({ data: { nope: true }, status: 200 })
    expect(await fetchSpaceBotNames('s_1')).toEqual([])
  })

  it('returns an empty list for a blank space id without touching the host', async () => {
    expect(await fetchSpaceBotNames('')).toEqual([])
    expect(wk.apiClient.calls).toHaveLength(0)
  })
})
