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
