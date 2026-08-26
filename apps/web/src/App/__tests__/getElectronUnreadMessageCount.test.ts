/**
 * Unit tests for getElectronUnreadMessageCount
 *
 * Tests the pure aggregation logic in isolation.  All SDK / app dependencies
 * are vi.mock'd so the suite runs without a real WKSDK connection or Electron.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Shared mock state ───────────────────────────────────────────────────────

const mockConversations: any[] = []
const mockGetChannelInfo = vi.fn()
const mockShouldSkipChannel = vi.fn(() => false)
const mockShouldSkipPerson = vi.fn(() => false)

let currentSpaceId: string | null = null

// ─── vi.mock declarations (hoisted by Vitest) ────────────────────────────────

vi.mock('wukongimjssdk', () => ({
  WKSDK: {
    shared: () => ({
      conversationManager: {
        get conversations() { return mockConversations },
      },
      channelManager: {
        getChannelInfo: (ch: any) => mockGetChannelInfo(ch),
      },
    }),
  },
  ChannelTypePerson: 1,
  ChannelTypeGroup: 2,
}))

vi.mock('@octo/base', () => ({
  ChannelTypeCommunityTopic: 5,
  ThreadStatus: { Active: 1, Archived: 2, Deleted: 3 },
  Channel: class {
    constructor(public channelID: string, public channelType: number) {}
  },
  parseThreadChannelId: (channelID: string) => {
    const parts = channelID.split('____')
    return parts.length === 2 ? { groupNo: parts[0], shortId: parts[1] } : null
  },
  isEffectivelyMuted: ({ isThread, channelInfo, parentChannelInfo }: any) => {
    if (!isThread) return Boolean(channelInfo?.mute)
    return Boolean(parentChannelInfo?.mute) || channelInfo?.orgData?.thread?.mute === 1
  },
  ConversationWrap: class {
    conversation: any
    constructor(conversation: any) {
      this.conversation = conversation
    }
    get unread() {
      if (
        currentSpaceId &&
        this.conversation.channel.channelType === 1 &&
        this.conversation.extra?.spaceUnread !== undefined
      ) {
        return this.conversation.extra.spaceUnread
      }
      const rawUnread = this.conversation.unread
      if (rawUnread === 0) return 0

      if (
        currentSpaceId &&
        this.conversation.channel.channelType === 1 &&
        this.conversation.channel.channelID === 'botfather' &&
        !this.conversation.lastMessage?.content?.contentObj?.space_id
      ) {
        return 0
      }

      const systemContentTypes = new Set([1002, 1003, 1005, 1008, 1009])
      if (rawUnread === 1 && systemContentTypes.has(this.conversation.lastMessage?.contentType)) {
        return 0
      }
      return rawUnread
    }
  },
  WKApp: {
    get shared() { return { currentSpaceId } },
  },
  shouldSkipChannelForSpace: (ch: any) => mockShouldSkipChannel(ch),
  shouldSkipPersonConversationForSpace: (conv: any) => mockShouldSkipPerson(conv),
}))

// ─── Import subject AFTER mocks ───────────────────────────────────────────────

const { getElectronUnreadMessageCount } = await import('../electronUnreadCount')

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockConversations.length = 0
  mockGetChannelInfo.mockReturnValue(undefined)
  mockShouldSkipChannel.mockReturnValue(false)
  mockShouldSkipPerson.mockReturnValue(false)
  currentSpaceId = null
})

describe('getElectronUnreadMessageCount', () => {

  it('returns 0 for an empty conversation list', () => {
    expect(getElectronUnreadMessageCount()).toBe(0)
  })

  it('sums effective unread messages across normal conversations', () => {
    mockConversations.push(
      { channel: { channelType: 0 }, unread: 3, extra: undefined },
      { channel: { channelType: 0 }, unread: 5, extra: undefined },
    )
    expect(getElectronUnreadMessageCount()).toBe(8)
  })

  it('excludes muted conversations', () => {
    const mutedCh = { channelType: 0 }
    mockGetChannelInfo.mockImplementation((ch: any) =>
      ch === mutedCh ? { mute: true } : undefined
    )
    mockConversations.push(
      { channel: mutedCh, unread: 10, extra: undefined },
      { channel: { channelType: 0 }, unread: 2, extra: undefined },
    )
    expect(getElectronUnreadMessageCount()).toBe(2)
  })

  it('excludes conversations where shouldSkipChannelForSpace returns true', () => {
    const skippedCh = { channelType: 0 }
    mockShouldSkipChannel.mockImplementation((ch: any) => ch === skippedCh)
    mockConversations.push(
      { channel: skippedCh, unread: 10, extra: undefined },
      { channel: { channelType: 0 }, unread: 4, extra: undefined },
    )
    expect(getElectronUnreadMessageCount()).toBe(4)
  })

  it('excludes conversations where shouldSkipPersonConversationForSpace returns true', () => {
    const skippedConv = { channel: { channelType: 1 }, unread: 7, extra: undefined }
    mockShouldSkipPerson.mockImplementation((c: any) => c === skippedConv)
    mockConversations.push(
      skippedConv,
      { channel: { channelType: 0 }, unread: 3, extra: undefined },
    )
    expect(getElectronUnreadMessageCount()).toBe(3)
  })

  it('uses extra.spaceUnread for Person channels when currentSpaceId is set', () => {
    currentSpaceId = 'space-1'
    mockConversations.push({
      channel: { channelType: 1 /* ChannelTypePerson */ },
      unread: 99,               // should be ignored
      extra: { spaceUnread: 5 },
    })
    expect(getElectronUnreadMessageCount()).toBe(5)
  })

  it('falls back to conversation.unread when extra.spaceUnread is undefined', () => {
    currentSpaceId = 'space-1'
    mockConversations.push({
      channel: { channelType: 1 },
      unread: 8,
      extra: {},                // spaceUnread key absent
    })
    expect(getElectronUnreadMessageCount()).toBe(8)
  })

  it('ignores NaN and Infinity unread values, counting them as 0', () => {
    mockConversations.push(
      { channel: { channelType: 0 }, unread: NaN, extra: undefined },
      { channel: { channelType: 0 }, unread: Infinity, extra: undefined },
      { channel: { channelType: 0 }, unread: 'bad' as any, extra: undefined },
      { channel: { channelType: 0 }, unread: 3, extra: undefined },
    )
    expect(getElectronUnreadMessageCount()).toBe(3)
  })

  it('clamps negative unread values to 0', () => {
    mockConversations.push({ channel: { channelType: 0 }, unread: -5, extra: undefined })
    expect(getElectronUnreadMessageCount()).toBe(0)
  })

  it('floors fractional unread values', () => {
    mockConversations.push({ channel: { channelType: 0 }, unread: 2.9, extra: undefined })
    expect(getElectronUnreadMessageCount()).toBe(2)
  })

  it('excludes archived and deleted threads', () => {
    const archivedThread = {
      channel: { channelID: 'group-1____thread-1', channelType: 5 },
      unread: 4,
    }
    const deletedThread = {
      channel: { channelID: 'group-1____thread-2', channelType: 5 },
      unread: 6,
    }
    mockGetChannelInfo.mockImplementation((channel: any) => {
      if (channel === archivedThread.channel) {
        return { orgData: { thread: { status: 2 } } }
      }
      if (channel === deletedThread.channel) {
        return { orgData: { thread: { status: 3 } } }
      }
      return undefined
    })
    mockConversations.push(archivedThread, deletedThread, {
      channel: { channelType: 0 },
      unread: 3,
    })

    expect(getElectronUnreadMessageCount()).toBe(3)
  })

  it('excludes a thread when its parent group is muted', () => {
    const threadChannel = { channelID: 'group-1____thread-1', channelType: 5 }
    mockGetChannelInfo.mockImplementation((channel: any) => {
      if (channel === threadChannel) return { orgData: { thread: { mute: 0 } } }
      if (channel.channelID === 'group-1' && channel.channelType === 2) {
        return { mute: 1 }
      }
      return undefined
    })
    mockConversations.push(
      { channel: threadChannel, unread: 8 },
      { channel: { channelType: 0 }, unread: 2 },
    )

    expect(getElectronUnreadMessageCount()).toBe(2)
  })

  it('excludes a thread with its own mute enabled', () => {
    const threadChannel = { channelID: 'group-1____thread-1', channelType: 5 }
    mockGetChannelInfo.mockImplementation((channel: any) => {
      if (channel === threadChannel) return { orgData: { thread: { mute: 1 } } }
      return undefined
    })
    mockConversations.push(
      { channel: threadChannel, unread: 8 },
      { channel: { channelType: 0 }, unread: 2 },
    )

    expect(getElectronUnreadMessageCount()).toBe(2)
  })

  it('excludes a system-message unread count of one', () => {
    mockConversations.push(
      {
        channel: { channelType: 0 },
        unread: 1,
        lastMessage: { contentType: 1002 },
      },
      { channel: { channelType: 0 }, unread: 2 },
    )

    expect(getElectronUnreadMessageCount()).toBe(2)
  })

  it('excludes BotFather unread without a Space id in Space mode', () => {
    currentSpaceId = 'space-1'
    mockConversations.push(
      {
        channel: { channelID: 'botfather', channelType: 1 },
        unread: 7,
      },
      {
        channel: { channelID: 'botfather', channelType: 1 },
        unread: 3,
        lastMessage: { content: { contentObj: { space_id: 'space-1' } } },
      },
    )

    expect(getElectronUnreadMessageCount()).toBe(3)
  })
})
