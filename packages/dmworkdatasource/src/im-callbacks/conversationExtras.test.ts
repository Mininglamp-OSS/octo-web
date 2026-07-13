import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSyncConversationExtrasCallback } from './conversationExtras'

vi.mock('wukongimjssdk', () => ({
  Channel: class {
    channelID: string
    channelType: number

    constructor(channelID: string, channelType: number) {
      this.channelID = channelID
      this.channelType = channelType
    }
  },
  ConversationExtra: class {},
}))

function createDeps() {
  return {
    postConversationExtrasSync: vi.fn(),
    toConversationExtra: vi.fn((channel: any, result: any) => ({
      channelID: channel.channelID,
      channelType: channel.channelType,
      result,
    }) as any),
  }
}

describe('createSyncConversationExtrasCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('posts version to conversation extra sync endpoint', async () => {
    const deps = createDeps()
    deps.postConversationExtrasSync.mockResolvedValue([])

    const callback = createSyncConversationExtrasCallback(deps)
    await callback(12)

    expect(deps.postConversationExtrasSync).toHaveBeenCalledWith(
      'conversation/extra/sync',
      { version: 12 },
    )
  })

  it('converts each result with its channel', async () => {
    const deps = createDeps()
    const first = {
      channel_id: 'u1',
      channel_type: 1,
      version: 8,
      unread: 3,
    }
    const second = {
      channel_id: 'g1',
      channel_type: 2,
      version: 9,
      mute: 1,
    }
    deps.postConversationExtrasSync.mockResolvedValue([first, second])

    const callback = createSyncConversationExtrasCallback(deps)
    const extras = await callback(7)

    expect(deps.toConversationExtra).toHaveBeenCalledTimes(2)
    expect(deps.toConversationExtra.mock.calls[0][0]).toMatchObject({
      channelID: 'u1',
      channelType: 1,
    })
    expect(deps.toConversationExtra.mock.calls[0][1]).toBe(first)
    expect(deps.toConversationExtra.mock.calls[1][0]).toMatchObject({
      channelID: 'g1',
      channelType: 2,
    })
    expect(deps.toConversationExtra.mock.calls[1][1]).toBe(second)
    expect(extras).toEqual([
      {
        channelID: 'u1',
        channelType: 1,
        result: first,
      },
      {
        channelID: 'g1',
        channelType: 2,
        result: second,
      },
    ])
  })

  it('returns an empty list when sync response is empty', async () => {
    const deps = createDeps()
    deps.postConversationExtrasSync.mockResolvedValue(null)

    const callback = createSyncConversationExtrasCallback(deps)
    const extras = await callback(0)

    expect(extras).toEqual([])
    expect(deps.toConversationExtra).not.toHaveBeenCalled()
  })
})
