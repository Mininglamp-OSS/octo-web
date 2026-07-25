// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

const mocks = vi.hoisted(() => ({
  copyImageToClipboard: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  currentSlide: { src: 'https://cdn.example.com/photo.png' },
  lightboxProps: undefined as any,
}))

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
vi.mock('yet-another-react-lightbox', () => ({
  default: (props: any) => {
    mocks.lightboxProps = props
    return null
  },
  isImageSlide: (slide: unknown) => !!slide,
  useLightboxState: () => ({ currentSlide: mocks.currentSlide }),
}))
vi.mock('yet-another-react-lightbox/plugins/zoom', () => ({ default: {} }))
vi.mock('yet-another-react-lightbox/styles.css', () => ({}))
vi.mock('@douyinfe/semi-ui', () => ({ Toast: { success: mocks.toastSuccess, warning: mocks.toastWarning } }))
vi.mock('../../../App', () => ({ default: {} }))
vi.mock('../../../i18n', () => ({
  t: (key: string) => ({
    'base.filePreview.pdf.zoomOut': 'Zoom out',
    'base.filePreview.pdf.actualSize': 'Actual size',
    'base.filePreview.pdf.zoomIn': 'Zoom in',
    'base.message.imagePreview.rotate': 'Rotate',
    'base.module.contextMenus.copyImage': 'Copy image',
    'base.module.contextMenus.copyImageSuccess': 'Image copied',
  } as Record<string, string>)[key] || key,
}))
vi.mock('../../../Service/Const', () => ({ MessageContentTypeConst: { image: 3 } }))
vi.mock('../../../Utils/clipboard', () => ({ copyImageToClipboard: mocks.copyImageToClipboard }))
vi.mock('../../Base', () => ({ default: () => null }))
vi.mock('../../MessageCell', () => ({
  MessageCell: class {},
}))

import { ImageContent, ImagePreviewLightbox, ImagePreviewToolbar, getImageTransferState } from '../index'
import { MessageStatus, TaskStatus } from 'wukongimjssdk'

describe('ImagePreviewToolbar', () => {
  it('provides the v2 preview actions and copies the visible image', async () => {
    const zoomOut = vi.fn()
    const zoomIn = vi.fn()
    const changeZoom = vi.fn()
    const onReset = vi.fn()
    const onRotate = vi.fn()
    mocks.copyImageToClipboard.mockResolvedValueOnce(undefined)
    render(React.createElement(ImagePreviewToolbar, {
      zoom: {
        zoom: 1,
        minZoom: 0.25,
        maxZoom: 4,
        offsetX: 0,
        offsetY: 0,
        disabled: false,
        zoomIn,
        zoomOut,
        changeZoom,
      },
      onReset,
      onRotate,
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    fireEvent.click(screen.getByRole('button', { name: 'Actual size' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rotate' }))

    fireEvent.click(screen.getByRole('button', { name: 'Copy image' }))

    await waitFor(() => {
      expect(zoomOut).toHaveBeenCalled()
      expect(zoomIn).toHaveBeenCalled()
      expect(changeZoom).toHaveBeenCalledWith(1)
      expect(onReset).toHaveBeenCalled()
      expect(onRotate).toHaveBeenCalled()
      expect(mocks.copyImageToClipboard).toHaveBeenCalledWith(mocks.currentSlide.src)
      expect(mocks.toastSuccess).toHaveBeenCalled()
    })
  })
})

describe('ImagePreviewLightbox', () => {
  it('swaps image fit bounds for quarter-turn rotations', () => {
    render(React.createElement(ImagePreviewLightbox, {
      open: true,
      close: vi.fn(),
      slides: [{ src: 'https://cdn.example.com/landscape.png' }],
    }))

    expect(mocks.lightboxProps.carousel.imageProps.style).toEqual({
      maxWidth: '100%',
      maxHeight: '100%',
    })

    act(() => mocks.lightboxProps.render.buttonZoom({}).props.onRotate())

    expect(mocks.lightboxProps.carousel.imageProps.style).toEqual({
      maxWidth: '100cqh',
      maxHeight: '100cqw',
    })

    act(() => mocks.lightboxProps.render.buttonZoom({}).props.onRotate())

    expect(mocks.lightboxProps.carousel.imageProps.style).toEqual({
      maxWidth: '100%',
      maxHeight: '100%',
    })
  })
})

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
