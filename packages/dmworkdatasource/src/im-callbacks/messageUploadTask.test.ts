import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMessageUploadTaskCallback } from './messageUploadTask'

vi.mock('wukongimjssdk', () => ({
  Message: class {},
  MessageTask: class {},
}))

function createDeps() {
  return {
    createMessageUploadTask: vi.fn((message: any) => ({ message }) as any),
  }
}

describe('createMessageUploadTaskCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a message upload task for the message', () => {
    const deps = createDeps()
    const message = { clientSeq: 1 } as any

    const callback = createMessageUploadTaskCallback(deps)
    const task = callback(message)

    expect(deps.createMessageUploadTask).toHaveBeenCalledWith(message)
    expect(task).toEqual({ message })
  })
})
