import { describe, it, expect, beforeEach } from 'vitest'
import { setWKApp, getSpaceMembers, fetchAllSpaceMembers, fetchSpaceBotNames, fetchMyBots } from './index.ts'
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

  it('fetchAllSpaceMembers returns the FULL roster, past the old 1000-member page cap', async () => {
    // 1100 members: the old 50×20=1000 page cap silently dropped everyone past 1000 (the
    // 5760-member picker bug). The full-roster fetch (one big page) must return all of them.
    for (let i = 0; i < 1100; i++) {
      wk.spaceMembers.push({ uid: `u_${i}`, name: `User ${i}` })
    }
    const all = await fetchAllSpaceMembers('s_1')
    expect(all).toHaveLength(1100)
    expect(all[0]).toEqual({ uid: 'u_0', name: 'User 0' })
    expect(all[1099]).toEqual({ uid: 'u_1099', name: 'User 1099' })
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

// #839: friend-added agents (including ones owned by others) reach the doc-authorize roster via
// GET /robot/my_bots, a pure friend-dimension query that never surfaces non-friend agents.
describe('octoweb fetchMyBots seam', () => {
  let wk: ReturnType<typeof createMockWKApp>

  beforeEach(() => {
    wk = createMockWKApp()
    setWKApp(wk)
  })

  it('maps friend agents to {uid, name, isBot} and scopes the request to the space', async () => {
    wk.apiClient.responder = (_m, url) =>
      url.startsWith('/robot/my_bots')
        ? { data: [{ uid: 'bot_friend', name: "Someone's Bot" }, { uid: 'bot_mine', name: 'My Bot' }], status: 200 }
        : { data: {}, status: 200 }
    const bots = await fetchMyBots('s_1')
    expect(bots).toEqual([
      { uid: 'bot_friend', name: "Someone's Bot", isBot: true },
      { uid: 'bot_mine', name: 'My Bot', isBot: true },
    ])
    const calls = wk.apiClient.calls.filter((c) => c.url.startsWith('/robot/my_bots'))
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/robot/my_bots?space_id=s_1')
  })

  it('omits the space_id param when no space is given', async () => {
    wk.apiClient.responder = () => ({ data: [], status: 200 })
    await fetchMyBots()
    expect(wk.apiClient.calls[0].url).toBe('/robot/my_bots')
  })

  it('falls back to the uid for an agent with no name and skips entries without a uid', async () => {
    wk.apiClient.responder = () => ({
      data: [{ uid: 'bot1', name: '' }, { name: 'ghost' }],
      status: 200,
    })
    expect(await fetchMyBots('s_1')).toEqual([{ uid: 'bot1', name: 'bot1', isBot: true }])
  })

  it('returns an empty list for a non-array body', async () => {
    wk.apiClient.responder = () => ({ data: { nope: true }, status: 200 })
    expect(await fetchMyBots('s_1')).toEqual([])
  })
})
