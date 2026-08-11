// mention 候选列表的缓存有效期。
//
// 这组用例钉的是一个被用户直接撞到的缺陷:**新建一个 Bot 之后,不退出重进就永远看不到它**。
// 原因是缓存只按 role 记忆,而「新建了一个 Bot」不会让 role 变化 —— 于是第一次的答案被钉死。
//
// 但过期不能简单粗暴:role 变化时的清空是**安全要求**(降权的人不能继续看到他已经不能选的
// Bot),而单纯过期时清空只会让下拉闪一下空列表。两者必须区别对待,这里分开钉住。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMentionSourceCache } from './sourceCache.ts'
import type { MentionItem } from './source.ts'

const loadMentionSourcesMock = vi.hoisted(() =>
  vi.fn<
    (spaceId: string, opts?: Record<string, unknown>) => Promise<{ items: MentionItem[]; botNotice: null }>
  >(),
)
vi.mock('./source.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./source.ts')>()),
  loadMentionSources: loadMentionSourcesMock,
}))

function bot(id: string): MentionItem {
  return { type: 'user', id, label: id, kind: 'bot' } as unknown as MentionItem
}

function answer(...ids: string[]) {
  return { items: ids.map(bot), botNotice: null }
}

beforeEach(() => {
  vi.useFakeTimers()
  loadMentionSourcesMock.mockReset()
  loadMentionSourcesMock.mockResolvedValue(answer('bot_a'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createMentionSourceCache — 缓存有效期', () => {
  it('同一个 role 且还新鲜:只拉一次', async () => {
    const c = createMentionSourceCache({ spaceId: 'sp', docId: 'd1', getRole: () => 'writer' })
    await c.load()
    await c.load()
    await c.load()
    expect(loadMentionSourcesMock).toHaveBeenCalledTimes(1)
  })

  it('★ 过了有效期会重新拉 —— 新建的 Bot 不必退出重进才出现', async () => {
    const c = createMentionSourceCache({ spaceId: 'sp', docId: 'd1', getRole: () => 'writer' })
    await c.load()
    expect(c.items().map((i) => (i as { id: string }).id)).toEqual(['bot_a'])

    // 期间新建了一个 Bot。
    loadMentionSourcesMock.mockResolvedValue(answer('bot_a', 'bot_new'))
    vi.advanceTimersByTime(31_000)
    await c.load()

    expect(loadMentionSourcesMock).toHaveBeenCalledTimes(2)
    expect(c.items().map((i) => (i as { id: string }).id)).toEqual(['bot_a', 'bot_new'])
  })

  it('★ 过期重载期间保留旧列表,不闪空', async () => {
    const c = createMentionSourceCache({ spaceId: 'sp', docId: 'd1', getRole: () => 'writer' })
    await c.load()

    // 让第二次加载悬着不结束,模拟「正在重新拉」的那一瞬间。
    let release!: (v: { items: MentionItem[]; botNotice: null }) => void
    loadMentionSourcesMock.mockReturnValue(new Promise((r) => { release = r }))
    vi.advanceTimersByTime(31_000)
    void c.load()

    // 关键:此刻仍然是旧答案,而不是 []。清空会让用户看到列表消失再出现。
    expect(c.items().map((i) => (i as { id: string }).id)).toEqual(['bot_a'])

    release(answer('bot_a', 'bot_new'))
    await vi.waitFor(() => expect(c.items()).toHaveLength(2))
  })

  it('role 变化时立刻清空(安全要求,不能等新结果回来)', async () => {
    let role = 'writer'
    const c = createMentionSourceCache({ spaceId: 'sp', docId: 'd1', getRole: () => role as never })
    await c.load()
    expect(c.items()).toHaveLength(1)

    // 降权:此刻绝不能继续显示他已经不能选的 Bot 行。
    loadMentionSourcesMock.mockReturnValue(new Promise(() => {}))
    role = 'reader'
    void c.load()
    expect(c.items()).toEqual([])
  })

  it('role 变化即便还在有效期内也会重新拉', async () => {
    let role = 'writer'
    const c = createMentionSourceCache({ spaceId: 'sp', docId: 'd1', getRole: () => role as never })
    await c.load()
    role = 'reader'
    await c.load()
    expect(loadMentionSourcesMock).toHaveBeenCalledTimes(2)
  })
})
