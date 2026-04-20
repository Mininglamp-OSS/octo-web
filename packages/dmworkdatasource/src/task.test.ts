import { describe, it, expect, vi, beforeEach } from 'vitest'
import axios from 'axios'

// vi.hoisted runs before vi.mock hoisting, so these are available in factories
const { TaskStatus, mockApiGet } = vi.hoisted(() => ({
  TaskStatus: {
    wait: 0,
    success: 1,
    processing: 2,
    fail: 3,
    suspend: 4,
    cancel: 5,
  } as const,
  mockApiGet: vi.fn(),
}))

vi.mock('wukongimjssdk', () => {
  class MockMessageTask {
    id = 'test-task'
    status = TaskStatus.wait
    message: any = {}
    update = vi.fn()
    addListener = vi.fn()
    removeListener = vi.fn()
  }
  return {
    MessageTask: MockMessageTask,
    TaskStatus,
    MediaMessageContent: class {},
  }
})

vi.mock('@octo/base', () => ({
  WKApp: {
    apiClient: {
      get: (...args: any[]) => mockApiGet(...args),
    },
  },
}))

vi.mock('axios', () => ({
  default: { put: vi.fn() },
}))

// --- Import under test (after mocks) ---
import { MediaMessageUploadTask } from './task'

// --- Helpers ---
function makeFile(name = 'photo.jpg', type = 'image/jpeg', size = 1024): File {
  const blob = new Blob([new ArrayBuffer(size)], { type })
  return new File([blob], name, { type })
}

function makeCredentials(overrides: Record<string, any> = {}) {
  return {
    uploadUrl: 'https://cos.example.com/upload',
    downloadUrl: 'https://cdn.example.com/file.jpg',
    contentType: 'image/jpeg',
    key: '/chat/photo.jpg',
    expiredTime: Date.now() + 600_000,
    ...overrides,
  }
}

function createTask(fileOrNull: File | null = makeFile(), remoteUrl = ''): MediaMessageUploadTask {
  const task = new MediaMessageUploadTask()
  task.message = {
    channel: { channelType: 1, channelID: 'ch001' },
    content: {
      file: fileOrNull ?? undefined,
      extension: '.jpg',
      remoteUrl,
    },
  } as any
  return task
}

// --- Tests ---
describe('MediaMessageUploadTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('start() — normal upload flow', () => {
    it('sets status=success when upload succeeds', async () => {
      const creds = makeCredentials()
      mockApiGet.mockResolvedValue(creds)
      vi.mocked(axios.put).mockResolvedValue({ status: 200, data: {} })

      const task = createTask()
      await task.start()

      expect(mockApiGet).toHaveBeenCalledOnce()
      expect(axios.put).toHaveBeenCalledOnce()
      expect(task.status).toBe(TaskStatus.success)
      expect((task.message.content as any).remoteUrl).toBe(creds.downloadUrl)
    })
  })

  describe('start() — getUploadCredentials returns undefined', () => {
    it('sets status=fail when credentials are missing uploadUrl', async () => {
      mockApiGet.mockResolvedValue({ uploadUrl: null })

      const task = createTask()
      await task.start()

      expect(task.status).toBe(TaskStatus.fail)
      expect(task.update).toHaveBeenCalled()
    })

    it('sets status=fail when credentials are missing downloadUrl', async () => {
      mockApiGet.mockResolvedValue({ uploadUrl: 'https://cos.example.com/upload', downloadUrl: undefined })

      const task = createTask()
      await task.start()

      expect(task.status).toBe(TaskStatus.fail)
    })
  })

  describe('start() — getUploadCredentials throws (critical fix)', () => {
    it('catches the error and sets status=fail', async () => {
      mockApiGet.mockRejectedValue(new Error('network error'))

      const task = createTask()
      await task.start()

      expect(task.status).toBe(TaskStatus.fail)
      expect(task.update).toHaveBeenCalled()
    })
  })

  describe('uploadFile — network error', () => {
    it('sets status=fail when axios.put rejects', async () => {
      const creds = makeCredentials()
      mockApiGet.mockResolvedValue(creds)
      vi.mocked(axios.put).mockRejectedValue(new Error('ECONNRESET'))

      const task = createTask()
      await task.start()

      expect(task.status).toBe(TaskStatus.fail)
    })
  })

  describe('uploadFile — non-2xx status code', () => {
    it('sets status=fail when response status is 403', async () => {
      const creds = makeCredentials()
      mockApiGet.mockResolvedValue(creds)
      vi.mocked(axios.put).mockResolvedValue({ status: 403, data: {} })

      const task = createTask()
      await task.start()

      expect(task.status).toBe(TaskStatus.fail)
    })
  })

  describe('cancel()', () => {
    it('aborts the controller and sets status=cancel', async () => {
      const creds = makeCredentials()
      mockApiGet.mockResolvedValue(creds)

      let abortSignal: AbortSignal | undefined
      vi.mocked(axios.put).mockImplementation((_url: any, _data: any, config: any) => {
        abortSignal = config?.signal
        return new Promise(() => {}) // hang forever
      })

      const task = createTask()
      const startPromise = task.start()

      // Wait for axios.put to be called
      await vi.waitFor(() => expect(axios.put).toHaveBeenCalled())

      task.cancel()
      expect(task.status).toBe(TaskStatus.cancel)
      expect(abortSignal?.aborted).toBe(true)
    })

    it('cancel status is not overwritten by catch handler', async () => {
      const creds = makeCredentials()
      mockApiGet.mockResolvedValue(creds)

      // Simulate abort rejection
      vi.mocked(axios.put).mockImplementation((_url: any, _data: any, config: any) => {
        return new Promise((_, reject) => {
          config?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
      })

      const task = createTask()
      const startPromise = task.start()

      await vi.waitFor(() => expect(axios.put).toHaveBeenCalled())

      task.cancel()
      // Let microtasks settle (catch handler runs)
      await new Promise(r => setTimeout(r, 10))

      // Status must remain 'cancel', NOT 'fail'
      expect(task.status).toBe(TaskStatus.cancel)
    })
  })

  describe('restart()', () => {
    it('re-fetches credentials and uploads again', async () => {
      const creds = makeCredentials()
      mockApiGet.mockResolvedValue(creds)
      vi.mocked(axios.put).mockResolvedValue({ status: 200, data: {} })

      const task = createTask()
      task.status = TaskStatus.fail

      await task.restart()

      expect(mockApiGet).toHaveBeenCalledOnce()
      expect(axios.put).toHaveBeenCalledOnce()
      expect(task.status).toBe(TaskStatus.success)
    })

    it('is a no-op when already processing', async () => {
      const task = createTask()
      task.status = TaskStatus.processing

      await task.restart()

      expect(mockApiGet).not.toHaveBeenCalled()
    })
  })

  describe('file.name empty fallback', () => {
    it('uses "file" when file.name is empty', async () => {
      mockApiGet.mockResolvedValue(makeCredentials())
      vi.mocked(axios.put).mockResolvedValue({ status: 200, data: {} })

      const file = makeFile('', 'application/octet-stream')
      const task = createTask(file)

      await task.start()

      const url: string = mockApiGet.mock.calls[0][0]
      expect(url).toContain('filename=file')
    })
  })

  describe('Content-Disposition header', () => {
    it('includes Content-Disposition when present in credentials', async () => {
      const creds = makeCredentials({ contentDisposition: 'attachment; filename="photo.jpg"' })
      mockApiGet.mockResolvedValue(creds)
      vi.mocked(axios.put).mockResolvedValue({ status: 200, data: {} })

      const task = createTask()
      await task.start()

      const putCall = vi.mocked(axios.put).mock.calls[0]
      const headers = putCall[2]?.headers as Record<string, string>
      expect(headers['Content-Disposition']).toBe('attachment; filename="photo.jpg"')
    })

    it('omits Content-Disposition when not in credentials', async () => {
      const creds = makeCredentials()
      delete (creds as any).contentDisposition
      mockApiGet.mockResolvedValue(creds)
      vi.mocked(axios.put).mockResolvedValue({ status: 200, data: {} })

      const task = createTask()
      await task.start()

      const putCall = vi.mocked(axios.put).mock.calls[0]
      const headers = putCall[2]?.headers as Record<string, string>
      expect(headers['Content-Disposition']).toBeUndefined()
    })
  })

  describe('start() — no file, existing remoteUrl', () => {
    it('sets status=success when remoteUrl already exists', async () => {
      const task = createTask(null, 'https://cdn.example.com/existing.jpg')
      await task.start()

      expect(task.status).toBe(TaskStatus.success)
      expect(mockApiGet).not.toHaveBeenCalled()
    })

    it('sets status=fail when no file and no remoteUrl', async () => {
      const task = createTask(null)
      await task.start()

      expect(task.status).toBe(TaskStatus.fail)
    })
  })

  describe('progress()', () => {
    it('returns 0 initially', () => {
      const task = createTask()
      expect(task.progress()).toBe(0)
    })
  })
})
