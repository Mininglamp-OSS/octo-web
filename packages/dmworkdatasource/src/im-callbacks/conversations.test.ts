import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSyncConversationsCallback } from './conversations'

function createDeps() {
  return {
    postConversationSync: vi.fn(),
    getCurrentSpaceId: vi.fn(() => ''),
    setChannelSpace: vi.fn(),
    setChannelMySourceSpace: vi.fn(),
    toConversation: vi.fn((conversationMap: any) => ({ conversationMap }) as any),
    toUserChannelInfo: vi.fn((user: any) => ({ user }) as any),
    toGroupChannelInfo: vi.fn((group: any) => ({ group }) as any),
    setChannelInfoForCache: vi.fn(),
  }
}

describe('createSyncConversationsCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('posts to the space-aware sync endpoint and returns converted conversations', async () => {
    const deps = createDeps()
    deps.getCurrentSpaceId.mockReturnValue('space/default')
    deps.postConversationSync.mockResolvedValue({
      conversations: [
        {
          channel_id: 'u1',
          channel_type: 1,
          space_id: 'space/default',
        },
      ],
    })

    const callback = createSyncConversationsCallback(deps)
    const conversations = await callback({})

    expect(deps.postConversationSync).toHaveBeenCalledWith(
      'conversation/sync?space_id=space%2Fdefault',
      { msg_count: 1, recent_filter: true },
    )
    expect(deps.toConversation).toHaveBeenCalledWith({
      channel_id: 'u1',
      channel_type: 1,
      space_id: 'space/default',
    })
    expect(conversations).toEqual([
      {
        conversationMap: {
          channel_id: 'u1',
          channel_type: 1,
          space_id: 'space/default',
        },
      },
    ])
  })

  it('posts to the default sync endpoint when there is no current space', async () => {
    const deps = createDeps()
    deps.postConversationSync.mockResolvedValue({
      conversations: [],
    })

    const callback = createSyncConversationsCallback(deps)
    await callback({})

    expect(deps.postConversationSync).toHaveBeenCalledWith(
      'conversation/sync',
      { msg_count: 1, recent_filter: true },
    )
  })

  it('drops stale responses when current space changes after the request', async () => {
    const deps = createDeps()
    deps.getCurrentSpaceId
      .mockReturnValueOnce('space-a')
      .mockReturnValueOnce('space-b')
    deps.postConversationSync.mockResolvedValue({
      conversations: [
        {
          channel_id: 'u1',
          channel_type: 1,
          space_id: 'space-a',
          my_source_space_id: 'source-a',
        },
      ],
      users: [{ uid: 'u1' }],
      groups: [{ group_no: 'g1' }],
    })

    const callback = createSyncConversationsCallback(deps)
    const conversations = await callback({})

    expect(conversations).toEqual([])
    expect(deps.toConversation).not.toHaveBeenCalled()
    expect(deps.setChannelSpace).not.toHaveBeenCalled()
    expect(deps.setChannelMySourceSpace).not.toHaveBeenCalled()
    expect(deps.setChannelInfoForCache).not.toHaveBeenCalled()
  })

  it('stores channel space mappings from each synced conversation', async () => {
    const deps = createDeps()
    deps.postConversationSync.mockResolvedValue({
      conversations: [
        {
          channel_id: 'g1',
          channel_type: 2,
          space_id: 'space-a',
          my_source_space_id: 'source-a',
        },
        {
          channel_id: 'u1',
          channel_type: 1,
        },
      ],
    })

    const callback = createSyncConversationsCallback(deps)
    await callback({})

    expect(deps.setChannelSpace).toHaveBeenCalledWith('g1_2', 'space-a')
    expect(deps.setChannelMySourceSpace).toHaveBeenCalledWith('g1_2', 'source-a')
    expect(deps.setChannelSpace).toHaveBeenCalledTimes(1)
    expect(deps.setChannelMySourceSpace).toHaveBeenCalledTimes(1)
  })

  it('preheats user and group channel info cache from the sync response', async () => {
    const deps = createDeps()
    const user = { uid: 'u1' }
    const group = { group_no: 'g1' }
    deps.postConversationSync.mockResolvedValue({
      conversations: [],
      users: [user],
      groups: [group],
    })

    const callback = createSyncConversationsCallback(deps)
    await callback({})

    expect(deps.toUserChannelInfo).toHaveBeenCalledWith(user)
    expect(deps.toGroupChannelInfo).toHaveBeenCalledWith(group)
    expect(deps.setChannelInfoForCache).toHaveBeenCalledWith({ user })
    expect(deps.setChannelInfoForCache).toHaveBeenCalledWith({ group })
  })
})
