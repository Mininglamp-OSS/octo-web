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
}))

vi.mock('@octo/base', () => ({
  WKApp: {
    get shared() { return { currentSpaceId } },
  },
  shouldSkipChannelForSpace: (ch: any) => mockShouldSkipChannel(ch),
  shouldSkipPersonConversationForSpace: (conv: any) => mockShouldSkipPerson(conv),
}))

// ─── Import subject AFTER mocks ───────────────────────────────────────────────

const { getElectronUnreadMessageCount } = await import('../electronUnreadCount')

// ─── Test helpers ─────────────────────────────────────────────────────────────

function conv(unread: any, opts: {
  mute?: boolean
  skipChannel?: boolean
  skipPerson?: boolean
  channelType?: number
  spaceUnread?: number
} = {}): any {
  const channel = { channelType: opts.channelType ?? 0 }

  mockGetChannelInfo.mockImplementation((ch: any) =>
    ch === channel ? (opts.mute !== undefined ? { mute: opts.mute } : undefined) : undefined
  )
  if (opts.skipChannel !== undefined) {
    mockShouldSkipChannel.mockImplementation((ch: any) =>
      ch === channel ? opts.skipChannel : false
    )
  }
  if (opts.skipPerson !== undefined) {
    mockShouldSkipPerson.mockImplementation((c: any) =>
      c.channel === channel ? opts.skipPerson : false
    )
  }

  return {
    channel,
    unread,
    extra: opts.spaceUnread !== undefined ? { spaceUnread: opts.spaceUnread } : undefined,
  }
}

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

  it('sums unread counts across normal conversations', () => {
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
})
