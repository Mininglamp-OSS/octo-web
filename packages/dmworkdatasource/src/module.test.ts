import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockApiPost, mockConvertToConversation, mockProvider, mockWKApp } = vi.hoisted(() => ({
  mockApiPost: vi.fn(),
  mockConvertToConversation: vi.fn((conversationMap: any) => ({ conversationMap })),
  mockProvider: {} as Record<string, any>,
  mockWKApp: {
    apiClient: {
      post: (...args: any[]) => mockApiPost(...args),
    },
    conversationProvider: null as any,
    dataSource: {} as Record<string, any>,
    shared: {
      currentSpaceId: '',
      channelSpaceMap: new Map<string, string>(),
      channelMySourceSpaceMap: new Map<string, string>(),
    },
  },
}))

vi.mock('@octo/base', () => ({
  ChannelTypeCommunityTopic: 5,
  Convert: {
    toConversation: (...args: any[]) => mockConvertToConversation(...args),
  },
  GroupRole: {},
  WKApp: mockWKApp,
  hasSpacePrefix: vi.fn(() => false),
  parseThreadChannelId: vi.fn(() => null),
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
  ChannelTypeGroup: 2,
  ChannelTypePerson: 1,
  Conversation: class {},
  ConversationExtra: class {},
  Message: class {},
  MessageTask: class {},
  Reminder: class {},
  Subscriber: class {},
  WKSDK: {
    shared: () => ({
      config: {
        provider: mockProvider,
      },
    }),
  },
}))

import DataSourceModule from './module'

describe('DataSourceModule conversation sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProvider.syncConversationsCallback = undefined
    mockWKApp.shared.currentSpaceId = ''
    mockWKApp.shared.channelSpaceMap = new Map()
    mockWKApp.shared.channelMySourceSpaceMap = new Map()
  })

  it('passes recent_filter=true when syncing recent conversations for a space', async () => {
    mockWKApp.shared.currentSpaceId = 'minglue_default'
    mockApiPost.mockResolvedValue({
      conversations: [
        {
          channel_id: 'user-1',
          channel_type: 1,
          space_id: 'minglue_default',
        },
      ],
    })

    new DataSourceModule().setSyncConversationsCallback()
    const conversations = await mockProvider.syncConversationsCallback({})

    expect(mockApiPost).toHaveBeenCalledWith(
      'conversation/sync?space_id=minglue_default',
      { msg_count: 1, recent_filter: true }
    )
    expect(mockConvertToConversation).toHaveBeenCalledWith({
      channel_id: 'user-1',
      channel_type: 1,
      space_id: 'minglue_default',
    })
    expect(conversations).toEqual([
      {
        conversationMap: {
          channel_id: 'user-1',
          channel_type: 1,
          space_id: 'minglue_default',
        },
      },
    ])
    expect(mockWKApp.shared.channelSpaceMap.get('user-1_1')).toBe('minglue_default')
  })
})
