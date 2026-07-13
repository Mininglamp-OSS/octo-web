import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSyncRemindersCallback } from './reminders'

vi.mock('@octo/base', () => ({
  ChannelTypeCommunityTopic: 5,
}))

vi.mock('wukongimjssdk', () => ({
  ChannelTypeGroup: 2,
  Conversation: class {},
  Reminder: class {},
}))

function createDeps() {
  return {
    getConversations: vi.fn(),
    postReminderSync: vi.fn(),
    toReminder: vi.fn((reminderMap: any) => ({ reminderMap }) as any),
  }
}

function conversation(channelID: string, channelType: number) {
  return {
    channel: {
      channelID,
      channelType,
    },
  } as any
}

describe('createSyncRemindersCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('posts version, limit, and group-like channel ids to reminder sync endpoint', async () => {
    const deps = createDeps()
    deps.getConversations.mockReturnValue([
      conversation('u1', 1),
      conversation('g1', 2),
      conversation('thread1', 5),
    ])
    deps.postReminderSync.mockResolvedValue([])

    const callback = createSyncRemindersCallback(deps)
    await callback(9)

    expect(deps.postReminderSync).toHaveBeenCalledWith(
      'message/reminder/sync',
      {
        version: 9,
        limit: 100,
        channel_ids: ['g1', 'thread1'],
      },
    )
  })

  it('posts an empty channel id list when conversations are missing', async () => {
    const deps = createDeps()
    deps.getConversations.mockReturnValue(undefined)
    deps.postReminderSync.mockResolvedValue([])

    const callback = createSyncRemindersCallback(deps)
    await callback(1)

    expect(deps.postReminderSync).toHaveBeenCalledWith(
      'message/reminder/sync',
      {
        version: 1,
        limit: 100,
        channel_ids: [],
      },
    )
  })

  it('converts each reminder sync result', async () => {
    const deps = createDeps()
    const first = { reminder_id: 1 }
    const second = { reminder_id: 2 }
    deps.getConversations.mockReturnValue([])
    deps.postReminderSync.mockResolvedValue([first, second])

    const callback = createSyncRemindersCallback(deps)
    const reminders = await callback(0)

    expect(deps.toReminder).toHaveBeenCalledWith(first)
    expect(deps.toReminder).toHaveBeenCalledWith(second)
    expect(reminders).toEqual([
      { reminderMap: first },
      { reminderMap: second },
    ])
  })

  it('returns an empty list when sync response is empty', async () => {
    const deps = createDeps()
    deps.getConversations.mockReturnValue([])
    deps.postReminderSync.mockResolvedValue(null)

    const callback = createSyncRemindersCallback(deps)
    const reminders = await callback(0)

    expect(reminders).toEqual([])
    expect(deps.toReminder).not.toHaveBeenCalled()
  })
})
