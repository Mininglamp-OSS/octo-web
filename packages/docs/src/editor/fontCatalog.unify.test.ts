import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FONT_FAMILIES,
  SHEET_FONT_ADDITIONS,
  isFontFamilySupported,
  primaryFontName,
} from './fontFamilies.ts'
import { isBoardFontSupported } from '../board/NativePanelTextControls.tsx'
import zhCN from '../i18n/zh-CN.json'
import enUS from '../i18n/en-US.json'

// Doc/Sheet/Board theme unification: one authoritative font catalogue drives the shared availability
// probe (mirroring Univer IFontService.isFontSupported), the Sheet's picker additions, and the
// localized "font not installed" warning. These tests pin that shared behaviour.

function resolve(bundle: Record<string, unknown>, key: string): string | undefined {
  const segs = key.replace(/^docs\./, '').split('.')
  let cur: unknown = bundle
  for (const seg of segs) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[seg]
    else return undefined
  }
  return typeof cur === 'string' ? cur : undefined
}

describe('primaryFontName', () => {
  it('takes the first family segment and strips surrounding quotes', () => {
    expect(primaryFontName('SimSun, "宋体", serif')).toBe('SimSun')
    expect(primaryFontName('"PingFang SC", sans-serif')).toBe('PingFang SC')
    expect(primaryFontName('Calibri, Carlito, sans-serif')).toBe('Calibri')
    expect(primaryFontName('"Courier New", Courier, monospace')).toBe('Courier New')
    expect(primaryFontName('')).toBe('')
  })
})

describe('isFontFamilySupported (shared availability probe)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns true when no 2D canvas context is available (never a false "unavailable")', () => {
    // jsdom does not implement canvas 2D; getContext resolves to null here.
    expect(isFontFamilySupported('Totally Missing Face, sans-serif')).toBe(true)
  })

  it('reports a face as available only when it changes the measured glyph width vs. every fallback', () => {
    // Fake 2D context: a "present" face renders wider than its generic fallback; an "absent" face
    // measures identically to the fallback (the browser substituted it), matching the real probe.
    const present = new Set(['Installed Face'])
    const ctx = {
      font: '',
      measureText(text: string) {
        const family = this.font.replace(/^\d+px\s+/, '')
        const named = /^"([^"]+)"/.exec(family)?.[1]
        const wide = named != null && present.has(named)
        return { width: (wide ? 200 : 100) + text.length }
      },
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    )
    expect(isFontFamilySupported('Installed Face, sans-serif')).toBe(true)
    expect(isFontFamilySupported('Absent Face, sans-serif')).toBe(false)
  })

  it('accepts an installed concrete fallback without treating a generic fallback as installed', () => {
    const present = new Set(['Carlito'])
    const ctx = {
      font: '',
      measureText(text: string) {
        const family = this.font.replace(/^\d+px\s+/, '')
        const named = /^"([^"]+)"/.exec(family)?.[1]
        return { width: (named != null && present.has(named) ? 200 : 100) + text.length }
      },
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    )

    expect(isFontFamilySupported('Calibri, Carlito, sans-serif')).toBe(true)
    expect(isFontFamilySupported('Calibri, sans-serif')).toBe(false)
    expect(isFontFamilySupported('Missing Face, serif')).toBe(false)
  })

  it('is the single probe Board delegates to (same verdict on both surfaces)', () => {
    // Install a fake 2D context so BOTH probes return REAL width-based verdicts. Under jsdom's null
    // context every font short-circuits to `true`, so this assertion would compare true-to-true and
    // could never catch a broken delegation (e.g. `isBoardFontSupported` hardcoded to return `true`).
    // Marking one face present and the rest absent forces a mix of verdicts, so the equality check
    // fails the instant the Board stops routing through the shared probe.
    const present = new Set(['SimSun'])
    const ctx = {
      font: '',
      measureText(text: string) {
        const family = this.font.replace(/^\d+px\s+/, '')
        const named = /^"([^"]+)"/.exec(family)?.[1]
        const wide = named != null && present.has(named)
        return { width: (wide ? 200 : 100) + text.length }
      },
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    )
    let sawSupported = false
    let sawUnsupported = false
    for (const font of FONT_FAMILIES) {
      const shared = isFontFamilySupported(font.value)
      expect(isBoardFontSupported(font.value)).toBe(shared)
      if (shared) sawSupported = true
      else sawUnsupported = true
    }
    // Guard the guard: the fixture must actually yield both verdicts, or the equality check above
    // degenerates back into a constant-to-constant comparison that can't fail.
    expect(sawSupported).toBe(true)
    expect(sawUnsupported).toBe(true)
  })
})

describe('SHEET_FONT_ADDITIONS (Sheet derives from the shared catalogue)', () => {
  const UNIVER_DEFAULT_FONT_VALUES = [
    'Arial',
    'Times New Roman',
    'Tahoma',
    'Verdana',
    'Microsoft YaHei',
    'SimSun',
    'SimHei',
    'Kaiti',
    'FangSong',
    'NSimSun',
    'STXinwei',
    'STXingkai',
    'STLiti',
  ]

  it('lists exactly the macOS/Latin faces the Sheet adds on top of Univer defaults', () => {
    const values = SHEET_FONT_ADDITIONS.map((f) => f.value)
    expect(values).toEqual([
      'Calibri',
      'PingFang SC',
      'Hiragino Sans GB',
      'STXihei',
      'Yuanti SC',
      'Hannotate SC',
      'HanziPen SC',
      'Wawati SC',
      'Georgia',
      'Palatino',
      'Courier New',
      'Trebuchet MS',
      'Comic Sans MS',
      'Impact',
    ])
  })

  it('uses the bare primary family name of the shared catalogue CSS stack for each entry', () => {
    for (const add of SHEET_FONT_ADDITIONS) {
      const catalogEntry = FONT_FAMILIES.find((f) => f.labelKey === add.labelKey)
      expect(catalogEntry, `catalogue entry for ${add.labelKey}`).toBeTruthy()
      expect(add.value).toBe(primaryFontName(catalogEntry!.value))
    }
  })

  it('adds every catalogue face not already supplied by Univer defaults', () => {
    const sheetValues = new Set(
      [...UNIVER_DEFAULT_FONT_VALUES, ...SHEET_FONT_ADDITIONS.map((f) => f.value)].map((value) =>
        value.toLowerCase(),
      ),
    )
    for (const font of FONT_FAMILIES) {
      // CSS family names are ASCII case-insensitive: Univer's `Kaiti` and the persisted Board/Doc
      // spelling `KaiTi` identify the same face without rewriting existing document values.
      expect(sheetValues.has(primaryFontName(font.value).toLowerCase()), font.labelKey).toBe(true)
    }
  })

  it('never re-adds a Windows-named face Univer already ships (no duplicate picker rows)', () => {
    const values = SHEET_FONT_ADDITIONS.map((f) => f.value)
    for (const shipped of UNIVER_DEFAULT_FONT_VALUES) {
      expect(values).not.toContain(shipped)
    }
  })

  it('reuses the shared docs.toolbar.font.* labels, resolving in both locales', () => {
    for (const add of SHEET_FONT_ADDITIONS) {
      expect(add.labelKey.startsWith('docs.toolbar.font.')).toBe(true)
      expect(resolve(zhCN, add.labelKey), `${add.labelKey} zh-CN`).toBeTruthy()
      expect(resolve(enUS, add.labelKey), `${add.labelKey} en-US`).toBeTruthy()
    }
  })
})

describe('localized unavailable-font warning', () => {
  it('resolves docs.toolbar.fontNotSupported in both locales (Doc toolbar parity with Board)', () => {
    expect(resolve(zhCN, 'docs.toolbar.fontNotSupported')).toBeTruthy()
    expect(resolve(enUS, 'docs.toolbar.fontNotSupported')).toBeTruthy()
  })

  it('carries the same copy the Board text controls already show', () => {
    expect(resolve(zhCN, 'docs.toolbar.fontNotSupported')).toBe(
      resolve(zhCN, 'docs.board.nativePanel.fontNotSupported'),
    )
    expect(resolve(enUS, 'docs.toolbar.fontNotSupported')).toBe(
      resolve(enUS, 'docs.board.nativePanel.fontNotSupported'),
    )
  })
})

describe('code-block text colour is pinned to the unified foreground variable', () => {
  it('sets .octo-prose pre code color to var(--octo-fg)', () => {
    const css = fs.readFileSync(path.resolve(__dirname, 'styles.css'), 'utf8')
    const match = css.match(/\.octo-prose pre code\s*\{([^}]*)\}/)
    expect(match, 'missing base .octo-prose pre code rule').not.toBeNull()
    expect(match?.[1]).toMatch(/color:\s*var\(--octo-fg\)/)
  })
})
