import { describe, expect, it } from 'vitest'
import { IMAGE_FILE_ACCEPT, imageMime, isUploadableImage } from './imageUpload.ts'

describe('SVG image upload input', () => {
  it('accepts the standard SVG MIME and explicitly exposes .svg in the picker', () => {
    const file = new File(['<svg/>'], 'diagram.svg', { type: 'image/svg+xml' })
    expect(imageMime(file)).toBe('image/svg+xml')
    expect(isUploadableImage(file)).toBe(true)
    expect(IMAGE_FILE_ACCEPT.split(',')).toContain('image/svg+xml')
    expect(IMAGE_FILE_ACCEPT.split(',')).toContain('.svg')
  })

  it('recognizes an SVG extension only when the browser leaves File.type empty', () => {
    expect(imageMime(new File(['<svg/>'], 'diagram.SVG', { type: '' }))).toBe('image/svg+xml')
    expect(imageMime(new File(['x'], 'misleading.svg', { type: 'text/plain' }))).toBe('text/plain')
  })

  it('retains the non-empty and 10 MB size guards for SVG', () => {
    expect(isUploadableImage(new File([], 'empty.svg', { type: 'image/svg+xml' }))).toBe(false)
    const tooLarge = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.svg', { type: 'image/svg+xml' })
    expect(isUploadableImage(tooLarge)).toBe(false)
  })
})
