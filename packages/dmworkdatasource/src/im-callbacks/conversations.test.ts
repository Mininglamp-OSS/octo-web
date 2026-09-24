import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSyncConversationsCallback } from './conversations'
import { Channel, Conversation, WKSDK } from 'wukongimjssdk'

function createDeps() {
  return {
    postConversationSync: vi.fn(),
    getCurrentSpaceId: vi.fn(() => ''),
    captureContext: vi.fn(() => () => true),
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
      { msg_count: 1, recent_filter: true, include_space_unreads: true },
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
      { msg_count: 1, recent_filter: true, include_space_unreads: true },
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
    await expect(callback({})).rejects.toThrow('Conversation sync superseded')
    expect(deps.toConversation).not.toHaveBeenCalled()
    expect(deps.setChannelSpace).not.toHaveBeenCalled()
    expect(deps.setChannelMySourceSpace).not.toHaveBeenCalled()
    expect(deps.setChannelInfoForCache).not.toHaveBeenCalled()
  })

  it('rejects a no-Space request after entering a Space, even for an empty response', async () => {
    const deps = createDeps()
    deps.getCurrentSpaceId.mockReturnValueOnce('').mockReturnValue('space-b')
    deps.postConversationSync.mockResolvedValue(undefined)

    await expect(createSyncConversationsCallback(deps)({}))
      .rejects.toThrow('Conversation sync superseded')
    expect(deps.toConversation).not.toHaveBeenCalled()
  })

  it('does not convert or commit an earlier same-Space response after a newer request', async () => {
    const deps = createDeps()
    let resolveOld!: (value: unknown) => void
    deps.getCurrentSpaceId.mockReturnValue('space-a')
    deps.postConversationSync
      .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve }))
      .mockResolvedValueOnce({ conversations: [{ channel_id: 'new', channel_type: 2 }] })
    const sync = createSyncConversationsCallback(deps)
    const oldRequest = sync({})
    const oldRejected = expect(oldRequest).rejects.toThrow('Conversation sync superseded')
    await sync({})
    deps.toConversation.mockClear()
    deps.setChannelSpace.mockClear()
    deps.setChannelInfoForCache.mockClear()

    resolveOld({
      conversations: [{ channel_id: 'old', channel_type: 2, space_id: 'space-a' }],
      users: [{ uid: 'old-user' }],
      groups: [{ group_no: 'old-group' }],
    })
    await oldRejected
    expect(deps.toConversation).not.toHaveBeenCalled()
    expect(deps.setChannelSpace).not.toHaveBeenCalled()
    expect(deps.setChannelInfoForCache).not.toHaveBeenCalled()
  })

  it('rejects an invalidated context even when the Space string matches again', async () => {
    const deps = createDeps()
    deps.getCurrentSpaceId.mockReturnValue('space-a')
    let current = true
    deps.captureContext.mockReturnValue(() => current)
    deps.postConversationSync.mockImplementation(async () => {
      current = false
      return { conversations: [{ channel_id: 'old', channel_type: 2 }] }
    })

    await expect(createSyncConversationsCallback(deps)({}))
      .rejects.toThrow('Conversation sync superseded')
    expect(deps.toConversation).not.toHaveBeenCalled()
  })

  it('rejects a stopped owner before converting or writing any cache', async () => {
    const deps = createDeps()
    deps.postConversationSync.mockResolvedValue({
      conversations: [{ channel_id: 'stale', channel_type: 2, space_id: 'space-a' }],
      users: [{ uid: 'stale' }],
      groups: [{ group_no: 'stale' }],
    })
    await expect(createSyncConversationsCallback(deps)({ canCommit: () => false }))
      .rejects.toThrow('Conversation sync superseded')
    expect(deps.toConversation).not.toHaveBeenCalled()
    expect(deps.setChannelSpace).not.toHaveBeenCalled()
    expect(deps.setChannelMySourceSpace).not.toHaveBeenCalled()
    expect(deps.setChannelInfoForCache).not.toHaveBeenCalled()
    expect(deps.postConversationSync).toHaveBeenCalledWith(
      'conversation/sync', { msg_count: 1, recent_filter: true, include_space_unreads: true },
    )
  })

  it('prevents the real legacy SDK.sync from clearing a newer cache with a rejected response', async () => {
    const deps = createDeps()
    const sdk = WKSDK.shared()
    const originalCallback = sdk.config.provider.syncConversationsCallback
    const originalConversations = sdk.conversationManager.conversations
    const originalVersion = sdk.conversationManager.maxExtraVersion
    const reminders = vi.spyOn(sdk.reminderManager, 'sync').mockResolvedValue(undefined)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    let current = true
    let resolve!: (value: unknown) => void
    deps.captureContext.mockReturnValue(() => current)
    deps.postConversationSync.mockReturnValue(new Promise((res) => { resolve = res }))
    sdk.config.provider.syncConversationsCallback = createSyncConversationsCallback(deps)

    try {
      const stale = sdk.conversationManager.sync({})
      const rejected = expect(stale).rejects.toThrow('Conversation sync superseded')
      const newConversation = new Conversation()
      newConversation.channel = new Channel('new-space-group', 2)
      const newCache = [newConversation]
      sdk.conversationManager.conversations = newCache
      sdk.conversationManager.maxExtraVersion = 7
      current = false
      resolve({ conversations: [] })
      await rejected
      await Promise.resolve()

      expect(sdk.conversationManager.conversations).toBe(newCache)
      expect(sdk.conversationManager.maxExtraVersion).toBe(7)
      expect(reminders).not.toHaveBeenCalled()
      expect(deps.setChannelInfoForCache).not.toHaveBeenCalled()
    } finally {
      sdk.config.provider.syncConversationsCallback = originalCallback
      sdk.conversationManager.conversations = originalConversations
      sdk.conversationManager.maxExtraVersion = originalVersion
      reminders.mockRestore()
      log.mockRestore()
    }
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

  it('carries an empty Space unread snapshot without changing the array payload', async () => {
    const deps = createDeps()
    deps.postConversationSync.mockResolvedValue({ conversations: [], space_unreads: {} })

    const conversations = await createSyncConversationsCallback(deps)({})

    expect(conversations).toEqual([])
    expect(conversations.spaceUnreads).toEqual({})
    expect(Object.keys(conversations)).toEqual([])
  })

  it('leaves the Space unread snapshot undefined when the server omits it', async () => {
    const deps = createDeps()
    deps.postConversationSync.mockResolvedValue({ conversations: [] })

    const conversations = await createSyncConversationsCallback(deps)({})

    expect(conversations.spaceUnreads).toBeUndefined()
  })

  it('carries memberships as an isolated sideband without changing global SpaceFilter maps', async () => {
    const deps = createDeps()
    deps.postConversationSync.mockResolvedValue({
      conversations: [],
      space_memberships: [{
        channel_id: 'group-in-another-space',
        space_id: 'space-remote',
        my_source_space_id: 'space-local',
      }],
    })

    const conversations = await createSyncConversationsCallback(deps)({})

    expect(deps.setChannelSpace).not.toHaveBeenCalled()
    expect(deps.setChannelMySourceSpace).not.toHaveBeenCalled()
    expect(conversations.spaceMemberships).toEqual([{
      channel_id: 'group-in-another-space',
      space_id: 'space-remote',
      my_source_space_id: 'space-local',
    }])
    expect(Object.keys(conversations)).toEqual([])
  })

  it('carries an empty membership snapshot so consumers can clear stale attribution', async () => {
    const deps = createDeps()
    deps.postConversationSync.mockResolvedValue({
      conversations: [],
      space_memberships: [],
    })

    const conversations = await createSyncConversationsCallback(deps)({})

    expect(conversations.spaceMemberships).toEqual([])
    expect(Object.prototype.hasOwnProperty.call(conversations, 'spaceMemberships')).toBe(true)
    expect(Object.keys(conversations)).toEqual([])
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
