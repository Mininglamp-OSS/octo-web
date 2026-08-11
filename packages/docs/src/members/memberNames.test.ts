import { describe, it, expect, beforeEach } from 'vitest'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import { getSpaceMemberNames, getSpaceMemberDirectory, clearMemberNameCache } from './memberNames.ts'

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

describe('getSpaceMemberDirectory — bot uid set (PR C need #3)', () => {
  let wk: ReturnType<typeof createMockWKApp>

  beforeEach(() => {
    clearMemberNameCache()
    wk = createMockWKApp()
    setWKApp(wk)
  })

  function respondBots(bots: unknown, opts: { fail?: boolean } = {}): void {
    wk.apiClient.responder = (_method, url) => {
      if (url.startsWith('/robot/space_bots')) {
        if (opts.fail) return Promise.reject(new Error('space_bots down'))
        return { data: bots, status: 200 }
      }
      return { data: {}, status: 200 }
    }
  }

  it('marks space-member entries flagged isBot as bots, humans stay out of the set', async () => {
    wk.spaceMembers.push(
      { uid: 'u_human', name: 'Alice' },
      { uid: 'u_bot', name: 'Helper', isBot: true },
    )
    respondBots([])
    const dir = await getSpaceMemberDirectory('s_1')
    expect(dir.botUids.has('u_bot')).toBe(true)
    expect(dir.botUids.has('u_human')).toBe(false)
  })

  it('adds every /robot/space_bots uid to the bot set (that endpoint returns bots only)', async () => {
    wk.spaceMembers.push({ uid: 'u_human', name: 'Alice' })
    respondBots([{ uid: 'bot1', name: 'Bot One' }])
    const dir = await getSpaceMemberDirectory('s_1')
    expect(dir.botUids.has('bot1')).toBe(true)
    expect(dir.botUids.has('u_human')).toBe(false)
    // Names still resolve for both.
    expect(dir.names.get('bot1')).toBe('Bot One')
    expect(dir.names.get('u_human')).toBe('Alice')
  })

  it('fail-soft: an empty space yields an empty bot set (unknown ⇒ human)', async () => {
    const dir = await getSpaceMemberDirectory('')
    expect(dir.botUids.size).toBe(0)
    expect(dir.names.size).toBe(0)
  })

  it('fail-soft: a missing isBot flag is treated as human, never as a bot', async () => {
    // No isBot on the member and no space_bots rows → nothing is classified as a bot.
    wk.spaceMembers.push({ uid: 'u_maybe', name: 'Maybe' })
    respondBots([])
    const dir = await getSpaceMemberDirectory('s_1')
    expect(dir.botUids.size).toBe(0)
  })

  it('getSpaceMemberNames stays identity-stable (single fetch) alongside the directory', async () => {
    wk.spaceMembers.push({ uid: 'u1', name: 'Alice' })
    const first = getSpaceMemberNames('s_1')
    const second = getSpaceMemberNames('s_1')
    expect(first).toBe(second)
    await first
  })
})

describe('getSpaceMemberDirectory — botCreators from /robot/space_bots creator_uid (PR C nesting)', () => {
  let wk: ReturnType<typeof createMockWKApp>

  beforeEach(() => {
    clearMemberNameCache()
    wk = createMockWKApp()
    setWKApp(wk)
  })

  function respondBots(bots: unknown): void {
    wk.apiClient.responder = (_method, url) => {
      if (url.startsWith('/robot/space_bots')) return { data: bots, status: 200 }
      return { data: {}, status: 200 }
    }
  }

  it('maps botUid → creatorUid straight from the endpoint creator_uid', async () => {
    respondBots([
      { uid: 'bot1', name: 'Bot One', creator_uid: 'u_human' },
      { uid: 'bot2', name: 'Bot Two', creator_uid: 'u_owner' },
    ])
    const dir = await getSpaceMemberDirectory('s_1')
    expect(dir.botCreators.get('bot1')).toBe('u_human')
    expect(dir.botCreators.get('bot2')).toBe('u_owner')
    // Both bots are still in the bot set + name map (no behavior lost).
    expect(dir.botUids.has('bot1')).toBe(true)
    expect(dir.names.get('bot1')).toBe('Bot One')
  })

  it('leaves a bot with NO creator_uid out of botCreators (still a bot, just ownerless)', async () => {
    respondBots([{ uid: 'bot1', name: 'Bot One' }])
    const dir = await getSpaceMemberDirectory('s_1')
    expect(dir.botCreators.has('bot1')).toBe(false)
    // It is still classified as a bot (space_bots endpoint returns bots only).
    expect(dir.botUids.has('bot1')).toBe(true)
  })

  it('fail-soft: blank space / empty directory yields an empty botCreators map', async () => {
    const dir = await getSpaceMemberDirectory('')
    expect(dir.botCreators.size).toBe(0)
  })
})
