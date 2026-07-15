import { describe, it, expect } from 'vitest'
import { getSchema } from '@tiptap/core'
import { DOMParser as PMDOMParser, DOMSerializer } from '@tiptap/pm/model'
import { createDocsLowlight, buildPreviewExtensions } from './extensions.ts'
import { SCHEMA_NODES, SCHEMA_MARKS } from '../schema/index.ts'

// Code-block syntax highlighting (P1a). The editor registers CodeBlockLowlight
// with a lowlight instance built from highlight.js' `common` language set, while
// StarterKit's plain codeBlock is disabled to avoid a duplicate same-name node.
// These assertions guard that the registry actually carries the common grammars
// used in code blocks (otherwise highlighting silently falls back to plain text).
describe('docs lowlight registry (code-block syntax highlighting)', () => {
  it('registers the common programming languages', () => {
    const lowlight = createDocsLowlight()
    const langs = lowlight.listLanguages()
    for (const lang of ['javascript', 'typescript', 'python', 'json', 'bash', 'css']) {
      expect(langs).toContain(lang)
    }
  })

  it('highlights a known language into hljs token nodes', () => {
    const lowlight = createDocsLowlight()
    const tree = lowlight.highlight('javascript', 'const x = 1')
    // The highlighted tree should contain at least one hljs-* token element.
    const hasToken = JSON.stringify(tree).includes('hljs-')
    expect(hasToken).toBe(true)
  })

  it('reports unregistered languages as not registered (extension falls back to plain text)', () => {
    const lowlight = createDocsLowlight()
    // CodeBlockLowlight guards on registered() before highlighting, so an unknown
    // language degrades to plain text rather than highlighting.
    expect(lowlight.registered('not-a-real-language')).toBe(false)
    expect(lowlight.registered('javascript')).toBe(true)
  })
})

// The Y.Doc only round-trips nodes/marks that the editor actually registers, so the
// SCHEMA_NODES / SCHEMA_MARKS audit lists (schema/index.ts) MUST be a subset of what the
// extensions register. buildPreviewExtensions mirrors the live editor's schema without the
// collab/provider machinery, so we can derive the real ProseMirror schema from it directly.
describe('editor schema mirrors the schema audit lists', () => {
  const schema = getSchema(buildPreviewExtensions('doc-test'))
  const nodeNames = Object.keys(schema.nodes)
  const markNames = Object.keys(schema.marks)

  it('registers every node named in SCHEMA_NODES', () => {
    for (const n of SCHEMA_NODES) {
      expect(nodeNames, `missing node ${n}`).toContain(n)
    }
  })

  it('registers every mark named in SCHEMA_MARKS', () => {
    for (const m of SCHEMA_MARKS) {
      expect(markNames, `missing mark ${m}`).toContain(m)
    }
  })

  it('registers the batch-3 nodes (v9–v15)', () => {
    for (const n of [
      'emoji',
      'mention',
      'details',
      'detailsSummary',
      'detailsContent',
      'callout',
      'inlineMath',
      'blockMath',
      'fileAttachment',
      'bookmark',
    ]) {
      expect(schema.nodes[n], `node ${n} not registered`).toBeDefined()
    }
  })

  it('registers the batch-3 marks (v6, v8)', () => {
    for (const m of ['underline', 'superscript', 'subscript']) {
      expect(schema.marks[m], `mark ${m} not registered`).toBeDefined()
    }
  })

  it('adds the v5 textAlign attr to heading and paragraph (attr, not a node)', () => {
    expect(schema.nodes.paragraph.spec.attrs?.textAlign).toBeDefined()
    expect(schema.nodes.heading.spec.attrs?.textAlign).toBeDefined()
  })

  it('adds the v7 fontSize attr to the textStyle mark (attr, not a mark)', () => {
    expect(schema.marks.textStyle.spec.attrs?.fontSize).toBeDefined()
  })

  it('adds the v16 fontFamily attr to the textStyle mark (attr, not a mark)', () => {
    // Registered unconditionally in buildPreviewExtensions so the schema always round-trips the
    // attr; the toolbar entry that SETS it is what the FONT_FAMILY_ENABLED flag gates, not this.
    expect(schema.marks.textStyle.spec.attrs?.fontFamily).toBeDefined()
  })

  it('round-trips a fontFamily style through parseDOM/toDOM (v16)', () => {
    // The Y.Doc preserves whatever the ProseMirror schema parses+renders, so proving the DOM
    // round-trip here proves the collaborative round-trip: a <span style="font-family:…"> parses
    // into the textStyle fontFamily attr and renders back out to a font-family style.
    const stack = 'SimSun, serif'
    const dom = new window.DOMParser().parseFromString(
      `<p><span style="font-family: ${stack}">hi</span></p>`,
      'text/html',
    )
    const doc = PMDOMParser.fromSchema(schema).parse(dom.body)
    // The parsed text carries a textStyle mark whose fontFamily attr holds the stack.
    let parsedFamily: unknown
    doc.descendants((node) => {
      const mark = node.marks.find((m) => m.type.name === 'textStyle')
      if (mark) parsedFamily = mark.attrs.fontFamily
    })
    expect(typeof parsedFamily).toBe('string')
    expect(parsedFamily).toContain('SimSun')

    // Serializing back out emits the font-family style again (no strip).
    const out = DOMSerializer.fromSchema(schema).serializeFragment(doc.content, {
      document: window.document,
    })
    const holder = window.document.createElement('div')
    holder.appendChild(out)
    expect(holder.innerHTML).toContain('font-family')
    expect(holder.innerHTML).toContain('SimSun')
  })

  it('adds the v17 line-spacing attrs to heading and paragraph (attrs, not nodes)', () => {
    for (const attr of ['lineHeight', 'spaceBefore', 'spaceAfter']) {
      expect(schema.nodes.paragraph.spec.attrs?.[attr], `paragraph missing ${attr}`).toBeDefined()
      expect(schema.nodes.heading.spec.attrs?.[attr], `heading missing ${attr}`).toBeDefined()
    }
  })

  it('adds the v18 indent attr to heading and paragraph (attr, not a node), default null', () => {
    expect(schema.nodes.paragraph.spec.attrs?.indent).toBeDefined()
    expect(schema.nodes.heading.spec.attrs?.indent).toBeDefined()
    expect(schema.nodes.paragraph.spec.attrs?.indent?.default).toBe(null)
    expect(schema.nodes.heading.spec.attrs?.indent?.default).toBe(null)
  })

  it('does NOT add the indent attr to list items (list Tab/Shift-Tab stays untouched)', () => {
    expect(schema.nodes.listItem.spec.attrs?.indent).toBeUndefined()
  })
})
