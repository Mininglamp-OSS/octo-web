import { describe, expect, it } from 'vitest'
import { clampBoardCommentMarker, clampBoardCommentOverlay, deriveBoardCommentOverlayBounds } from './boardCommentOverlay.ts'

const bounds = { left: 220, top: 0, right: 1000, bottom: 700 }

describe('board comment overlay bounds', () => {
  it('moves popovers out of the property-panel strip and keeps them inside the canvas', () => {
    expect(clampBoardCommentOverlay(30, 690, 230, 160, bounds)).toEqual({ left: 228, top: 532 })
    expect(clampBoardCommentOverlay(500, 200, 230, 160, bounds)).toEqual({ left: 500, top: 200 })
  })

  it('keeps marker hit targets outside the property panel', () => {
    expect(clampBoardCommentMarker(50, -20, bounds)).toEqual({ x: 232, y: 12 })
    expect(clampBoardCommentMarker(1200, 900, bounds)).toEqual({ x: 988, y: 688 })
  })
  it('derives desktop side-panel and compact bottom-panel boundaries from real geometry', () => {
    const host = { left: 100, top: 50, right: 1100, bottom: 750, width: 1000, height: 700 }
    expect(deriveBoardCommentOverlayBounds(host, {
      left: 100, top: 50, right: 320, bottom: 750, width: 220, height: 700,
    })).toEqual({ left: 220, top: 0, right: 1000, bottom: 700 })
    expect(deriveBoardCommentOverlayBounds(host, {
      left: 100, top: 570, right: 1100, bottom: 750, width: 1000, height: 180,
    })).toEqual({ left: 0, top: 0, right: 1000, bottom: 520 })
  })

  it('ignores floating islands that are not edge strips', () => {
    const host = { left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700 }
    expect(deriveBoardCommentOverlayBounds(host, {
      left: 400, top: 200, right: 600, bottom: 400, width: 200, height: 200,
    })).toEqual({ left: 0, top: 0, right: 1000, bottom: 700 })
  })

})
