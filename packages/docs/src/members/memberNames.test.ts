import { describe, it, expect, beforeEach } from 'vitest'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import { getSpaceMemberNames, clearMemberNameCache } from './memberNames.ts'

describe('getSpaceMemberNames — uid → display name resolution', () => {
  let wk: ReturnType<typeof createMockWKApp>

  beforeEach(() => {
    clearMemberNameCache()
    wk = createMockWKApp()
    setWKApp(wk)
  })

  it('resolves names from the space-member seam', async () => {
    wk.spaceMembers.push({ uid: 'u1', name: 'Alice' }, { uid: 'u2', name: 'Bob' })
    const map = await getSpaceMemberNames('s_1')
    expect(map.get('u1')).toBe('Alice')
    expect(map.get('u2')).toBe('Bob')
  })

  it('caches per space (one fetch reused on a second call)', async () => {
    wk.spaceMembers.push({ uid: 'u1', name: 'Alice' })
    const first = getSpaceMemberNames('s_1')
    const second = getSpaceMemberNames('s_1')
    expect(first).toBe(second) // same in-flight promise, no second fetch
    await first
  })

  it('returns an empty map for a blank space id', async () => {
    const map = await getSpaceMemberNames('')
    expect(map.size).toBe(0)
  })
})

describe('getSpaceMemberNames — bot name backfill via /robot/space_bots (#60)', () => {
  let wk: ReturnType<typeof createMockWKApp>

  beforeEach(() => {
    clearMemberNameCache()
    wk = createMockWKApp()
    setWKApp(wk)
  })

  /** Make the mock apiClient answer /robot/space_bots?space_id=... with the given bot rows. */
  function respondBots(bots: unknown, opts: { fail?: boolean } = {}): void {
    wk.apiClient.responder = (_method, url) => {
      if (url.startsWith('/robot/space_bots')) {
        if (opts.fail) return Promise.reject(new Error('space_bots down'))
        return { data: bots, status: 200 }
      }
      return { data: {}, status: 200 }
    }
  }

  it('backfills names for bot uids missing from the space-member list (single request)', async () => {
    // A non-friend / non-self-created bot never appears in the space-member list.
    respondBots([{ uid: 'bot1', name: 'Helper Bot' }])
    const map = await getSpaceMemberNames('s_1')
    expect(map.get('bot1')).toBe('Helper Bot')
    // One space_bots request only — no per-uid fanout.
    const botCalls = wk.apiClient.calls.filter((c) => c.url.startsWith('/robot/space_bots'))
    expect(botCalls).toHaveLength(1)
    expect(botCalls[0].url).toBe('/robot/space_bots?space_id=s_1')
  })

  it('never overwrites an existing human/member display name', async () => {
    wk.spaceMembers.push({ uid: 'u1', name: 'Alice' })
    // Even if space_bots echoes u1 with a different name, the member name wins.
    respondBots([
      { uid: 'u1', name: 'Alice Bot Alias' },
      { uid: 'bot1', name: 'Helper Bot' },
    ])
    const map = await getSpaceMemberNames('s_1')
    expect(map.get('u1')).toBe('Alice') // human path unchanged
    expect(map.get('bot1')).toBe('Helper Bot')
  })

  it('falls back to the raw uid for a bot with a blank name', async () => {
    respondBots([{ uid: 'bot1', name: '' }])
    const map = await getSpaceMemberNames('s_1')
    expect(map.get('bot1')).toBe('bot1')
  })

  it('keeps human names when the space_bots request fails (best-effort backfill)', async () => {
    wk.spaceMembers.push({ uid: 'u1', name: 'Alice' })
    respondBots([], { fail: true })
    const map = await getSpaceMemberNames('s_1')
    expect(map.get('u1')).toBe('Alice')
    expect(map.has('bot1')).toBe(false)
  })

  it('tolerates a non-array space_bots body without throwing', async () => {
    wk.spaceMembers.push({ uid: 'u1', name: 'Alice' })
    respondBots({ unexpected: true })
    const map = await getSpaceMemberNames('s_1')
    expect(map.get('u1')).toBe('Alice')
  })
})
