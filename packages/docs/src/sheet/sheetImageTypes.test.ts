import { describe, expect, it } from 'vitest'
import { enableSheetSvgImages } from './sheetImageTypes.ts'

describe('sheet SVG image gate', () => {
  it('adds the MIME used by both Univer picker accept and ImageIoService validation', () => {
    const allowed = ['image/png', 'image/jpeg']
    enableSheetSvgImages(allowed)
    expect(allowed).toContain('image/svg+xml')
    expect(allowed.map((mime) => `.${mime.replace('image/', '')}`)).toContain('.svg')
  })

  it('is idempotent across remounts/hot reload', () => {
    const allowed = ['image/svg', 'image/svg+xml']
    enableSheetSvgImages(allowed)
    expect(allowed).toEqual(['image/svg', 'image/svg+xml'])
  })
})
