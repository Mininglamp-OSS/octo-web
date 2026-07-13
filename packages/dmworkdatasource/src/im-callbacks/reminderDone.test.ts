import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createReminderDoneCallback } from './reminderDone'

function createDeps() {
  return {
    postReminderDone: vi.fn(),
  }
}

describe('createReminderDoneCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('posts reminder ids to reminder done endpoint', async () => {
    const deps = createDeps()
    const result = { ok: true }
    const ids = [1, 2, 3]
    deps.postReminderDone.mockResolvedValue(result)

    const callback = createReminderDoneCallback(deps)
    const response = await callback(ids)

    expect(deps.postReminderDone).toHaveBeenCalledWith('message/reminder/done', ids)
    expect(response).toBe(result)
  })
})
