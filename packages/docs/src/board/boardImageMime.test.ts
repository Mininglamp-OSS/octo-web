import { describe, expect, it } from 'vitest'
import { classifyBoardImage } from './boardImageMime.ts'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'

describe('classifyBoardImage', () => {
  it('routes SVG through sanitation when Excalidraw MIME is empty', async () => {
    await expect(classifyBoardImage(new Blob([SVG], { type: 'image/svg+xml' }), ''))
      .resolves.toEqual({ mime: 'image/svg+xml', isSvg: true })
  })

  it('normalizes mixed-case SVG MIME', async () => {
    await expect(classifyBoardImage(new Blob([SVG]), ' Image/SVG+XML '))
      .resolves.toEqual({ mime: 'image/svg+xml', isSvg: true })
  })

  it('content-sniffs a real SVG mislabeled as PNG', async () => {
    await expect(classifyBoardImage(new Blob([SVG], { type: 'image/png' }), 'image/png'))
      .resolves.toEqual({ mime: 'image/svg+xml', isSvg: true })
  })

  it('keeps a raster image on the presign path', async () => {
    await expect(classifyBoardImage(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'image/png'))
      .resolves.toEqual({ mime: 'image/png', isSvg: false })
  })
})
