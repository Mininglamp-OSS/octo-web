import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MediaMessageContent } from 'wukongimjssdk'
import { ImageContent } from '../../../Messages/Image/ImageContent'
import MultiImage from '../../../ui/message/ImageContent/MultiImage'
import { getImageMessageImages } from '../imageMessageImages'
import { getImageMessageUI } from '../useImageMessageUI'

vi.mock('../../../App', () => ({
  default: { dataSource: { commonDataSource: { getImageURL: (url: string) => url } } },
}))
vi.mock('../useMessageRow', () => ({ getMessageRow: () => ({}) }))

describe('image payload compatibility through the real decoder and UI bridge', () => {
  beforeEach(() => vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  }))
  afterEach(() => vi.unstubAllGlobals())

  it('keeps numeric-string group dimensions visible after decoding and forwarding', () => {
    const content = new ImageContent()
    content.decodeJSON({ images: [
      { url: 'one.png', width: '320', height: '200', name: 'one.png' },
      { url: 'two.png', width: 640, height: 400, name: 'two.png' },
    ] })
    const forwarded = new ImageContent()
    forwarded.decode(content.encode())
    const ui = getImageMessageUI({ content: forwarded } as any)
    const view = render(<MultiImage images={ui.images} />)
    const images = view.container.querySelectorAll('img')
    expect(images[0]).toHaveAttribute('width', '320')
    expect(images[0]).toHaveAttribute('height', '200')
    expect(images[0].parentElement).toHaveStyle({ width: '320px', height: '200px' })
    expect(images[1]).toHaveAttribute('width', '595')
    expect(images[1]).toHaveAttribute('height', '372')
  })

  it('preserves local file/preview and single-image wire payload after upload', () => {
    const file = new File(['png'], 'photo.png', { type: 'image/png' })
    const local = 'data:image/png;base64,cG5n'
    const content = new ImageContent(file, local, 320, 200)
    expect(content).toBeInstanceOf(MediaMessageContent)
    expect(getImageMessageUI({ content } as any).singleImage).toEqual({
      src: local, width: 320, height: 200,
    })
    expect(getImageMessageImages(content)[0].url).toBe('')
    content.url = content.remoteUrl = 'https://cdn.example/photo.png'
    const wire = JSON.parse(new TextDecoder().decode(content.encode()))
    expect(wire).toMatchObject({ type: 2, url: content.remoteUrl, width: 320, height: 200, name: 'photo.png' })
    for (const key of ['file', 'imgData', 'images']) expect(wire).not.toHaveProperty(key)
    const received = new ImageContent()
    received.decode(content.encode())
    expect(getImageMessageUI({ content: received } as any).singleImage).toEqual({
      src: content.remoteUrl, width: 320, height: 200,
    })
    expect(content.file).toBe(file)
    expect(content.imgData).toBe(local)
  })

  it('does not invent valid dimensions from malformed attachment metadata', () => {
    const content = new ImageContent()
    content.decodeJSON({ images: [
      { url: 'a.png', width: '320px', height: true },
      { url: 'b.png', width: -1, height: Infinity },
      { url: 'c.png', width: null, height: ' ' },
    ] })
    expect(content.images?.map(({ width, height }) => [width, height])).toEqual([[0, 0], [0, 0], [0, 0]])
  })
})
