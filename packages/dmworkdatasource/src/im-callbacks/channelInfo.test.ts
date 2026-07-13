import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Channel, ChannelTypeGroup, ChannelTypePerson } from 'wukongimjssdk'
import { ChannelTypeCommunityTopic } from '@octo/base'
import { createChannelInfoCallback } from './channelInfo'

const mockRuntime = vi.hoisted(() => ({
  parseThreadChannelId: vi.fn(),
}))

vi.mock('@octo/base', () => ({
  ChannelTypeCommunityTopic: 5,
  parseThreadChannelId: (...args: any[]) => mockRuntime.parseThreadChannelId(...args),
}))

function createDeps() {
  return {
    getChannel: vi.fn(),
    threadGet: vi.fn(),
    extractUID: vi.fn((channelID: string) =>
      channelID.startsWith('s_space_') ? channelID.slice('s_space_'.length) : channelID,
    ),
    getSubscribeCacheMap: vi.fn(() => new Map()),
    warn: vi.fn(),
  }
}

describe('createChannelInfoCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRuntime.parseThreadChannelId.mockReturnValue(null)
  })

  it('maps a person channel response and keeps the avatar fallback', async () => {
    const deps = createDeps()
    deps.getChannel.mockResolvedValue({
      channel: { channel_id: 'u1', channel_type: ChannelTypePerson },
      name: 'User 1',
      mute: 1,
      stick: 1,
      online: 1,
      last_offline: 123,
      logo: '',
      remark: 'Remark 1',
      receipt: 1,
      extra: { short_no: '1001' },
      status: 1,
      follow: 1,
      category: 'normal',
      be_deleted: 0,
      be_blacklist: 0,
      notice: '',
    })

    const callback = createChannelInfoCallback(deps)
    const info = await callback(new Channel('s_space_u1', ChannelTypePerson))

    expect(deps.extractUID).toHaveBeenCalledWith('s_space_u1')
    expect(deps.getChannel).toHaveBeenCalledWith('channels/u1/1')
    expect(info.channel.channelID).toBe('u1')
    expect(info.channel.channelType).toBe(ChannelTypePerson)
    expect(info.title).toBe('User 1')
    expect(info.mute).toBe(true)
    expect(info.top).toBe(true)
    expect(info.online).toBe(true)
    expect(info.lastOffline).toBe(123)
    expect(info.logo).toBe('users/u1/avatar')
    expect(info.orgData.remark).toBe('Remark 1')
    expect(info.orgData.displayName).toBe('Remark 1')
    expect(info.orgData.shortNo).toBe('1001')
  })

  it('falls back robot identity from subscriber cache for person channels', async () => {
    const deps = createDeps()
    deps.getChannel.mockResolvedValue({
      channel: { channel_id: 'bot1', channel_type: ChannelTypePerson },
      name: 'Bot 1',
      logo: '',
      extra: {},
    })
    deps.getSubscribeCacheMap.mockReturnValue(
      new Map([
        [
          'g1_2',
          [
            {
              uid: 'bot1',
              orgData: { robot: 1 },
            },
          ] as any[],
        ],
      ]),
    )

    const callback = createChannelInfoCallback(deps)
    const info = await callback(new Channel('bot1', ChannelTypePerson))

    expect(info.orgData.robot).toBe(1)
  })

  it('maps group-specific fields and defaults allow_no_mention', async () => {
    const deps = createDeps()
    deps.getChannel.mockResolvedValue({
      channel: { channel_id: 'g1', channel_type: ChannelTypeGroup },
      name: 'Group 1',
      logo: '',
      extra: { forbidden_add_friend: 1 },
      forbidden: 0,
      invite: 1,
      save: 1,
      has_group_md: 1,
      group_md_version: 3,
      group_md_updated_at: '2026-07-13',
      can_edit_group_md: 1,
      can_manage_bot_admin: 1,
    })

    const callback = createChannelInfoCallback(deps)
    const info = await callback(new Channel('g1', ChannelTypeGroup))

    expect(info.logo).toBe('groups/g1/avatar')
    expect(info.orgData.forbiddenAddFriend).toBe(1)
    expect(info.orgData.allow_no_mention).toBe(1)
    expect(info.orgData.has_group_md).toBe(true)
    expect(info.orgData.group_md_version).toBe(3)
    expect(info.orgData.group_md_updated_at).toBe('2026-07-13')
    expect(info.orgData.can_edit_group_md).toBe(true)
    expect(info.orgData.can_manage_bot_admin).toBe(true)
  })

  it('returns an empty title when channel info fetch fails', async () => {
    const deps = createDeps()
    deps.getChannel.mockRejectedValue(new Error('not found'))

    const callback = createChannelInfoCallback(deps)
    const info = await callback(new Channel('missing', ChannelTypePerson))

    expect(info.channel.channelID).toBe('missing')
    expect(info.title).toBe('')
    expect(info.orgData).toEqual({})
    expect(deps.warn).toHaveBeenCalledWith('channel info not found: missing/1')
  })

  it('maps thread channel info through threadGet', async () => {
    const deps = createDeps()
    mockRuntime.parseThreadChannelId.mockReturnValue({ groupNo: 'g1', shortId: 't1' })
    deps.threadGet.mockResolvedValue({
      name: 'Thread 1',
      mute: 1,
      has_thread_md: true,
      thread_md_version: 2,
      thread_md_updated_at: '2026-07-13',
    })

    const callback = createChannelInfoCallback(deps)
    const info = await callback(new Channel('g1____t1', ChannelTypeCommunityTopic))

    expect(deps.threadGet).toHaveBeenCalledWith('g1', 't1')
    expect(info.title).toBe('Thread 1')
    expect(info.logo).toBe('groups/g1/avatar')
    expect(info.mute).toBe(true)
    expect(info.orgData.displayName).toBe('Thread 1')
    expect(info.orgData.parentGroupNo).toBe('g1')
    expect(info.orgData.has_thread_md).toBe(true)
    expect(info.orgData.thread_md_version).toBe(2)
  })

  it('falls back to the raw channel id when thread parsing fails', async () => {
    const deps = createDeps()
    mockRuntime.parseThreadChannelId.mockReturnValue(null)

    const callback = createChannelInfoCallback(deps)
    const info = await callback(new Channel('bad-thread', ChannelTypeCommunityTopic))

    expect(deps.threadGet).not.toHaveBeenCalled()
    expect(info.channel.channelID).toBe('bad-thread')
    expect(info.title).toBe('bad-thread')
    expect(info.orgData).toEqual({})
  })

  it('falls back to the raw channel id when thread fetch fails', async () => {
    const deps = createDeps()
    mockRuntime.parseThreadChannelId.mockReturnValue({ groupNo: 'g1', shortId: 't1' })
    deps.threadGet.mockRejectedValue(new Error('not found'))

    const callback = createChannelInfoCallback(deps)
    const info = await callback(new Channel('g1____t1', ChannelTypeCommunityTopic))

    expect(info.title).toBe('g1____t1')
    expect(info.orgData).toEqual({})
    expect(deps.warn).toHaveBeenCalledWith('thread info not found: g1____t1')
  })
})
