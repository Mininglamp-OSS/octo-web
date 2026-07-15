import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Channel } from 'wukongimjssdk'
import { createSyncMessageExtraCallback } from './messageExtras'

vi.mock('wukongimjssdk', () => ({
  Channel: class {
    channelID: string
    channelType: number

    constructor(channelID: string, channelType: number) {
      this.channelID = channelID
      this.channelType = channelType
    }
  },
  MessageExtra: class {},
}))

function createDeps() {
  return {
    syncMessageExtras: vi.fn(),
  }
}

describe('createSyncMessageExtraCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates message extra sync with the original arguments', async () => {
    const deps = createDeps()
    const result = [{ messageID: 'm1' }]
    deps.syncMessageExtras.mockResolvedValue(result)
    const channel = new Channel('g1', 2)

    const callback = createSyncMessageExtraCallback(deps)
    const extras = await callback(channel, 11, 50)

    expect(deps.syncMessageExtras).toHaveBeenCalledWith(channel, 11, 50)
    expect(extras).toBe(result)
  })
})
