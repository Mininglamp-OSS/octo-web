// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'

const mocks = vi.hoisted(() => ({
  copyImageToClipboard: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  downloadFile: vi.fn(),
  currentSlide: { src: 'https://cdn.example.com/photo.png', filename: undefined as string | undefined },
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
vi.mock('../../../App', () => ({ default: { dataSource: { commonDataSource: { getImageURL: (url: string) => url } } } }))
vi.mock('../../../i18n', () => {
  const t = (key: string) => ({
    'base.filePreview.pdf.zoomOut': 'Zoom out',
    'base.filePreview.pdf.actualSize': 'Actual size',
    'base.filePreview.pdf.zoomIn': 'Zoom in',
    'base.message.imagePreview.rotate': 'Rotate',
    'base.module.contextMenus.copyImage': 'Copy image',
    'base.module.contextMenus.copyImageSuccess': 'Image copied',
  } as Record<string, string>)[key] || key
  return { t, useI18n: () => ({ t }) }
})
vi.mock('../../../Service/Const', () => ({ MessageContentTypeConst: { image: 3 } }))
vi.mock('../../../Utils/clipboard', () => ({ copyImageToClipboard: mocks.copyImageToClipboard }))
vi.mock('../../../Utils/download', () => ({ downloadFile: mocks.downloadFile }))
vi.mock('../../../bridge/message/useImageMessageUI', () => ({
  getImageMessageUI: () => ({
    isMulti: false,
    singleImage: { src: 'https://cdn.example.com/image.png', width: 100, height: 80 },
    row: {},
  }),
}))
vi.mock('../../Base', () => ({ default: () => null }))
vi.mock('../../MessageCell', () => ({
  MessageCell: class {},
}))

import { ImageCell, ImageContent, ImagePreviewLightbox, ImagePreviewToolbar, getImageTransferState } from '../index'
import { MessageStatus, TaskStatus } from 'wukongimjssdk'

describe('ImagePreviewToolbar', () => {
  it('downloads the currently visible slide with its own filename', () => {
    mocks.currentSlide.filename = 'visible-photo.jpg'
    const view = render(React.createElement(ImagePreviewToolbar, {
      zoom: { zoom: 1, minZoom: 0.25, maxZoom: 4 } as any,
      filename: 'opened-photo.png', onReset: vi.fn(), onRotate: vi.fn(),
    }))
    fireEvent.click(screen.getByRole('button', { name: 'base.filePreview.download' }))
    expect(mocks.downloadFile).toHaveBeenLastCalledWith(mocks.currentSlide.src, 'visible-photo.jpg')
    mocks.currentSlide.filename = undefined
    view.rerender(React.createElement(ImagePreviewToolbar, {
      zoom: { zoom: 1, minZoom: 0.25, maxZoom: 4 } as any,
      filename: 'standalone.png', onReset: vi.fn(), onRotate: vi.fn(),
    }))
    fireEvent.click(screen.getByRole('button', { name: 'base.filePreview.download' }))
    expect(mocks.downloadFile).toHaveBeenLastCalledWith(mocks.currentSlide.src, 'standalone.png')
  })
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
  it('uses slide count for navigation and resets rotation while reporting a changed image', () => {
    const onView = vi.fn()
    const view = render(React.createElement(ImagePreviewLightbox, {
      open: true, close: vi.fn(), isMulti: false, onView,
      slides: [{ src: 'a.png' }, { src: 'b.png' }],
    }))
    expect(mocks.lightboxProps.render.buttonPrev).toBeUndefined()
    expect(mocks.lightboxProps.render.buttonNext).toBeUndefined()
    expect(mocks.lightboxProps.carousel.finite).toBe(true)
    act(() => mocks.lightboxProps.render.buttonZoom({}).props.onRotate())
    act(() => mocks.lightboxProps.on.view({ index: 1 }))
    expect(onView).toHaveBeenCalledWith(1)
    expect(mocks.lightboxProps.carousel.imageProps.style.maxWidth).toBe('100%')
    view.rerender(React.createElement(ImagePreviewLightbox, {
      open: true, close: vi.fn(), isMulti: true, slides: [{ src: 'a.png' }],
    }))
    expect(mocks.lightboxProps.render.buttonPrev()).toBeNull()
    expect(mocks.lightboxProps.render.buttonNext()).toBeNull()
  })
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
  it('preserves group image URLs, ordering, dimensions, and names across decode/encode', () => {
    const content = new ImageContent()
    const images = [
      { url: 'one.png', width: 640, height: 480, name: 'one.png' },
      { url: 'two.jpg', width: 320, height: 240, name: 'two.jpg' },
    ]
    content.decodeJSON({ images })
    expect(content.images).toEqual(images)
    expect(content.encodeJSON().images).toEqual(images)
    content.decodeJSON({ url: 'single.png' })
    expect(content.images).toBeUndefined()
    expect(content.encodeJSON()).not.toHaveProperty('images')
  })
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

describe('ImageCell geometry', () => {
  it('delegates a click to the enclosing gallery and does not mount a second preview', () => {
    const message: any = {
      clientMsgNo: 'image-1', messageID: 'server-1', status: MessageStatus.Normal,
      fromUID: 'u1', message: {}, content: { url: 'photo.png' },
    }
    const context: any = { editOn: () => false, isContextMenuOpen: () => false }
    const cell: any = new ImageCell({ message, context })
    cell.props = { message, context }
    const openImage = vi.fn(() => true)
    cell.context = { openImage }
    const tree: any = cell.render()
    tree.props.children[0].props.children.props.onClick()
    expect(openImage).toHaveBeenCalledWith(JSON.stringify(['image-1', 0]))
    expect(tree.props.children[1]).toBe(false)
    expect(cell.state.showPreview).toBe(false)

    cell.props.context.editOn = () => true
    expect(cell.render().props.children[0].props.children.props.onClick).toBeUndefined()
    cell.props.context.editOn = () => false
    cell.state.uploadStatus = TaskStatus.fail
    expect(cell.render().props.children[0].props.children.props.onClick).toBeUndefined()
  })

  it('scales landscape, portrait and square images only when over bounds', () => {
    const cell: any = new ImageCell({})
    expect(cell.imageScale(100, 50)).toEqual({ width: 100, height: 50 })
    expect(cell.imageScale(1320, 660)).toEqual({ width: 660, height: 330 })
    expect(cell.imageScale(660, 744)).toEqual({ width: 330, height: 372 })
    expect(cell.imageScale(1000, 1000)).toEqual({ width: 660, height: 660 })
  })

  it('renders a remote image row and opens the preview through the image callback', () => {
    const message: any = {
      clientMsgNo: 'image-1', messageID: 'server-1', status: MessageStatus.Normal,
      checked: false, fromUID: 'u1', message: {},
      content: { url: 'https://cdn.example.com/image.png', width: 100, height: 80, name: 'image.png' },
    }
    const context: any = {
      editOn: () => false, showContextMenus: vi.fn(), isContextMenuOpen: () => false,
      checkeMessage: vi.fn(), onTapAvatar: vi.fn(), showUser: vi.fn(), resendMessage: vi.fn(),
    }
    const cell: any = new ImageCell({ message, context })
    cell.props = { message, context }
    const tree: any = cell.render()
    expect(tree).toBeTruthy()
    expect(cell.getImageSrc(message.content)).toBeTruthy()
  })
})
