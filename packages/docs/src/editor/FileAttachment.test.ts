import { describe, it, expect, afterEach } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import { DOMSerializer, DOMParser as PMDOMParser, type Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { FileAttachment, formatBytes } from './FileAttachment.ts'
import { OctoImage } from './ImageNode.ts'

// The `fileAttachment` node (SCHEMA-SPEC §15) must be byte-aligned to the backend node: the
// EXACT attr set { attachId, fileName, mime, sizeBytes }, round-tripped through data-attach-id /
// data-file-name / data-mime / data-size-bytes, emitting each attribute only when non-null.
// We build the ProseMirror schema straight from the extension (no live editor / NodeView /
// network) and exercise toDOM/parseDOM via DOMSerializer / DOMParser.
function buildSchema() {
  return getSchema([
    StarterKit.configure({ undoRedo: false, codeBlock: false }),
    FileAttachment.configure({ docId: 'd_test' }),
  ])
}

function findNode(doc: PMNode): PMNode | null {
  let found: PMNode | null = null
  doc.descendants((n) => {
    if (n.type.name === 'fileAttachment') found = n
  })
  return found
}

describe('fileAttachment node — backend byte-alignment (SCHEMA-SPEC §15)', () => {
  const schema = buildSchema()
  const type = schema.nodes.fileAttachment

  it('is registered as an atom block node', () => {
    expect(type).toBeDefined()
    expect(type.isAtom).toBe(true)
    expect(type.isInline).toBe(false)
    expect(type.spec.group).toContain('block')
  })

  it('declares EXACTLY {attachId, fileName, mime, sizeBytes}, all defaulting to null', () => {
    expect(Object.keys(type.spec.attrs ?? {}).sort()).toEqual(
      ['attachId', 'fileName', 'mime', 'sizeBytes'].sort(),
    )
    for (const attr of ['attachId', 'fileName', 'mime', 'sizeBytes']) {
      expect(type.spec.attrs?.[attr].default).toBe(null)
    }
  })

  it('toDOM emits data-* attrs and only non-null attributes (camelCase never leaks)', () => {
    const node = type.create({
      attachId: 'att_1',
      fileName: 'report.pdf',
      mime: 'application/pdf',
      sizeBytes: null,
    })
    const dom = DOMSerializer.fromSchema(schema).serializeNode(node) as HTMLElement
    expect(dom.tagName).toBe('DIV')
    expect(dom.getAttribute('data-attach-id')).toBe('att_1')
    expect(dom.getAttribute('data-file-name')).toBe('report.pdf')
    expect(dom.getAttribute('data-mime')).toBe('application/pdf')
    // Null sizeBytes is NOT emitted.
    expect(dom.hasAttribute('data-size-bytes')).toBe(false)
    // The camelCase attr names never appear as HTML attributes.
    expect(dom.hasAttribute('attachId')).toBe(false)
    expect(dom.hasAttribute('sizeBytes')).toBe(false)
    // Round-trip marker so parseHTML matches.
    expect(dom.hasAttribute('data-file-attachment')).toBe(true)
  })

  it('parseDOM reads data-* back into the camelCase attrs (sizeBytes as a number)', () => {
    const html =
      '<div data-file-attachment data-attach-id="att_2" data-file-name="a.zip" data-mime="application/zip" data-size-bytes="2048"></div>'
    const container = document.createElement('div')
    container.innerHTML = html
    const node = findNode(PMDOMParser.fromSchema(schema).parse(container))
    expect(node).not.toBeNull()
    expect(node!.attrs).toEqual({
      attachId: 'att_2',
      fileName: 'a.zip',
      mime: 'application/zip',
      sizeBytes: 2048,
    })
    expect(typeof node!.attrs.sizeBytes).toBe('number')
  })

  it('parseDOM yields null sizeBytes for a missing or non-numeric data-size-bytes', () => {
    const container = document.createElement('div')
    container.innerHTML =
      '<div data-file-attachment data-attach-id="att_3" data-size-bytes="not-a-number"></div>'
    const node = findNode(PMDOMParser.fromSchema(schema).parse(container))
    expect(node!.attrs.sizeBytes).toBe(null)
  })

  it('round-trips toDOM -> parseDOM byte-identically', () => {
    const original = type.create({
      attachId: 'att_rt',
      fileName: 'design spec.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 1536,
    })
    const dom = DOMSerializer.fromSchema(schema).serializeNode(original) as HTMLElement
    const container = document.createElement('div')
    container.appendChild(dom)
    const reparsed = findNode(PMDOMParser.fromSchema(schema).parse(container))
    expect(reparsed).not.toBeNull()
    expect(reparsed!.attrs).toEqual(original.attrs)
  })
})

describe('setFileAttachment command — selection handling (XIN-144)', () => {
  // The original bug: after an image is uploaded its atom node stays selected (a
  // NodeSelection). Inserting a file then ran a plain insertContent, which REPLACES the
  // selected node — so the file silently deleted the image (gone before reload). The fix
  // inserts the card AFTER a selected node, preserving the image.
  let editor: Editor | null = null
  afterEach(() => {
    editor?.destroy()
    editor = null
  })

  function makeEditor(): Editor {
    return new Editor({
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        // uploads:false skips the paste/drop plugin; no network is touched because the
        // image node carries a plain src and no attachId (attachId would trigger a read).
        OctoImage.configure({ docId: 'd_test', uploads: false }),
        FileAttachment.configure({ docId: 'd_test' }),
      ],
      content: '<p>hello</p>',
    })
  }

  function imagePos(ed: Editor): number {
    let pos = -1
    ed.state.doc.descendants((n, p) => {
      if (n.type.name === 'image') pos = p
    })
    return pos
  }

  function countNodes(ed: Editor, name: string): number {
    let n = 0
    ed.state.doc.descendants((node) => {
      if (node.type.name === name) n++
    })
    return n
  }

  const FILE_ATTRS = {
    attachId: 'att_file',
    fileName: 'spec.pdf',
    mime: 'application/pdf',
    sizeBytes: 1024,
  }

  it('inserts the file AFTER a selected image instead of replacing it', () => {
    editor = makeEditor()
    // Insert an image (no attachId → no network) and select its atom node, reproducing
    // the post-upload state where the image stays selected.
    editor
      .chain()
      .focus()
      .insertContent({ type: 'image', attrs: { src: 'https://cdn.example/x.png', alt: null } })
      .run()
    const pos = imagePos(editor)
    expect(pos).toBeGreaterThanOrEqual(0)
    editor.commands.setNodeSelection(pos)
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)

    editor.chain().focus().setFileAttachment(FILE_ATTRS).run()

    // The image survives AND the file card is added — the bug would leave 0 images.
    expect(countNodes(editor, 'image')).toBe(1)
    expect(countNodes(editor, 'fileAttachment')).toBe(1)
  })

  it('still inserts at a plain text cursor (non-NodeSelection unaffected)', () => {
    editor = makeEditor()
    editor.chain().focus().setTextSelection(1).run()
    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection)

    editor.chain().focus().setFileAttachment(FILE_ATTRS).run()

    expect(countNodes(editor, 'fileAttachment')).toBe(1)
  })
})

describe('formatBytes — human-readable file size', () => {
  it('keeps sub-1024 values in bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(3)).toBe('3 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('steps up to KB / MB / GB', () => {
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024)).toBe('1 MB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB')
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB')
  })

  it('rounds to one decimal under 10 and whole numbers at/above 10', () => {
    expect(formatBytes(12.4 * 1024 * 1024)).toBe('12 MB')
    expect(formatBytes(2.345 * 1024)).toBe('2.3 KB')
  })

  it('returns empty string for null / negative / non-finite sizes (card omits the chip)', () => {
    expect(formatBytes(null)).toBe('')
    expect(formatBytes(undefined)).toBe('')
    expect(formatBytes(-1)).toBe('')
    expect(formatBytes(Number.NaN)).toBe('')
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('')
  })
})
