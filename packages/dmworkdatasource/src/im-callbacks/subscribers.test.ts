import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Channel } from 'wukongimjssdk'
import { ChannelTypeCommunityTopic } from '@octo/base'
import { createSyncSubscribersCallback } from './subscribers'

const mockRuntime = vi.hoisted(() => ({
  parseThreadChannelId: vi.fn(),
}))

vi.mock('@octo/base', () => ({
  ChannelTypeCommunityTopic: 5,
  GroupRole: {
    owner: 1,
  },
  parseThreadChannelId: (...args: any[]) => mockRuntime.parseThreadChannelId(...args),
}))

vi.mock('wukongimjssdk', () => ({
  Channel: class {
    channelID: string
    channelType: number

    constructor(channelID: string, channelType: number) {
      this.channelID = channelID
      this.channelType = channelType
    }
  },
  ChannelInfo: class {},
  Subscriber: class {
    uid = ''
    name = ''
    remark = ''
    role = 0
    version = 0
    isDeleted = 0
    status = 0
    orgData: any
    avatar = ''
  },
}))

function createDeps() {
  return {
    getMembers: vi.fn(),
    avatarUser: vi.fn((uid: string) => `avatar/${uid}`),
    getPersonChannelInfo: vi.fn(),
    setChannelInfoForCache: vi.fn(),
  }
}

describe('createSyncSubscribersCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRuntime.parseThreadChannelId.mockReturnValue(null)
  })

  it('loads group members and maps subscriber fields', async () => {
    const deps = createDeps()
    deps.getMembers.mockResolvedValue([
      {
        uid: 'u1',
        name: 'User 1',
        remark: 'Remark 1',
        role: 0,
        version: 7,
        is_deleted: 0,
        status: 1,
      },
    ])

    const callback = createSyncSubscribersCallback(deps)
    const members = await callback(new Channel('g1', 2), 3)

    expect(deps.getMembers).toHaveBeenCalledWith('groups/g1/membersync?version=3&limit=10000')
    expect(deps.avatarUser).toHaveBeenCalledWith('u1')
    expect(members).toHaveLength(1)
    expect(members[0]).toMatchObject({
      uid: 'u1',
      name: 'User 1',
      remark: 'Remark 1',
      role: 0,
      version: 7,
      isDeleted: 0,
      status: 1,
      avatar: 'avatar/u1',
    })
    expect(members[0].orgData.bot_admin).toBe(0)
  })

  it('uses parent group id when syncing thread channel subscribers', async () => {
    const deps = createDeps()
    mockRuntime.parseThreadChannelId.mockReturnValue({ groupNo: 'parent-g1', shortId: 't1' })
    deps.getMembers.mockResolvedValue([])

    const callback = createSyncSubscribersCallback(deps)
    await callback(new Channel('parent-g1____t1', ChannelTypeCommunityTopic), 11)

    expect(deps.getMembers).toHaveBeenCalledWith(
      'groups/parent-g1/membersync?version=11&limit=10000',
    )
  })

  it('falls back to raw channel id when thread parsing fails', async () => {
    const deps = createDeps()
    mockRuntime.parseThreadChannelId.mockReturnValue(null)
    deps.getMembers.mockResolvedValue([])

    const callback = createSyncSubscribersCallback(deps)
    await callback(new Channel('bad-thread', ChannelTypeCommunityTopic), 2)

    expect(deps.getMembers).toHaveBeenCalledWith(
      'groups/bad-thread/membersync?version=2&limit=10000',
    )
  })

  it('sorts owner before higher numeric roles and normal members', async () => {
    const deps = createDeps()
    deps.getMembers.mockResolvedValue([
      { uid: 'normal', role: 0 },
      { uid: 'manager', role: 2 },
      { uid: 'owner', role: 1 },
    ])

    const callback = createSyncSubscribersCallback(deps)
    const members = await callback(new Channel('g1', 2), 0)

    expect(members.map((member) => member.uid)).toEqual(['owner', 'manager', 'normal'])
  })

  it('syncs robot flag into existing person channel info cache', async () => {
    const deps = createDeps()
    const existingInfo = { orgData: { displayName: 'Bot 1' } }
    deps.getMembers.mockResolvedValue([
      { uid: 'bot1', role: 0, robot: 1 },
      { uid: 'u1', role: 0, robot: 0 },
    ])
    deps.getPersonChannelInfo.mockImplementation((uid: string) =>
      uid === 'bot1' ? existingInfo as any : undefined,
    )

    const callback = createSyncSubscribersCallback(deps)
    await callback(new Channel('g1', 2), 0)

    expect(deps.getPersonChannelInfo).toHaveBeenCalledWith('bot1')
    expect(existingInfo.orgData.robot).toBe(1)
    expect(deps.setChannelInfoForCache).toHaveBeenCalledWith(existingInfo)
  })

  it('does not write robot cache when person channel info is missing', async () => {
    const deps = createDeps()
    deps.getMembers.mockResolvedValue([{ uid: 'bot1', role: 0, robot: 1 }])
    deps.getPersonChannelInfo.mockReturnValue(undefined)

    const callback = createSyncSubscribersCallback(deps)
    await callback(new Channel('g1', 2), 0)

    expect(deps.setChannelInfoForCache).not.toHaveBeenCalled()
  })
})
