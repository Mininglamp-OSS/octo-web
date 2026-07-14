import { describe, it, expect } from 'vitest'
import { getSchema } from '@tiptap/core'
import { Editor } from '@tiptap/core'
import { buildPreviewExtensions } from './extensions.ts'
import { LineHeight, sanitizeLineHeight, sanitizeSpacing } from './LineHeight.ts'

// v17 (SCHEMA-SPEC §17): heading/paragraph gain the lineHeight + spaceBefore +
// spaceAfter global attrs. They ride the SAME inline `style` string as the v5
// textAlign attr; the frontend must reproduce the backend `setBlockAttrs`
// canonical serialization VERBATIM (docs-backend PR #67):
//   - only non-null attrs are emitted,
//   - fixed order [text-align, line-height, margin-top, margin-bottom],
//   - each `prop: value` (single space after the colon), joined by `"; "`,
//   - NO trailing semicolon.
// Every value is whitelist-sanitized at BOTH parse and render.
describe('Schema v17 block-spacing attrs (lineHeight / spaceBefore / spaceAfter)', () => {
  const schema = getSchema(buildPreviewExtensions('doc-test'))

  // Serialize a node's toDOM the same way the backend test does — read the merged
  // `style` string off the emitted DOM spec.
  function toDOMStyle(
    nodeName: 'paragraph' | 'heading',
    attrs: Record<string, unknown>,
  ): string | undefined {
    const node = schema.nodes[nodeName].create(nodeName === 'heading' ? { level: 1, ...attrs } : attrs)
    const out = schema.nodes[nodeName].spec.toDOM!(node) as [string, Record<string, string>, number]
    return out[1].style
  }

  function parseStyle(
    nodeName: 'paragraph' | 'heading',
    style: Record<string, string>,
  ): Record<string, unknown> {
    const rule = schema.nodes[nodeName].spec.parseDOM!.find((r) =>
      nodeName === 'paragraph' ? r.tag === 'p' : r.tag === 'h1',
    )!
    const el = { style, getAttribute: () => null }
    return rule.getAttrs!(el as never) as Record<string, unknown>
  }

  it('registers the three attrs (default null) on paragraph and heading', () => {
    for (const name of ['paragraph', 'heading'] as const) {
      const attrs = schema.nodes[name].spec.attrs!
      expect(attrs.lineHeight?.default).toBe(null)
      expect(attrs.spaceBefore?.default).toBe(null)
      expect(attrs.spaceAfter?.default).toBe(null)
    }
  })

  it('serializes all four block attrs into ONE style string in the canonical order', () => {
    expect(
      toDOMStyle('paragraph', {
        textAlign: 'right',
        lineHeight: '2',
        spaceBefore: '8px',
        spaceAfter: '12px',
      }),
    ).toBe('text-align: right; line-height: 2; margin-top: 8px; margin-bottom: 12px')
  })

  it('keeps the canonical order on heading too', () => {
    expect(
      toDOMStyle('heading', {
        textAlign: 'center',
        lineHeight: '1.5',
        spaceBefore: '4px',
        spaceAfter: '6px',
      }),
    ).toBe('text-align: center; line-height: 1.5; margin-top: 4px; margin-bottom: 6px')
  })

  it('emits only the set declarations (line-height alone)', () => {
    expect(toDOMStyle('paragraph', { lineHeight: '1.5' })).toBe('line-height: 1.5')
  })

  it('omits the style attr entirely when every block attr is the null default', () => {
    expect(toDOMStyle('paragraph', {})).toBeUndefined()
  })

  it('keeps textAlign-only output byte-identical to the v5 behavior', () => {
    expect(toDOMStyle('paragraph', { textAlign: 'center' })).toBe('text-align: center')
  })

  it('drops text-align but keeps the rest in order when alignment is null', () => {
    expect(toDOMStyle('paragraph', { lineHeight: '2', spaceAfter: '16px' })).toBe(
      'line-height: 2; margin-bottom: 16px',
    )
  })

  it('parses the block attrs back off an element style', () => {
    expect(
      parseStyle('paragraph', {
        lineHeight: '1.5',
        marginTop: '8px',
        marginBottom: '12px',
      }),
    ).toMatchObject({ lineHeight: '1.5', spaceBefore: '8px', spaceAfter: '12px' })
  })

  it('rejects hostile / out-of-range values at parse (falls back to null default)', () => {
    // Each attr's parseHTML returns null for a hostile value, so the key is simply
    // absent from the parsed attrs and the schema default (null) applies.
    const parsed = parseStyle('paragraph', {
      lineHeight: '999); background:url(x',
      marginTop: '10000px',
      marginBottom: 'calc(100% + 1px)',
    })
    expect(parsed.lineHeight ?? null).toBe(null)
    expect(parsed.spaceBefore ?? null).toBe(null)
    expect(parsed.spaceAfter ?? null).toBe(null)
  })

  it('never serializes a hostile value back out (render-side sanitize)', () => {
    expect(
      toDOMStyle('paragraph', { lineHeight: '1); evil', spaceBefore: 'javascript:1' }),
    ).toBeUndefined()
  })
})

// The sanitizers are the byte-align contract with the backend, so pin their exact
// accept/reject behavior (mirrors docs-backend `sanitizeLineHeight`/`sanitizeSpacing`).
describe('v17 sanitizers (byte-aligned to docs-backend #67)', () => {
  it('accepts a bare positive multiplier in (0, 10] for lineHeight', () => {
    expect(sanitizeLineHeight('1.5')).toBe('1.5')
    expect(sanitizeLineHeight('  2  ')).toBe('2')
    expect(sanitizeLineHeight('10')).toBe('10')
  })

  it('rejects out-of-range / non-numeric / unit-bearing lineHeight', () => {
    expect(sanitizeLineHeight('0')).toBe(null)
    expect(sanitizeLineHeight('10.1')).toBe(null)
    expect(sanitizeLineHeight('1.5px')).toBe(null)
    expect(sanitizeLineHeight('-1')).toBe(null)
    expect(sanitizeLineHeight('abc')).toBe(null)
    expect(sanitizeLineHeight(1.5 as unknown)).toBe(null)
  })

  it('accepts a non-negative px/em length ≤ 1000 for spacing', () => {
    expect(sanitizeSpacing('8px')).toBe('8px')
    expect(sanitizeSpacing('0em')).toBe('0em')
    expect(sanitizeSpacing('  12.5px ')).toBe('12.5px')
    expect(sanitizeSpacing('1000px')).toBe('1000px')
  })

  it('rejects out-of-range / unit-less / hostile spacing', () => {
    expect(sanitizeSpacing('1001px')).toBe(null)
    expect(sanitizeSpacing('8')).toBe(null)
    expect(sanitizeSpacing('8%')).toBe(null)
    expect(sanitizeSpacing('calc(100% + 1px)')).toBe(null)
    expect(sanitizeSpacing('-4px')).toBe(null)
  })
})

// The set/unset commands drive the toolbar. Round-trip a value through a real
// editor and assert both the node attr and the serialized HTML style.
describe('v17 LineHeight commands + round-trip', () => {
  function makeEditor() {
    return new Editor({
      extensions: buildPreviewExtensions('doc-test').filter(
        // buildPreviewExtensions is editable:false-oriented but works for command tests;
        // keep all extensions so LineHeight sits after TextAlign as in production.
        () => true,
      ),
      content: '<p>hello</p>',
    })
  }

  it('exposes the set/unset commands', () => {
    const editor = makeEditor()
    expect(typeof editor.commands.setLineHeight).toBe('function')
    expect(typeof editor.commands.unsetLineHeight).toBe('function')
    editor.destroy()
  })

  it('sets line-height on the current paragraph and serializes the canonical style', () => {
    const editor = makeEditor()
    editor.commands.selectAll()
    editor.commands.setLineHeight('1.5')
    expect(editor.getAttributes('paragraph').lineHeight).toBe('1.5')
    // The toDOM style value is byte-exact `line-height: 1.5` (asserted directly in the
    // schema block above); getHTML's DOM-string form only differs by jsdom/browser
    // cssText normalization (a trailing ";"), which never touches the Y.Doc round-trip.
    expect(editor.getHTML()).toContain('line-height: 1.5')
    editor.destroy()
  })

  it('refuses an out-of-whitelist line-height (no attr written)', () => {
    const editor = makeEditor()
    editor.commands.selectAll()
    const ok = editor.commands.setLineHeight('999')
    expect(ok).toBe(false)
    expect(editor.getAttributes('paragraph').lineHeight ?? null).toBe(null)
    editor.destroy()
  })

  it('round-trips a full block-spacing set through parse → serialize', () => {
    const editor = makeEditor()
    editor.commands.setContent(
      '<p style="text-align: right; line-height: 2; margin-top: 8px; margin-bottom: 12px">x</p>',
    )
    expect(editor.getAttributes('paragraph')).toMatchObject({
      textAlign: 'right',
      lineHeight: '2',
      spaceBefore: '8px',
      spaceAfter: '12px',
    })
    expect(editor.getHTML()).toContain(
      'text-align: right; line-height: 2; margin-top: 8px; margin-bottom: 12px',
    )
    editor.destroy()
  })

  it('is registered by the extension name lineHeight', () => {
    expect(LineHeight.name).toBe('lineHeight')
  })
})
