import { describe, it, expect } from 'vitest'
import { getSchema } from '@tiptap/core'
import { DOMSerializer, DOMParser as PMDOMParser, type Node as PMNode } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { OctoImage } from './ImageNode.ts'

// The `image` node (SCHEMA-SPEC §2) must be byte-aligned to the backend node: same
// camelCase attr set, same parseDOM/toDOM HTML mapping (data-attach-id ↔ attachId,
// data-align ↔ align), and the same "emit each attribute only when its value != null"
// rule. Drift here loses content when the backend Agent layer round-trips the doc.
//
// We build the ProseMirror schema straight from the extensions (no live editor /
// NodeView / network) and exercise toDOM/parseDOM via DOMSerializer / DOMParser.
function buildSchema() {
  return getSchema([
    StarterKit.configure({ undoRedo: false, codeBlock: false }),
    OctoImage.configure({ docId: 'd_test' }),
  ])
}

function findImage(doc: PMNode): PMNode | null {
  let found: PMNode | null = null
  doc.descendants((n) => {
    if (n.type.name === 'image') found = n
  })
  return found
}

describe('image node — backend byte-alignment (SCHEMA-SPEC §2)', () => {
  const schema = buildSchema()
  const imageType = schema.nodes.image

  it('is registered as an atom block node', () => {
    expect(imageType).toBeDefined()
    expect(imageType.isAtom).toBe(true)
    expect(imageType.isInline).toBe(false)
    expect(imageType.spec.group).toContain('block')
  })

  it('declares exactly {attachId, src, alt, title, width, align}, all defaulting to null', () => {
    expect(Object.keys(imageType.spec.attrs ?? {}).sort()).toEqual(
      ['align', 'alt', 'attachId', 'src', 'title', 'width'].sort(),
    )
    for (const attr of ['attachId', 'src', 'alt', 'title', 'width', 'align']) {
      expect(imageType.spec.attrs?.[attr].default).toBe(null)
    }
  })

  it('toDOM emits data-attach-id / data-align and only non-null attributes', () => {
    const node = imageType.create({
      attachId: 'att_1',
      src: 'https://assets.octo.example.com/x.png',
      alt: 'hello',
      title: null,
      width: null,
      align: 'center',
    })
    const dom = DOMSerializer.fromSchema(schema).serializeNode(node) as HTMLElement
    expect(dom.tagName).toBe('IMG')
    expect(dom.getAttribute('data-attach-id')).toBe('att_1')
    expect(dom.getAttribute('src')).toBe('https://assets.octo.example.com/x.png')
    expect(dom.getAttribute('alt')).toBe('hello')
    expect(dom.getAttribute('data-align')).toBe('center')
    // Null-valued attributes are NOT emitted (matches the backend toDOM rule).
    expect(dom.hasAttribute('title')).toBe(false)
    expect(dom.hasAttribute('width')).toBe(false)
    // The camelCase attr names never leak into HTML.
    expect(dom.hasAttribute('attachId')).toBe(false)
    expect(dom.hasAttribute('align')).toBe(false)
  })

  it('parseDOM reads data-attach-id / data-align back into camelCase attrs', () => {
    const html =
      '<img data-attach-id="att_2" src="https://cdn.octo.example.com/y.jpg" alt="a" data-align="right">'
    const container = document.createElement('div')
    container.innerHTML = html
    const doc = PMDOMParser.fromSchema(schema).parse(container)
    const img = findImage(doc)
    expect(img).not.toBeNull()
    expect(img!.attrs).toEqual({
      attachId: 'att_2',
      src: 'https://cdn.octo.example.com/y.jpg',
      alt: 'a',
      title: null,
      width: null,
      align: 'right',
    })
  })

  it('also matches an <img> carrying only data-attach-id (no src)', () => {
    const container = document.createElement('div')
    container.innerHTML = '<img data-attach-id="att_3">'
    const doc = PMDOMParser.fromSchema(schema).parse(container)
    const img = findImage(doc)
    expect(img).not.toBeNull()
    expect(img!.attrs.attachId).toBe('att_3')
    expect(img!.attrs.src).toBe(null)
  })

  it('round-trips toDOM -> parseDOM byte-identically', () => {
    const original = imageType.create({
      attachId: 'att_rt',
      src: 'https://assets.octo.example.com/rt.png',
      alt: 'round trip',
      title: 'a title',
      width: '320',
      align: 'center',
    })
    const dom = DOMSerializer.fromSchema(schema).serializeNode(original) as HTMLElement
    const container = document.createElement('div')
    container.appendChild(dom)
    const reparsed = findImage(PMDOMParser.fromSchema(schema).parse(container))
    expect(reparsed).not.toBeNull()
    expect(reparsed!.attrs).toEqual(original.attrs)
  })
})

// The src whitelist MUST run at BOTH the schema parse boundary and the render
// boundary, not only in the NodeView display layer (sanitize.ts: "a miss in
// either is bypassable"). Otherwise a `data:` URL parsed in via remote collab
// content / setContent / programmatic insert / direct load would land base64 in
// the Y.Doc (violates "base64 never enters the Y.Doc"), and an off-whitelist host
// rendered out (getHTML / collab serialization) would leak an unvetted URL.
describe('image node — src sanitized at the schema boundary (no base64, no hotlink)', () => {
  const schema = buildSchema()
  const imageType = schema.nodes.image

  it('parseDOM drops a data: src to null (base64 cannot enter the doc)', () => {
    const container = document.createElement('div')
    container.innerHTML =
      '<img data-attach-id="att_b64" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==">'
    const doc = PMDOMParser.fromSchema(schema).parse(container)
    const img = findImage(doc)
    expect(img).not.toBeNull()
    expect(img!.attrs.src).toBe(null) // data: rejected
    expect(img!.attrs.attachId).toBe('att_b64') // durable reference still kept
  })

  it('parseDOM drops an off-whitelist external host to null (no hotlink)', () => {
    const container = document.createElement('div')
    container.innerHTML = '<img src="https://evil.example.com/x.png" data-attach-id="att_ext">'
    const doc = PMDOMParser.fromSchema(schema).parse(container)
    const img = findImage(doc)
    expect(img).not.toBeNull()
    expect(img!.attrs.src).toBe(null)
  })

  it('renderHTML drops an unvetted src so getHTML / collab serialization never leaks it', () => {
    // A node whose src somehow holds an off-whitelist URL (e.g. injected via a raw
    // attrs path) must NOT serialize that URL back out.
    const node = imageType.create({ attachId: 'att_r', src: 'https://evil.example.com/x.png' })
    const dom = DOMSerializer.fromSchema(schema).serializeNode(node) as HTMLElement
    expect(dom.hasAttribute('src')).toBe(false)
    expect(dom.getAttribute('data-attach-id')).toBe('att_r')
  })

  it('renderHTML drops a data: src so base64 never leaves via serialization', () => {
    const node = imageType.create({
      attachId: 'att_rb',
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    })
    const dom = DOMSerializer.fromSchema(schema).serializeNode(node) as HTMLElement
    expect(dom.hasAttribute('src')).toBe(false)
  })

  it('keeps a whitelisted storage src through both parse and render', () => {
    const good = 'https://assets.octo.example.com/ok.png'
    const container = document.createElement('div')
    container.innerHTML = `<img src="${good}">`
    const img = findImage(PMDOMParser.fromSchema(schema).parse(container))
    expect(img!.attrs.src).toBe(good)
    const dom = DOMSerializer.fromSchema(schema).serializeNode(img!) as HTMLElement
    expect(dom.getAttribute('src')).toBe(good)
  })
})
