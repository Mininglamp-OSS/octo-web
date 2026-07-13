import { describe, it, expect } from 'vitest'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser, type Node as PMNode } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, FontFamily } from '@tiptap/extension-text-style'
import { stripPastedFontFamily } from './sanitize.ts'

// FONT_FAMILY_ENABLED (config.ts) must gate every WRITE path while it is off, not just the
// toolbar selector. Paste is the second write path: FontFamily is registered unconditionally
// (so old docs round-trip), and its parseHTML reads element.style.fontFamily on pasted HTML no
// matter the flag. If the flag-off paste kept font-family, a `<span style="font-family:…">`
// copied from Word/browser would write fontFamily into the shared Y.Doc, and an older client
// whose schema lacks the attr would silently strip it (data loss). stripPastedFontFamily is the
// flag-off transform; when the flag is on the caller skips it and the font is preserved.

// The exact schema-touching pair for this attr: textStyle carries the fontFamily global attr.
const schema = getSchema([
  StarterKit.configure({ undoRedo: false, codeBlock: false }),
  TextStyle,
  FontFamily,
])

/** Parse an HTML fragment into a doc and return the fontFamily of the first textStyle mark. */
function pastedFontFamily(html: string): string | null | undefined {
  const container = document.createElement('div')
  container.innerHTML = html
  const doc = PMDOMParser.fromSchema(schema).parse(container)
  let found: string | null | undefined
  doc.descendants((node: PMNode) => {
    const mark = node.marks.find((m) => m.type.name === 'textStyle')
    if (mark && found === undefined) found = (mark.attrs.fontFamily as string | null) ?? null
  })
  // No textStyle mark, an explicit null, OR an empty string all mean "no font family was
  // written". The shorthand path keeps font-size, so the span retains a style attr and a
  // textStyle mark is still created — its fontFamily resolves to '' (falsy), which is the
  // absence of a font choice, not a leaked family. Normalize '' → null so the assertion
  // reflects that no real family reached the doc.
  return found || null
}

describe('stripPastedFontFamily — flag-off paste sanitizer', () => {
  it('removes the inline font-family declaration', () => {
    const out = stripPastedFontFamily('<span style="font-family: Arial">hi</span>')
    expect(out).not.toMatch(/font-family/i)
    expect(out).toContain('hi')
  })

  it('drops the style attribute entirely when font-family was its only declaration', () => {
    const out = stripPastedFontFamily('<span style="font-family: Georgia">x</span>')
    expect(out).not.toContain('style=')
    expect(out).toContain('x')
  })

  it('keeps other inline styles while stripping only font-family', () => {
    const out = stripPastedFontFamily(
      '<span style="color: red; font-family: Georgia; font-size: 14px">x</span>',
    )
    expect(out).not.toMatch(/font-family/i)
    expect(out).toMatch(/color:\s*red/i)
    expect(out).toMatch(/font-size:\s*14px/i)
  })

  it('handles multiple spans and mixed casing', () => {
    const out = stripPastedFontFamily(
      '<p><span style="FONT-FAMILY: Arial">a</span><span style="font-family:\'Times New Roman\'">b</span></p>',
    )
    expect(out).not.toMatch(/font-family/i)
    expect(out).toContain('a')
    expect(out).toContain('b')
  })

  it('is a no-op when there is no font-family to strip', () => {
    const html = '<p><strong>bold</strong> and <em>italic</em></p>'
    expect(stripPastedFontFamily(html)).toBe(html)
  })

  // RC2: the `font` shorthand (`font: 14px Georgia`) also populates element.style.fontFamily,
  // so it must be stripped too — but keep the font-size/line-height it carries.
  it('strips the family from a `font` shorthand while keeping font-size', () => {
    const out = stripPastedFontFamily('<span style="font: 14px Georgia">x</span>')
    expect(out).not.toMatch(/georgia/i)
    expect(out).toMatch(/font-size:\s*14px/i)
    expect(out).toContain('x')
  })

  it('keeps font-size and line-height from a full `font` shorthand, drops the family', () => {
    const out = stripPastedFontFamily(
      '<span style="font: italic bold 12px/1.5 &quot;Times New Roman&quot;">x</span>',
    )
    expect(out).not.toMatch(/times new roman/i)
    expect(out).toMatch(/font-size:\s*12px/i)
    expect(out).toMatch(/line-height:\s*1\.5/i)
  })

  it('handles an uppercase `FONT` shorthand and sibling declarations', () => {
    const out = stripPastedFontFamily(
      '<span style="color: red; FONT: 16px Arial">x</span>',
    )
    expect(out).not.toMatch(/arial/i)
    expect(out).toMatch(/color:\s*red/i)
    expect(out).toMatch(/font-size:\s*16px/i)
  })

  it('does not touch a `font-size` longhand (no false shorthand match)', () => {
    const html = '<span style="font-size: 18px">x</span>'
    const out = stripPastedFontFamily(html)
    expect(out).toMatch(/font-size:\s*18px/i)
  })
})

describe('paste write path — fontFamily gating end to end', () => {
  const pasted = '<span style="font-family: Georgia, serif">styled</span>'

  it('flag ON (no sanitizer): pasted font-family survives into the doc (no false strip)', () => {
    // FONT_FAMILY_ENABLED === true → the plugin transform is identity, so the raw HTML is parsed.
    expect(pastedFontFamily(pasted)).toBe('Georgia, serif')
  })

  it('flag OFF (sanitizer runs): pasted font-family never reaches the doc', () => {
    // FONT_FAMILY_ENABLED === false → the plugin applies stripPastedFontFamily before PM parses.
    expect(pastedFontFamily(stripPastedFontFamily(pasted))).toBe(null)
  })

  // RC2: the `font` shorthand path — the browser/jsdom CSSOM expands `font: 14px Georgia`
  // into element.style.fontFamily === "Georgia", so without gating it leaks into the doc.
  const pastedShorthand = '<span style="font: 14px Georgia">styled</span>'

  it('flag ON (no sanitizer): a `font` shorthand family survives into the doc', () => {
    expect(pastedFontFamily(pastedShorthand)).toBe('Georgia')
  })

  it('flag OFF (sanitizer runs): a `font` shorthand family never reaches the doc', () => {
    expect(pastedFontFamily(stripPastedFontFamily(pastedShorthand))).toBe(null)
  })
})
