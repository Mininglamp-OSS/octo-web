import { describe, it, expect, vi } from 'vitest'

vi.mock('wukongimjssdk', () => ({
  MediaMessageContent: class {
    file?: File
    remoteUrl?: string
  },
  WKSDK: {
    shared: () => ({
      taskManager: { addListener: vi.fn(), removeListener: vi.fn() },
    }),
  },
  Task: class {},
  TaskStatus: { wait: 0, success: 1, processing: 2, fail: 3, suspend: 4, cancel: 5 },
  MessageStatus: { Wait: 0, Normal: 1, Fail: 2 },
}))

vi.mock('react', async () => await vi.importActual('react'))
vi.mock('yet-another-react-lightbox', () => ({ default: () => null }))
vi.mock('yet-another-react-lightbox/plugins/download', () => ({ default: {} }))
vi.mock('yet-another-react-lightbox/styles.css', () => ({}))
vi.mock('@douyinfe/semi-ui', () => ({ Toast: { warning: vi.fn() } }))
vi.mock('../../../App', () => ({ default: {} }))
vi.mock('../../../Service/Const', () => ({ MessageContentTypeConst: { image: 3 } }))
vi.mock('../../Base', () => ({ default: () => null }))
vi.mock('../../MessageCell', () => ({
  MessageCell: class {},
}))

import { ImageContent, getImageTransferState } from '../index'
import { MessageStatus, TaskStatus } from 'wukongimjssdk'

describe('ImageContent name field', () => {
  it('sets name from file.name in constructor', () => {
    const file = new File([new ArrayBuffer(8)], 'screenshot.png', { type: 'image/png' })
    const content = new ImageContent(file, undefined, 100, 100)
    expect(content.name).toBe('screenshot.png')
  })

  it('leaves name undefined when no file is provided', () => {
    const content = new ImageContent()
    expect(content.name).toBeUndefined()
  })

  it('encodeJSON includes name when set', () => {
    const content = new ImageContent()
    content.name = 'photo.jpg'
    content.remoteUrl = 'https://cdn.example.com/photo.jpg'
    const json = content.encodeJSON()
    expect(json.name).toBe('photo.jpg')
  })

  it('encodeJSON omits name when not set', () => {
    const content = new ImageContent()
    content.remoteUrl = 'https://cdn.example.com/photo.jpg'
    const json = content.encodeJSON()
    expect(json).not.toHaveProperty('name')
  })

  it('decodeJSON reads name field', () => {
    const content = new ImageContent()
    content.decodeJSON({ width: 100, height: 100, url: 'https://cdn.example.com/photo.jpg', name: 'original.png' })
    expect(content.name).toBe('original.png')
  })

  it('decodeJSON without name field leaves it undefined', () => {
    const content = new ImageContent()
    content.decodeJSON({ width: 100, height: 100, url: 'https://cdn.example.com/photo.jpg' })
    expect(content.name).toBeUndefined()
  })
})

describe('getImageTransferState', () => {
  it('shows sending while message is waiting for ack', () => {
    expect(getImageTransferState({
      hasLocalFile: false,
      hasRemoteUrl: true,
      fileSize: 0,
      messageStatus: MessageStatus.Wait,
      uploadStatus: TaskStatus.success,
      uploadProgress: 100,
    })).toEqual({ status: 'sending' })
  })

  it('keeps local images pending until a remote URL exists', () => {
    expect(getImageTransferState({
      hasLocalFile: true,
      hasRemoteUrl: false,
      fileSize: 256 * 1024,
      messageStatus: MessageStatus.Normal,
      uploadStatus: null,
      uploadProgress: 0,
    })).toEqual({ status: 'sending' })
  })

  it('shows failed state with retry callback when upload fails', () => {
    const onUploadRetry = vi.fn()

    expect(getImageTransferState({
      hasLocalFile: true,
      hasRemoteUrl: false,
      fileSize: 2 * 1024 * 1024,
      messageStatus: MessageStatus.Wait,
      uploadStatus: TaskStatus.fail,
      uploadProgress: 17,
      onUploadRetry,
    })).toEqual({ status: 'failed', onRetry: onUploadRetry })
  })

  it('shows failed state when send ack fails after upload', () => {
    const onMessageRetry = vi.fn()

    expect(getImageTransferState({
      hasLocalFile: false,
      hasRemoteUrl: true,
      fileSize: 0,
      messageStatus: MessageStatus.Fail,
      uploadStatus: TaskStatus.success,
      uploadProgress: 100,
      onMessageRetry,
    })).toEqual({ status: 'failed', onRetry: onMessageRetry })
  })

  it('lets an active upload retry override a stale failed message status', () => {
    expect(getImageTransferState({
      hasLocalFile: true,
      hasRemoteUrl: false,
      fileSize: 2 * 1024 * 1024,
      messageStatus: MessageStatus.Fail,
      uploadStatus: TaskStatus.processing,
      uploadProgress: 31,
    })).toEqual({ status: 'uploading', progress: 31 })
  })

  it('uses sending state for small active uploads instead of hiding pending state', () => {
    expect(getImageTransferState({
      hasLocalFile: true,
      hasRemoteUrl: false,
      fileSize: 128 * 1024,
      messageStatus: MessageStatus.Wait,
      uploadStatus: TaskStatus.processing,
      uploadProgress: 42,
    })).toEqual({ status: 'sending' })
  })

  it('uses progress state for large active uploads', () => {
    expect(getImageTransferState({
      hasLocalFile: true,
      hasRemoteUrl: false,
      fileSize: 2 * 1024 * 1024,
      messageStatus: MessageStatus.Wait,
      uploadStatus: TaskStatus.processing,
      uploadProgress: 42.4,
    })).toEqual({ status: 'uploading', progress: 42 })
  })

  it('returns no transfer state after a normal remote image is available', () => {
    expect(getImageTransferState({
      hasLocalFile: false,
      hasRemoteUrl: true,
      fileSize: 0,
      messageStatus: MessageStatus.Normal,
      uploadStatus: TaskStatus.success,
      uploadProgress: 100,
    })).toBeUndefined()
  })
})
