// 空间 Bot 名册的缓存有效期。
//
// 这层缓存喂的是「AI 修改卡片」的判定(谁是 Bot)。原来是永久缓存:新建的 Bot 在页面刷新前
// 永远进不了名册 —— 它的 @ 会被当成 @ 了个普通人,卡片不出现。与 mentions/sourceCache.ts
// 取同一个 TTL,免得出现「下拉里看得到、判定认不出」的半新半旧状态。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getSpaceBotUids, clearSpaceBotUidCache } from './botUids.ts'

const fetchSpaceBotNamesMock = vi.hoisted(() =>
  vi.fn<(spaceId: string) => Promise<{ uid: string; name: string }[]>>(),
)
vi.mock('../octoweb/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../octoweb/index.ts')>()),
  fetchSpaceBotNames: fetchSpaceBotNamesMock,
}))

beforeEach(() => {
  vi.useFakeTimers()
  clearSpaceBotUidCache()
  fetchSpaceBotNamesMock.mockReset()
  fetchSpaceBotNamesMock.mockResolvedValue([{ uid: 'bot_a', name: 'A' }])
})
afterEach(() => {
  vi.useRealTimers()
  clearSpaceBotUidCache()
})

describe('getSpaceBotUids — 缓存有效期', () => {
  it('有效期内复用,只打一次名册接口', async () => {
    await getSpaceBotUids('sp')
    await getSpaceBotUids('sp')
    expect(fetchSpaceBotNamesMock).toHaveBeenCalledTimes(1)
  })

  it('★ 过期后重新拉,新建的 Bot 能进名册', async () => {
    expect([...(await getSpaceBotUids('sp'))]).toEqual(['bot_a'])

    fetchSpaceBotNamesMock.mockResolvedValue([
      { uid: 'bot_a', name: 'A' },
      { uid: 'bot_new', name: 'New' },
    ])
    vi.advanceTimersByTime(31_000)

    expect([...(await getSpaceBotUids('sp'))]).toEqual(['bot_a', 'bot_new'])
    expect(fetchSpaceBotNamesMock).toHaveBeenCalledTimes(2)
  })

  it('拉取失败不缓存「没有 Bot」,下次会重试', async () => {
    fetchSpaceBotNamesMock.mockRejectedValueOnce(new Error('network'))
    expect([...(await getSpaceBotUids('sp'))]).toEqual([])

    // 没有等 TTL —— 失败的条目应当立刻被剔除,而不是把「无 Bot」缓存 30 秒。
    fetchSpaceBotNamesMock.mockResolvedValue([{ uid: 'bot_a', name: 'A' }])
    expect([...(await getSpaceBotUids('sp'))]).toEqual(['bot_a'])
  })

  it('clearSpaceBotUidCache 之后立刻重拉(时间戳也被清)', async () => {
    await getSpaceBotUids('sp')
    clearSpaceBotUidCache()
    await getSpaceBotUids('sp')
    // 只清 cache 不清时间戳的话,这次会因为「还新鲜」而跳过重拉。
    expect(fetchSpaceBotNamesMock).toHaveBeenCalledTimes(2)
  })

  it('★ 并发的两次调用只打一次请求(时间戳必须在发起时就记)', async () => {
    // 曾经把 fetchedAt 设在 Promise resolve 之后:第一次还在飞、第二次就进来时,
    // 时间戳还是空的 ⇒ 被判成过期 ⇒ 又打一次。这里不 await 第一次,专门复现那个时序。
    const a = getSpaceBotUids('sp')
    const b = getSpaceBotUids('sp')
    expect(a).toBe(b)
    await Promise.all([a, b])
    expect(fetchSpaceBotNamesMock).toHaveBeenCalledTimes(1)
  })

  it('空 spaceId 不发请求', async () => {
    expect([...(await getSpaceBotUids(''))]).toEqual([])
    expect(fetchSpaceBotNamesMock).not.toHaveBeenCalled()
  })
})
