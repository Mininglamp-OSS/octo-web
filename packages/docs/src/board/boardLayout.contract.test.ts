import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BOARD_DRAWER_WIDTH, canReserveBoardDrawer } from './boardDrawerLayout.ts'

const css = readFileSync(resolve('src/board/board.css'), 'utf8')
const editorCss = readFileSync(resolve('src/editor/styles.css'), 'utf8')

describe('Board live canvas layout contract', () => {
  it('lets the live-canvas isolation wrapper fill the remaining board area', () => {
    const rules = [...css.matchAll(/^\.octo-board-live-canvas\s*\{([^}]*)\}/gm)]
    expect(rules).toHaveLength(1)
    const rule = rules[0]?.[1] ?? ''

    expect(rule).toMatch(/position:\s*relative/)
    expect(rule).toMatch(/display:\s*flex/)
    expect(rule).toMatch(/flex:\s*1\s+1\s+auto/)
    expect(rule).toMatch(/width:\s*100%/)
    expect(rule).toMatch(/height:\s*100%/)
    expect(rule).toMatch(/min-width:\s*0/)
    expect(rule).toMatch(/min-height:\s*0/)
  })

  it('reserves the drawer only while the remaining canvas preserves desktop breakpoints', () => {
    expect(BOARD_DRAWER_WIDTH).toBe(360)
    expect(canReserveBoardDrawer(1090, 600)).toBe(true)
    expect(canReserveBoardDrawer(1089, 600)).toBe(false)
    expect(canReserveBoardDrawer(1360, 499)).toBe(true)
    expect(canReserveBoardDrawer(1359, 499)).toBe(false)
  })

  it('uses the shared drawer width without introducing layout containment', () => {
    const drawerRule = css.match(
      /\.octo-board-canvas--drawer-reserved\s+\.octo-board-live-canvas\s*\{([^}]*)\}/,
    )?.[1] ?? ''

    const configuredDrawerWidth = Number(
      editorCss.match(/--octo-doc-drawer-width:\s*(\d+)px/)?.[1],
    )
    const fallbackDrawerWidth = Number(
      drawerRule.match(/var\(--octo-doc-drawer-width,\s*(\d+)px\)/)?.[1],
    )
    expect(configuredDrawerWidth).toBe(BOARD_DRAWER_WIDTH)
    expect(fallbackDrawerWidth).toBe(BOARD_DRAWER_WIDTH)
    expect(editorCss).toMatch(/width:\s*var\(--octo-doc-drawer-width\)/)
    const canvasRule = css.match(/\.octo-board-canvas\s*\{([^}]*)\}/)?.[1] ?? ''
    const liveCanvasRule = css.match(/^\.octo-board-live-canvas\s*\{([^}]*)\}/m)?.[1] ?? ''
    // Container layout containment would re-anchor Excalidraw's position:fixed tool overlays.
    expect(canvasRule).not.toMatch(/container-type:/)
    expect(liveCanvasRule).not.toMatch(/container-type:/)
    expect(drawerRule).toMatch(/flex:\s*0\s+1\s+auto/)
    expect(drawerRule).toMatch(/width:\s*calc\(100%\s*-\s*var\(--octo-doc-drawer-width,\s*360px\)\)/)
  })

  it('uses the Octo brand focus ring for comment marker interaction states', () => {
    const rule = css.match(
      /\.octo-board-comment-marker:hover,\s*\.octo-board-comment-marker:focus-visible,\s*\.octo-board-comment-marker\.is-active\s*\{([^}]*)\}/,
    )?.[1] ?? ''

    expect(rule).toMatch(/outline:\s*2px solid var\(--wk-brand-alpha-20/)
    expect(rule).not.toMatch(/51\s+112\s+255|#3370ff|#1664ff/i)
  })
})
