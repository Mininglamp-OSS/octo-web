import { describe, it, expect } from 'vitest'
import { getSchema } from '@tiptap/core'
import { DOMSerializer, DOMParser as PMDOMParser, type Node as PMNode } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { Bookmark } from './Bookmark.ts'

// The `bookmark` node (SCHEMA-SPEC §15) must be byte-aligned to the backend node: the EXACT
// attr set { url, title, description, image, siteName, fetchedAt }, round-tripped through
// data-url / data-title / data-description / data-image / data-site-name / data-fetched-at,
// emitting each attribute only when non-null. url/image pass through the bookmark scheme
// whitelist (http/https only) at BOTH the parse and render boundary.
function buildSchema() {
  return getSchema([
    StarterKit.configure({ undoRedo: false, codeBlock: false }),
    Bookmark.configure({ docId: 'd_test' }),
  ])
}

function findNode(doc: PMNode): PMNode | null {
  let found: PMNode | null = null
  doc.descendants((n) => {
    if (n.type.name === 'bookmark') found = n
  })
  return found
}

describe('bookmark node — backend byte-alignment (SCHEMA-SPEC §15)', () => {
  const schema = buildSchema()
  const type = schema.nodes.bookmark

  it('is registered as an atom block node', () => {
    expect(type).toBeDefined()
    expect(type.isAtom).toBe(true)
    expect(type.isInline).toBe(false)
    expect(type.spec.group).toContain('block')
  })

  it('declares EXACTLY {url, title, description, image, siteName, fetchedAt}, all defaulting to null', () => {
    expect(Object.keys(type.spec.attrs ?? {}).sort()).toEqual(
      ['description', 'fetchedAt', 'image', 'siteName', 'title', 'url'].sort(),
    )
    for (const attr of ['url', 'title', 'description', 'image', 'siteName', 'fetchedAt']) {
      expect(type.spec.attrs?.[attr].default).toBe(null)
    }
  })

  it('toDOM emits data-* attrs and only non-null attributes', () => {
    const node = type.create({
      url: 'https://example.com/post',
      title: 'Title',
      description: null,
      image: 'https://img.example.com/og.png',
      siteName: 'Example',
      fetchedAt: '2026-06-23T10:00:00Z',
    })
    const dom = DOMSerializer.fromSchema(schema).serializeNode(node) as HTMLElement
    expect(dom.getAttribute('data-url')).toBe('https://example.com/post')
    expect(dom.getAttribute('data-title')).toBe('Title')
    expect(dom.getAttribute('data-image')).toBe('https://img.example.com/og.png')
    expect(dom.getAttribute('data-site-name')).toBe('Example')
    expect(dom.getAttribute('data-fetched-at')).toBe('2026-06-23T10:00:00Z')
    expect(dom.hasAttribute('data-description')).toBe(false)
    expect(dom.hasAttribute('data-bookmark')).toBe(true)
  })

  it('round-trips toDOM -> parseDOM byte-identically', () => {
    const original = type.create({
      url: 'https://example.com/a',
      title: 'A title',
      description: 'A description',
      image: 'https://img.example.com/a.png',
      siteName: 'Site',
      fetchedAt: '2026-06-23T10:00:00Z',
    })
    const dom = DOMSerializer.fromSchema(schema).serializeNode(original) as HTMLElement
    const container = document.createElement('div')
    container.appendChild(dom)
    const reparsed = findNode(PMDOMParser.fromSchema(schema).parse(container))
    expect(reparsed).not.toBeNull()
    expect(reparsed!.attrs).toEqual(original.attrs)
  })

  it('sanitizes url/image at the parse boundary (javascript: → null, no entry into the Y.Doc)', () => {
    const container = document.createElement('div')
    container.innerHTML =
      '<div data-bookmark data-url="javascript:alert(1)" data-image="data:image/png;base64,xx" data-title="t"></div>'
    const node = findNode(PMDOMParser.fromSchema(schema).parse(container))
    expect(node).not.toBeNull()
    expect(node!.attrs.url).toBe(null)
    expect(node!.attrs.image).toBe(null)
    expect(node!.attrs.title).toBe('t')
  })

  it('renderHTML drops an unsafe url so serialization never leaks it', () => {
    const node = type.create({ url: 'javascript:alert(1)', title: 'x' })
    const dom = DOMSerializer.fromSchema(schema).serializeNode(node) as HTMLElement
    expect(dom.hasAttribute('data-url')).toBe(false)
    expect(dom.getAttribute('data-title')).toBe('x')
  })
})
