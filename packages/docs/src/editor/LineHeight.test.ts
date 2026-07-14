import { describe, it, expect } from 'vitest'
import { getSchema } from '@tiptap/core'
import { DOMSerializer, DOMParser as PMDOMParser, type Node as PMNode } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { LineHeight, sanitizeLineHeight, sanitizeSpacing } from './LineHeight.ts'

// The v17 line-spacing attrs (lineHeight + spaceBefore/spaceAfter) must byte-align with the
// backend toDOM: they ride on a single inline `style` declaration, each emitted only when set,
// values sanitised at both parse and render. We build the ProseMirror schema straight from the
// extensions (no live editor) and exercise renderHTML/parseHTML via DOMSerializer / DOMParser.
// TextAlign is registered BEFORE LineHeight so the canonical property order holds:
//   text-align: <a>; line-height: <lh>; margin-top: <mt>; margin-bottom: <mb>
function buildSchema() {
  return getSchema([
    StarterKit.configure({ undoRedo: false, codeBlock: false }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    LineHeight,
  ])
}

/** Property names in the order they appear in an inline style string. */
function styleOrder(dom: HTMLElement): string[] {
  return (dom.getAttribute('style') ?? '')
    .split(';')
    .map((d) => d.split(':')[0]?.trim())
    .filter((p): p is string => Boolean(p))
}

describe('sanitizeLineHeight', () => {
  it('accepts bare unitless multipliers in range', () => {
    for (const v of ['1', '1.15', '1.5', '2', '3.25']) expect(sanitizeLineHeight(v)).toBe(v)
    expect(sanitizeLineHeight(' 1.5 ')).toBe('1.5')
  })
  it('rejects units, non-numeric, out-of-range, and injection attempts', () => {
    for (const v of ['1.5px', '1.5em', '', 'abc', '0', '-1', '11', '1;color:red', 'expression(1)']) {
      expect(sanitizeLineHeight(v)).toBe(null)
    }
    expect(sanitizeLineHeight(1.5)).toBe(null) // must be a string
    expect(sanitizeLineHeight(null)).toBe(null)
  })
})

describe('sanitizeSpacing', () => {
  it('accepts non-negative px/em lengths', () => {
    for (const v of ['0px', '12px', '1.5em', '0.25em']) expect(sanitizeSpacing(v)).toBe(v)
    expect(sanitizeSpacing(' 8px ')).toBe('8px')
  })
  it('rejects other units, bare numbers, and injection attempts', () => {
    for (const v of ['12', '12pt', '2rem', '10%', '12px;color:red', 'auto', '']) {
      expect(sanitizeSpacing(v)).toBe(null)
    }
    expect(sanitizeSpacing(12)).toBe(null)
  })
  // <=1000 cap parity with the backend schema sanitizer: values whose magnitude
  // exceeds 1000 are rejected to null (same reject — not clamp — semantics).
  it('accepts values at the 1000 cap', () => {
    expect(sanitizeSpacing('1000px')).toBe('1000px')
    expect(sanitizeSpacing('1000em')).toBe('1000em')
  })
  it('rejects values whose magnitude exceeds 1000', () => {
    for (const v of ['1001px', '1000.5px', '1200em', '5000px']) {
      expect(sanitizeSpacing(v)).toBe(null)
    }
  })
})

describe('LineHeight extension — schema shape + backend byte-alignment (SCHEMA_VERSION 17)', () => {
  const schema = buildSchema()

  it('registers lineHeight/spaceBefore/spaceAfter on heading + paragraph, defaulting to null', () => {
    for (const nodeName of ['paragraph', 'heading']) {
      for (const attr of ['lineHeight', 'spaceBefore', 'spaceAfter']) {
        expect(schema.nodes[nodeName].spec.attrs?.[attr], `${nodeName}.${attr}`).toBeDefined()
        expect(schema.nodes[nodeName].spec.attrs?.[attr].default).toBe(null)
      }
    }
  })

  it('toDOM emits each attr as the documented CSS declaration (correct units)', () => {
    const node = schema.nodes.paragraph.create({
      textAlign: 'center',
      lineHeight: '1.5',
      spaceBefore: '12px',
      spaceAfter: '8px',
    })
    const dom = DOMSerializer.fromSchema(schema).serializeNode(node) as HTMLElement
    expect(dom.style.textAlign).toBe('center')
    expect(dom.style.lineHeight).toBe('1.5')
    expect(dom.style.marginTop).toBe('12px')
    expect(dom.style.marginBottom).toBe('8px')
  })

  it('serialises the four style props in the canonical order (byte-alignment contract)', () => {
    const node = schema.nodes.paragraph.create({
      textAlign: 'center',
      lineHeight: '1.5',
      spaceBefore: '12px',
      spaceAfter: '8px',
    })
    const dom = DOMSerializer.fromSchema(schema).serializeNode(node) as HTMLElement
    expect(styleOrder(dom)).toEqual(['text-align', 'line-height', 'margin-top', 'margin-bottom'])
  })

  it('omits style for null attrs (old docs round-trip losslessly)', () => {
    const node = schema.nodes.paragraph.create({ lineHeight: '2' })
    const dom = DOMSerializer.fromSchema(schema).serializeNode(node) as HTMLElement
    expect(dom.style.lineHeight).toBe('2')
    expect(dom.style.marginTop).toBe('')
    expect(dom.style.marginBottom).toBe('')

    const plain = schema.nodes.paragraph.create()
    const plainDom = DOMSerializer.fromSchema(schema).serializeNode(plain) as HTMLElement
    expect(plainDom.hasAttribute('style')).toBe(false)
  })

  it('drops an invalid value at render time (sanitise on render)', () => {
    const node = schema.nodes.paragraph.create({ lineHeight: '1;color:red', spaceBefore: '9pt' })
    const dom = DOMSerializer.fromSchema(schema).serializeNode(node) as HTMLElement
    expect(dom.style.lineHeight).toBe('')
    expect(dom.style.marginTop).toBe('')
  })

  it('round-trips toDOM -> parseDOM with identical attrs', () => {
    const original = schema.nodes.paragraph.create({
      textAlign: 'right',
      lineHeight: '1.15',
      spaceBefore: '1.5em',
      spaceAfter: '0.5em',
    })
    const dom = DOMSerializer.fromSchema(schema).serializeNode(original) as HTMLElement
    const container = document.createElement('div')
    container.appendChild(dom)
    let reparsed: PMNode | null = null
    PMDOMParser.fromSchema(schema)
      .parse(container)
      .descendants((n) => {
        if (n.type.name === 'paragraph') reparsed = n
      })
    expect(reparsed).not.toBeNull()
    expect(reparsed!.attrs.lineHeight).toBe('1.15')
    expect(reparsed!.attrs.spaceBefore).toBe('1.5em')
    expect(reparsed!.attrs.spaceAfter).toBe('0.5em')
    expect(reparsed!.attrs.textAlign).toBe('right')
  })

  it('parseDOM rejects a malicious style value back to null', () => {
    const container = document.createElement('div')
    container.innerHTML = '<p style="line-height: 99; margin-top: 5pt">x</p>'
    let reparsed: PMNode | null = null
    PMDOMParser.fromSchema(schema)
      .parse(container)
      .descendants((n) => {
        if (n.type.name === 'paragraph') reparsed = n
      })
    // 99 is out of the sane multiplier range and 5pt is not px|em → both null.
    expect(reparsed!.attrs.lineHeight).toBe(null)
    expect(reparsed!.attrs.spaceBefore).toBe(null)
  })
})
