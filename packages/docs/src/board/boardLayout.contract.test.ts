import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve('src/board/board.css'), 'utf8')

describe('Board live canvas layout contract', () => {
  it('lets the live-canvas isolation wrapper fill the remaining board area', () => {
    const rule = css.match(/\.octo-board-live-canvas\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(rule).toMatch(/flex:\s*1\s+1\s+auto/)
    expect(rule).toMatch(/width:\s*100%/)
    expect(rule).toMatch(/height:\s*100%/)
    expect(rule).toMatch(/min-width:\s*0/)
    expect(rule).toMatch(/min-height:\s*0/)
  })

  it('uses the Octo brand focus ring for comment marker interaction states', () => {
    const rule = css.match(
      /\.octo-board-comment-marker:hover,\s*\.octo-board-comment-marker:focus-visible,\s*\.octo-board-comment-marker\.is-active\s*\{([^}]*)\}/,
    )?.[1] ?? ''

    expect(rule).toMatch(/outline:\s*2px solid var\(--wk-brand-alpha-20/)
    expect(rule).not.toMatch(/51\s+112\s+255|#3370ff|#1664ff/i)
  })
})
