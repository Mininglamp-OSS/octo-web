import { describe, expect, it } from 'vitest'
import { withSvgImageAccept } from './sheetLocalFileService.ts'

describe('sheet image picker SVG support', () => {
  it('adds the real .svg extension to Univer image picker options', () => {
    expect(withSvgImageAccept({
      multiple: true,
      accept: '.png,.jpeg,.jpg,.gif,.bmp',
    })).toEqual({
      multiple: true,
      accept: '.png,.jpeg,.jpg,.gif,.bmp,.svg',
    })
  })

  it('does not change unrelated file pickers', () => {
    expect(withSvgImageAccept({ accept: '.xlsx,.xls' })).toEqual({ accept: '.xlsx,.xls' })
  })

  it('does not duplicate an existing SVG extension', () => {
    expect(withSvgImageAccept({ accept: '.png,.svg' })).toEqual({ accept: '.png,.svg' })
  })
})
