import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_BOARD_FONT_FAMILY } from './boardFontFamilies.ts'

const css = fs.readFileSync(path.resolve(__dirname, 'nativePanelInject.css'), 'utf8')
const injector = fs.readFileSync(path.resolve(__dirname, 'nativePanelInject.tsx'), 'utf8')

function rule(selector: string, requiredDeclaration?: RegExp): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
  const match = requiredDeclaration
    ? matches.find((candidate) => requiredDeclaration.test(candidate[1]))
    : matches[0]
  expect(match, `missing rule for ${selector}`).toBeDefined()
  return match?.[1] ?? ''
}

describe('board typography controls follow Octo form styling', () => {
  it('derives the native default-font anchor from the board font contract', () => {
    expect(DEFAULT_BOARD_FONT_FAMILY).toBeTypeOf('number')
    expect(injector).toContain('`font-family-octo-${DEFAULT_BOARD_FONT_FAMILY}`')
    expect(injector).not.toMatch(/font-family-octo-2001/)
  })

  it('uses neutral 32px family and size borders without purple focus rings', () => {
    for (const selector of [
      '.octo-board-native-inject__font-select',
      '.octo-board-native-inject__font-size-trigger',
    ]) {
      const declarations = rule(selector, /height:\s*var\(--wk-sp-8\)/)
      expect(declarations).toMatch(/height:\s*var\(--wk-sp-8\)/)
      expect(declarations).toMatch(/border:\s*1px solid var\(--wk-border-default\)/)
      expect(declarations).toMatch(/border-radius:\s*var\(--wk-r-xs\)/)
      expect(declarations).toMatch(/background:\s*var\(--wk-bg-surface\)/)
      expect(declarations).toMatch(/box-shadow:\s*none/)
    }

    expect(rule('.octo-board-native-inject__font-size-trigger:focus-within'))
      .toMatch(/--wk-border-strong/)
    expect(rule('.octo-board-native-inject__font-select[aria-expanded="true"]'))
      .toMatch(/--wk-border-strong/)
    expect(css).toContain('input.octo-board-native-inject__font-size:focus-visible')
    expect(css).toContain('box-shadow: none !important')
    expect(css).not.toContain('--wk-form-focus')
  })

  it('consumes existing semantic tokens instead of redefining component-local colours and radii', () => {
    const panel = rule('.octo-board-native-inject__panel')
    expect(panel).not.toMatch(/^\s*--wk-(?:brand|text|bg|border|black-alpha|r-)[^:]*:/m)
    expect(css).not.toMatch(/(?:color|background|border-color):\s*#[0-9a-f]{3,8}/i)
    expect(css).not.toMatch(/(?:color|background|border-color):\s*rgba?\(/i)
    expect(css).toMatch(/box-shadow:\s*var\(--wk-shadow-lg\)/)
    expect(css).toMatch(/color:\s*var\(--wk-icon-muted\)/)
  })
})
