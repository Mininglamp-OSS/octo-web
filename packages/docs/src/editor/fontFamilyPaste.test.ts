import { describe, it, expect, vi, afterEach } from 'vitest'
import { stripPastedFontFamily } from './sanitize.ts'

// FONT_FAMILY_ENABLED (config.ts) must gate every WRITE path while it is off, not just the
// toolbar selector. Paste is the second write path: FontFamily is registered unconditionally
// (so old docs round-trip), and its parseHTML reads element.style.fontFamily on pasted HTML no
// matter the flag. If the flag-off paste kept font-family, a `<span style="font-family:…">`
// copied from Word/browser would write fontFamily into the shared Y.Doc, and an older client
// whose schema lacks the attr would silently strip it (data loss). stripPastedFontFamily is the
// flag-off transform; when the flag is on the caller skips it and the font is preserved.

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
    const out = stripPastedFontFamily('<span style="color: red; FONT: 16px Arial">x</span>')
    expect(out).not.toMatch(/arial/i)
    expect(out).toMatch(/color:\s*red/i)
    expect(out).toMatch(/font-size:\s*16px/i)
  })

  it('does not touch a `font-size` longhand (no false shorthand match)', () => {
    const html = '<span style="font-size: 18px">x</span>'
    const out = stripPastedFontFamily(html)
    expect(out).toMatch(/font-size:\s*18px/i)
  })

  // RC (Jerry-Xin / OctoBoooot / yujiawei @ 58e999d0): the old raw-HTML fast-path guard
  // (`/font(-family)?\s*:/i.test(html)`) tested the clipboard string BEFORE the parser
  // entity-decodes it. An entity-encoded colon carries no literal `font-family:` in the raw
  // string, so the guard early-returned unchanged — but after parse `element.style.fontFamily`
  // resolves to the family and leaks into the shared Y.Doc with the flag off. The strip now
  // always walks the parsed DOM (getAttribute('style') is entity-decoded), so it is covered.
  it('strips a font-family hidden behind an entity-encoded colon (&#58;)', () => {
    const out = stripPastedFontFamily('<span style="font-family&#58;Georgia">x</span>')
    expect(out).not.toMatch(/font-family/i)
    expect(out).not.toMatch(/georgia/i)
    expect(out).toContain('x')
  })

  it('strips a `font` shorthand family hidden behind a hex entity colon (&#x3a;)', () => {
    const out = stripPastedFontFamily('<span style="font&#x3a;14px Arial">x</span>')
    expect(out).not.toMatch(/arial/i)
    expect(out).toMatch(/font-size:\s*14px/i)
    expect(out).toContain('x')
  })

  // RC (yujiawei variant, OctoBoooot real-Chrome byte-verified @ d7f0edae): a CSS COMMENT in the
  // property NAME defeated the old raw-name string compare (`prop === 'font-family'`) while the
  // CSSOM strips the comment and still resolves the family → leak with the flag off. The gate now
  // decides on the resolved property (comment stripped in name normalization), so it is covered.
  it('strips a font-family whose name carries a trailing CSS comment (font-family/**/:)', () => {
    const out = stripPastedFontFamily('<span style="font-family/**/:Georgia">x</span>')
    expect(out).not.toMatch(/font-family/i)
    expect(out).not.toMatch(/georgia/i)
    expect(out).toContain('x')
  })

  it('strips a font-family whose name carries a leading CSS comment (/**/font-family:)', () => {
    const out = stripPastedFontFamily('<span style="/**/font-family:Georgia">x</span>')
    expect(out).not.toMatch(/font-family/i)
    expect(out).not.toMatch(/georgia/i)
    expect(out).toContain('x')
  })

  it('strips a `font` shorthand whose name carries a CSS comment, keeping font-size', () => {
    const out = stripPastedFontFamily('<span style="color: red; font/**/:14px Georgia">x</span>')
    expect(out).not.toMatch(/georgia/i)
    expect(out).toMatch(/color:\s*red/i)
    expect(out).toMatch(/font-size:\s*14px/i)
  })

  // RC (Jerry-Xin standing 🔴 from a6ac93f): a CSS ESCAPE in the property NAME likewise defeated
  // the raw-name compare while a browser's CSSOM decodes the escape and resolves the family. The
  // name normalization decodes identifier escapes (`\-` → '-', `\66 ` → 'f') so the resolved
  // property is `font-family` and the declaration is dropped. (Note: jsdom's cssstyle does NOT
  // decode escapes in property names, so this variant's leak is real-browser-only and cannot be
  // reproduced through the CSSOM/Y.Doc path in this test env — it is closed here by construction
  // at the string level, and by the flag-off parseHTML backstop at runtime.)
  it('strips a font-family whose hyphen is CSS-escaped (font\\-family:)', () => {
    const out = stripPastedFontFamily('<span style="font\\-family:Georgia">x</span>')
    expect(out).not.toMatch(/georgia/i)
    expect(out).toContain('x')
  })

  it('strips a font-family whose leading char is CSS hex-escaped (\\66 ont-family:)', () => {
    const out = stripPastedFontFamily('<span style="\\66 ont-family:Georgia">x</span>')
    expect(out).not.toMatch(/georgia/i)
    expect(out).toContain('x')
  })

  // RC (yujiawei P1 @ 58e999d0): ReDoS regression on the default flag-off paste path. The old
  // FONT_SIZE_LENGTH pattern (`\d+\.?\d*`) backtracked O(n²) on a long all-digit token, freezing
  // the main thread (~11s at 80k, ~73s at 200k). The unambiguous pattern + length cap keep it
  // instant. Bound is generous (real font-size tokens are tiny); pre-fix this took tens of seconds.
  it('does not backtrack (ReDoS) on a huge digit run in a `font` shorthand', () => {
    const huge = '<span style="font: ' + '1'.repeat(200000) + 'zz Arial">x</span>'
    const start = performance.now()
    const out = stripPastedFontFamily(huge)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(1000)
    expect(out).not.toMatch(/arial/i)
  })
})

// End-to-end through the REAL paste path. Rather than call stripPastedFontFamily directly, this
// builds a live editor with the actual LiveFontFamily extension and pushes clipboard HTML through
// ProseMirror's `transformPastedHTML` aggregation — the same hook the plugin registers — so the
// FONT_FAMILY_ENABLED branch inside the plugin is what decides whether the sanitizer runs.
// FONT_FAMILY_ENABLED is resolved from import.meta.env at module load (config.ts), so each flag
// value stubs the env, resets the module cache, and re-imports the whole editor module graph fresh
// (one consistent prosemirror/tiptap instance) before constructing the editor.
async function pasteThroughEditor(
  html: string,
  flagOn: boolean,
): Promise<{ family: string | null; size: string | null }> {
  vi.resetModules()
  vi.stubEnv('VITE_DOCS_FONT_FAMILY', flagOn ? 'true' : 'false')

  const [{ Editor }, starterKitMod, textStyleMod, ext] = await Promise.all([
    import('@tiptap/core'),
    import('@tiptap/starter-kit'),
    import('@tiptap/extension-text-style'),
    import('./extensions.ts'),
  ])
  const StarterKit = starterKitMod.default
  const { TextStyle, FontSize } = textStyleMod
  const { LiveFontFamily } = ext

  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ undoRedo: false, codeBlock: false }),
      TextStyle,
      FontSize,
      LiveFontFamily,
    ],
    content: '<p></p>',
  })

  try {
    // Grab the real paste-gate plugin LiveFontFamily.addProseMirrorPlugins() registered on the
    // live editor and invoke its transformPastedHTML — the exact hook (and FONT_FAMILY_ENABLED
    // branch) ProseMirror runs on a paste. It is the only registered plugin carrying this prop.
    const gate = editor.view.state.plugins.find(
      (p) => typeof p.props?.transformPastedHTML === 'function',
    )
    expect(gate, 'LiveFontFamily should register a transformPastedHTML paste-gate plugin').toBeTruthy()
    const transformed = gate!.props.transformPastedHTML!.call(gate!, html, editor.view) ?? html
    editor.commands.setContent(transformed)

    let family: string | null = null
    let size: string | null = null
    editor.state.doc.descendants((node) => {
      const mark = node.marks.find((m) => m.type.name === 'textStyle')
      if (mark) {
        // LiveFontFamily normalizes an empty resolved family to null (schema default), so a span
        // that only kept font-size no longer carries a `fontFamily=""` shell. The `|| null` here
        // is belt-and-suspenders — it keeps this helper tracking a real family, not an empty one.
        family = family || ((mark.attrs.fontFamily as string | null) || null)
        size = size || ((mark.attrs.fontSize as string | null) || null)
      }
    })
    return { family, size }
  } finally {
    editor.destroy()
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('paste write path — LiveFontFamily plugin + FONT_FAMILY_ENABLED gating', () => {
  const longhand = '<span style="font-family: Georgia, serif">styled</span>'
  const shorthand = '<span style="font: 14px Georgia">styled</span>'

  it('flag ON: a pasted font-family longhand survives into the doc (transform is identity)', async () => {
    const { family } = await pasteThroughEditor(longhand, true)
    expect(family).toBe('Georgia, serif')
  })

  it('flag OFF: a pasted font-family longhand never reaches the doc', async () => {
    const { family } = await pasteThroughEditor(longhand, false)
    expect(family).toBe(null)
  })

  // RC2: the browser/jsdom CSSOM expands `font: 14px Georgia` into element.style.fontFamily ===
  // "Georgia", so the shorthand is a fontFamily write path the gate must also cover.
  it('flag ON: a `font` shorthand family survives, and font-size is preserved', async () => {
    const { family, size } = await pasteThroughEditor(shorthand, true)
    expect(family).toBe('Georgia')
    expect(size).toBe('14px')
  })

  it('flag OFF: a `font` shorthand family is gated out, but font-size is not harmed', async () => {
    const { family, size } = await pasteThroughEditor(shorthand, false)
    expect(family).toBe(null)
    expect(size).toBe('14px')
  })

  // RC @ 58e999d0: an entity-encoded colon must not let a pasted font-family slip past the gate
  // into the shared Y.Doc while the flag is off. Driven end-to-end through the real plugin.
  const entityLonghand = '<span style="font-family&#58;Georgia, serif">styled</span>'

  it('flag OFF: an entity-colon font-family never reaches the doc', async () => {
    const { family } = await pasteThroughEditor(entityLonghand, false)
    expect(family).toBe(null)
  })

  it('flag ON: the same entity-colon font-family resolves and survives (parser decodes it)', async () => {
    const { family } = await pasteThroughEditor(entityLonghand, true)
    expect(family).toBe('Georgia, serif')
  })
})

// Strict Y.Doc invariant (three human reviewers gate on it): with the flag off, a pasted `font`
// shorthand must write NO fontFamily VALUE into the shared Y.Doc. The sanitizer strips the family
// from `font: 14px Georgia` (→ `font-size: 14px`), but the surviving span still parses through
// FontFamily.parseHTML, whose upstream reads element.style.fontFamily, resolves "" (empty string)
// and stores it as `fontFamily=""` on the textStyle mark — an empty-but-written key that still
// "reaches" the Y.Doc and trips the invariant. (fontFamily is registered UNCONDITIONALLY so the
// schema always round-trips stored fonts, so the attr's schema DEFAULT — null — is present on
// every textStyle mark regardless of the flag, exactly as it is for a plain flag-off `font-size`
// paste; the invariant is about a WRITTEN value, not the schema default.) These tests drive the
// paste end-to-end through the REAL Collaboration binding (y-prosemirror) and assert on the
// serialized Y.Doc fragment: they fail on `fontFamily=""` and pass only when the attr sits at its
// default, indistinguishable from a paste that never carried a font.
async function pasteIntoYDocFragment(
  html: string,
  flagOn: boolean,
): Promise<{ xml: string; markAttrs: Array<Record<string, unknown>> }> {
  vi.resetModules()
  vi.stubEnv('VITE_DOCS_FONT_FAMILY', flagOn ? 'true' : 'false')

  const [{ Editor }, starterKitMod, textStyleMod, collabMod, ext, Y] = await Promise.all([
    import('@tiptap/core'),
    import('@tiptap/starter-kit'),
    import('@tiptap/extension-text-style'),
    import('@tiptap/extension-collaboration'),
    import('./extensions.ts'),
    import('yjs'),
  ])
  const StarterKit = starterKitMod.default
  const { TextStyle, FontSize } = textStyleMod
  const Collaboration = collabMod.default
  const { LiveFontFamily } = ext
  const ydoc = new Y.Doc()

  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ undoRedo: false, codeBlock: false }),
      TextStyle,
      FontSize,
      LiveFontFamily,
      // The real collaborative binding: y-prosemirror mirrors the ProseMirror doc into this
      // Y.Doc, so whatever value survives on the textStyle mark is exactly what reaches the Y.Doc.
      Collaboration.configure({ document: ydoc, field: 'default' }),
    ],
  })

  try {
    const gate = editor.view.state.plugins.find(
      (p) => typeof p.props?.transformPastedHTML === 'function',
    )
    const transformed = gate!.props.transformPastedHTML!.call(gate!, html, editor.view) ?? html
    editor.commands.setContent(transformed)

    // Raw (un-normalized) textStyle attrs, so an empty-string fontFamily is NOT hidden.
    const markAttrs: Array<Record<string, unknown>> = []
    editor.state.doc.descendants((node) => {
      const mark = node.marks.find((m) => m.type.name === 'textStyle')
      if (mark) markAttrs.push({ ...mark.attrs })
    })
    return { xml: ydoc.getXmlFragment('default').toString(), markAttrs }
  } finally {
    editor.destroy()
  }
}

describe('strict flag-off Y.Doc invariant — no fontFamily value from a pasted `font` shorthand', () => {
  const shorthand = '<span style="font: 14px Georgia">styled</span>'

  it('flag OFF: the shorthand paste writes NO fontFamily value into the Y.Doc (not even an empty one)', async () => {
    const { xml, markAttrs } = await pasteIntoYDocFragment(shorthand, false)
    // The bug signature — an empty, but WRITTEN, fontFamily — must be gone from the Y.Doc …
    expect(xml).not.toContain('fontFamily=""')
    // … and no real family may leak either.
    expect(xml).not.toMatch(/fontFamily="(?!null")[^"]/i)
    // font-size must survive (we gate the family out, not the size).
    expect(xml).toMatch(/fontSize="14px"/)
    // The textStyle mark must carry fontFamily at its schema DEFAULT (null), never a string — an
    // empty string "" is the bug, a family name is a leak; only null means "no font was written".
    for (const attrs of markAttrs) {
      expect(attrs.fontFamily, `fontFamily should be null, got ${JSON.stringify(attrs.fontFamily)}`).toBeNull()
    }
  })

  it('flag OFF: the shorthand paste is indistinguishable in the Y.Doc from a plain `font-size` paste', async () => {
    // Proves the family truly never reached the Y.Doc: the shorthand (family stripped, size kept)
    // serializes to exactly the same fragment as a paste that only ever carried a font-size, so
    // the fontFamily attr sits at its unconditional-registration default in both — nothing extra.
    const { xml: fromShorthand } = await pasteIntoYDocFragment(shorthand, false)
    const { xml: fromPlainSize } = await pasteIntoYDocFragment(
      '<span style="font-size: 14px">styled</span>',
      false,
    )
    expect(fromShorthand).toBe(fromPlainSize)
  })

  // A malicious/degenerate shorthand with no parseable font-size (the ReDoS-style sample shape)
  // is dropped whole by the sanitizer, so it leaves no textStyle mark and no fontFamily at all.
  it('flag OFF: a shorthand with no parseable size leaves no textStyle mark (no fontFamily)', async () => {
    const { xml, markAttrs } = await pasteIntoYDocFragment('<span style="font: Georgia">styled</span>', false)
    expect(xml).not.toMatch(/fontFamily/i)
    expect(markAttrs).toHaveLength(0)
  })

  it('flag ON: the same shorthand DOES write the family into the Y.Doc (round-trip intact)', async () => {
    const { xml } = await pasteIntoYDocFragment(shorthand, true)
    expect(xml).toMatch(/fontFamily="Georgia"/)
    expect(xml).toMatch(/fontSize="14px"/)
  })
})

// CSS-comment bypass, driven end-to-end through the REAL y-prosemirror binding. jsdom's CSSOM
// (like a real browser) strips a comment in the property name and resolves the family, so the old
// raw-name string compare leaked these into the shared Y.Doc with the flag off. Both boundary
// variants the RC calls out — `font-family/**/:` and `/**/font-family:` — plus the `font/**/:`
// shorthand are asserted to write NO fontFamily value flag-off, and to still write it flag-on
// (proving the fix is a write gate, not a read gate).
describe('flag-off Y.Doc invariant — CSS-comment property-name bypass', () => {
  const commentTrailing = '<span style="font-family/**/:Georgia, serif">styled</span>'
  const commentLeading = '<span style="/**/font-family:Georgia, serif">styled</span>'
  const commentShorthand = '<span style="font/**/:14px Georgia">styled</span>'

  it('flag OFF: a trailing-comment font-family name writes NO fontFamily value into the Y.Doc', async () => {
    const { xml, markAttrs } = await pasteIntoYDocFragment(commentTrailing, false)
    expect(xml).not.toContain('fontFamily=""')
    expect(xml).not.toMatch(/fontFamily="(?!null")[^"]/i)
    for (const attrs of markAttrs) {
      expect(attrs.fontFamily, `fontFamily should be null, got ${JSON.stringify(attrs.fontFamily)}`).toBeNull()
    }
  })

  it('flag OFF: a leading-comment font-family name writes NO fontFamily value into the Y.Doc', async () => {
    const { xml, markAttrs } = await pasteIntoYDocFragment(commentLeading, false)
    expect(xml).not.toContain('fontFamily=""')
    expect(xml).not.toMatch(/fontFamily="(?!null")[^"]/i)
    for (const attrs of markAttrs) {
      expect(attrs.fontFamily, `fontFamily should be null, got ${JSON.stringify(attrs.fontFamily)}`).toBeNull()
    }
  })

  it('flag OFF: a comment-in-name `font` shorthand leaks no family but keeps its size', async () => {
    const { xml, markAttrs } = await pasteIntoYDocFragment(commentShorthand, false)
    expect(xml).not.toMatch(/fontFamily="(?!null")[^"]/i)
    expect(xml).not.toContain('fontFamily=""')
    expect(xml).toMatch(/fontSize="14px"/)
    for (const attrs of markAttrs) {
      expect(attrs.fontFamily).toBeNull()
    }
  })

  it('flag ON: the trailing-comment font-family still resolves and reaches the Y.Doc (not a read gate)', async () => {
    const { xml } = await pasteIntoYDocFragment(commentTrailing, true)
    expect(xml).toMatch(/fontFamily="Georgia, serif"/)
  })
})


