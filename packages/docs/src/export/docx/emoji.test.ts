/**
 * Tests for emoji font handling in DOCX export.
 *
 * The body font (微软雅黑) has no emoji glyphs and Word does not auto-fallback,
 * so emoji must be tagged with an emoji font or they render as blank boxes.
 */
import { describe, it, expect } from 'vitest'
import { buildTextRuns, iconPrefix } from './marks.ts'
import { FONT_EMOJI } from './styles.ts'

/** Serialize a TextRun to inspect its text + font via the internal XML tree. */
function runInfo(run: unknown): { text: string; font?: string } {
  // TextRun stores children internally; use JSON round-trip on its root.
  const anyRun = run as { root?: unknown[] }
  const json = JSON.stringify(anyRun)
  const textMatch = json.match(/"text":"([^"]*)"/)
  const fontMatch = json.match(/"w:ascii":"([^"]*)"|"ascii":"([^"]*)"/)
  return {
    text: textMatch ? textMatch[1] : '',
    font: fontMatch ? fontMatch[1] || fontMatch[2] : undefined,
  }
}

describe('emoji font handling', () => {
  it('plain text without emoji → single run, no emoji font', () => {
    const runs = buildTextRuns('普通中文文本', {})
    expect(runs.length).toBe(1)
    expect(JSON.stringify(runs[0])).not.toContain(FONT_EMOJI)
  })

  it('pure emoji → run tagged with emoji font', () => {
    const runs = buildTextRuns('😀', {})
    expect(runs.length).toBe(1)
    expect(JSON.stringify(runs[0])).toContain(FONT_EMOJI)
  })

  it('mixed CJK + emoji → splits, only emoji run gets emoji font', () => {
    const runs = buildTextRuns('你好😀世界', {})
    // 你好 | 😀 | 世界
    expect(runs.length).toBe(3)
    const serialized = runs.map((r) => JSON.stringify(r))
    // exactly one run carries the emoji font
    const withFont = serialized.filter((s) => s.includes(FONT_EMOJI))
    expect(withFont.length).toBe(1)
    expect(withFont[0]).toContain('😀')
  })

  it('checkmark / symbol emoji ✅ tagged with emoji font', () => {
    const runs = buildTextRuns('✅', {})
    expect(JSON.stringify(runs[0])).toContain(FONT_EMOJI)
  })

  it('ZWJ sequence 👩‍💻 stays in one emoji run', () => {
    const runs = buildTextRuns('👩‍💻', {})
    expect(runs.length).toBe(1)
    expect(JSON.stringify(runs[0])).toContain(FONT_EMOJI)
  })

  it('FE0F-variation emoji ℹ️ / ⚠️ stay in ONE emoji run with FE0F stripped (no tofu box)', () => {
    // Regression: base symbol + trailing U+FE0F previously left an orphaned FE0F
    // that rendered as a small box after the icon (esp. on macOS Word, whose
    // emoji font has no composed FE0F glyph). Fix: keep them in one emoji run
    // AND strip FE0F — the base char already resolves to the colored glyph.
    for (const glyph of ['ℹ️', '⚠️', '‼️', '⁉️', '™️', '↔️']) {
      const runs = buildTextRuns(glyph, {})
      expect(runs.length).toBe(1)
      const s = JSON.stringify(runs[0])
      expect(s).toContain(FONT_EMOJI)
      // no orphaned variation selector left in the run
      expect(s).not.toContain('\uFE0F')
      expect(/fe0f/i.test(s)).toBe(false)
    }
  })

  it('iconPrefix strips FE0F from callout/UI icons (no trailing tofu box)', () => {
    for (const glyph of ['ℹ️', '⚠️']) {
      const parts = iconPrefix(glyph, { bold: true })
      const s = JSON.stringify(parts)
      expect(s).toContain(FONT_EMOJI)
      expect(/fe0f/i.test(s)).toBe(false)
    }
  })

  it('normal punctuation (ellipsis, em-dash, brackets) stays in body font', () => {
    for (const text of ['中文…省略', '破折号——测试', '引用「文本」']) {
      const runs = buildTextRuns(text, {})
      expect(runs.length).toBe(1)
      expect(JSON.stringify(runs[0])).not.toContain(FONT_EMOJI)
    }
  })

  it('preserves base run options on non-emoji segments', () => {
    const runs = buildTextRuns('粗体😀', { bold: true })
    // both segments keep bold; only emoji adds font
    const all = runs.map((r) => JSON.stringify(r))
    expect(all.every((s) => s.includes('"bold":true') || s.includes('w:b'))).toBe(true)
  })
})
