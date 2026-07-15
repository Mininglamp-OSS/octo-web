import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Channel } from 'wukongimjssdk'
import { createMessageReadedCallback } from './messageReaded'

vi.mock('wukongimjssdk', () => ({
  Channel: class {
    channelID: string
    channelType: number

    constructor(channelID: string, channelType: number) {
      this.channelID = channelID
      this.channelType = channelType
    }
  },
  Message: class {},
}))

function createDeps() {
  return {
    postMessageReaded: vi.fn(),
  }
}

describe('createMessageReadedCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('posts read message ids for the channel', async () => {
    const deps = createDeps()
    const result = { ok: true }
    deps.postMessageReaded.mockResolvedValue(result)
    const channel = new Channel('g1', 2)
    const messages = [
      { messageID: 'm1' },
      { messageID: 'm2' },
    ] as any[]

    const callback = createMessageReadedCallback(deps)
    const response = await callback(channel, messages)

    expect(deps.postMessageReaded).toHaveBeenCalledWith(
      'message/readed',
      {
        channel_id: 'g1',
        channel_type: 2,
        message_ids: ['m1', 'm2'],
      },
    )
    expect(response).toBe(result)
  })

  it('posts an empty message id list when messages are missing', async () => {
    const deps = createDeps()
    deps.postMessageReaded.mockResolvedValue({ ok: true })
    const channel = new Channel('g1', 2)

    const callback = createMessageReadedCallback(deps)
    await callback(channel, undefined as any)

    expect(deps.postMessageReaded).toHaveBeenCalledWith(
      'message/readed',
      {
        channel_id: 'g1',
        channel_type: 2,
        message_ids: [],
      },
    )
  })

  it('keeps the existing behavior of swallowing post failures', async () => {
    const deps = createDeps()
    deps.postMessageReaded.mockRejectedValue(new Error('network'))
    const channel = new Channel('g1', 2)

    const callback = createMessageReadedCallback(deps)
    const response = await callback(channel, [{ messageID: 'm1' }] as any[])

    expect(response).toBeUndefined()
  })
})
