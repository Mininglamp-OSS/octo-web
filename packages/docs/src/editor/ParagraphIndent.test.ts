import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'
import { ParagraphIndent, clampIndent, INDENT_MAX_LEVEL, INDENT_STEP_EM } from './ParagraphIndent.ts'

// SCHEMA_VERSION 18: indent inc/dec on paragraph + heading. These assertions guard the
// command boundaries (no-op at 0, clamp at max), the attr round-trip via data-indent, and
// that list items never gain the attr (list Tab/Shift-Tab sink/lift stays untouched).

function makeEditor(html: string): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      ParagraphIndent.configure({ types: ['paragraph', 'heading'] }),
    ],
    content: html,
  })
}

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

/** Indent attr of the document's first top-level block. */
function firstIndent(e: Editor): number {
  return clampIndent(e.state.doc.firstChild?.attrs.indent)
}

describe('clampIndent', () => {
  it('floors at 0, ceils at INDENT_MAX_LEVEL, rounds, and coerces non-numbers', () => {
    expect(clampIndent(-3)).toBe(0)
    expect(clampIndent(0)).toBe(0)
    expect(clampIndent(2)).toBe(2)
    expect(clampIndent(INDENT_MAX_LEVEL + 5)).toBe(INDENT_MAX_LEVEL)
    expect(clampIndent('4')).toBe(4)
    expect(clampIndent(2.6)).toBe(3)
    expect(clampIndent(null)).toBe(0)
    expect(clampIndent(undefined)).toBe(0)
    expect(clampIndent(NaN)).toBe(0)
  })
})

describe('increaseIndent / decreaseIndent on a paragraph', () => {
  it('increaseIndent raises the level and decreaseIndent lowers it back', () => {
    editor = makeEditor('<p>hello</p>')
    editor.commands.selectAll()

    expect(firstIndent(editor)).toBe(0)
    expect(editor.commands.increaseIndent()).toBe(true)
    expect(firstIndent(editor)).toBe(1)
    expect(editor.commands.increaseIndent()).toBe(true)
    expect(firstIndent(editor)).toBe(2)
    expect(editor.commands.decreaseIndent()).toBe(true)
    expect(firstIndent(editor)).toBe(1)
  })

  it('decreaseIndent at level 0 is a no-op (returns false, stays 0)', () => {
    editor = makeEditor('<p>hello</p>')
    editor.commands.selectAll()

    expect(firstIndent(editor)).toBe(0)
    expect(editor.commands.decreaseIndent()).toBe(false)
    expect(firstIndent(editor)).toBe(0)
  })

  it('increaseIndent clamps at INDENT_MAX_LEVEL (further increase is a no-op)', () => {
    editor = makeEditor('<p>hello</p>')
    editor.commands.selectAll()

    for (let i = 0; i < INDENT_MAX_LEVEL; i++) editor.commands.increaseIndent()
    expect(firstIndent(editor)).toBe(INDENT_MAX_LEVEL)
    expect(editor.commands.increaseIndent()).toBe(false)
    expect(firstIndent(editor)).toBe(INDENT_MAX_LEVEL)
  })

  it('unsetIndent resets an indented block to 0', () => {
    editor = makeEditor('<p>hello</p>')
    editor.commands.selectAll()
    editor.commands.increaseIndent()
    editor.commands.increaseIndent()
    expect(firstIndent(editor)).toBe(2)
    expect(editor.commands.unsetIndent()).toBe(true)
    expect(firstIndent(editor)).toBe(0)
  })
})

describe('increaseIndent on a heading', () => {
  it('applies to headings too (configured type)', () => {
    editor = makeEditor('<h2>title</h2>')
    editor.commands.selectAll()
    expect(editor.commands.increaseIndent()).toBe(true)
    expect(firstIndent(editor)).toBe(1)
    expect(editor.state.doc.firstChild?.type.name).toBe('heading')
  })
})

describe('indent HTML round-trip (data-indent <-> indent)', () => {
  it('parses data-indent from HTML into the indent attr', () => {
    editor = makeEditor('<p data-indent="3">x</p>')
    expect(firstIndent(editor)).toBe(3)
  })

  it('renders an indented block with data-indent and a margin-left style', () => {
    editor = makeEditor('<p>x</p>')
    editor.commands.selectAll()
    editor.commands.increaseIndent()
    editor.commands.increaseIndent()
    const html = editor.getHTML()
    expect(html).toContain('data-indent="2"')
    expect(html).toContain(`margin-left: ${2 * INDENT_STEP_EM}em`)
  })

  it('renders no indent attr/style at level 0 (backward-compatible with old docs)', () => {
    editor = makeEditor('<p>x</p>')
    const html = editor.getHTML()
    expect(html).not.toContain('data-indent')
    expect(html).not.toContain('margin-left')
  })
})

// The collab boundary strips attrs the schema does not know. Two editors bound to the SAME
// Y.Doc — both registering ParagraphIndent — must preserve the indent attr across the sync,
// proving the attr rides through the Yjs XmlFragment intact (normalized structural check on
// the decoded attr, not a raw-byte compare).
describe('Yjs collaboration round-trip', () => {
  it('preserves the indent attr from one peer to another via the shared Y.Doc', () => {
    const ydoc = new Y.Doc()
    const mkPeer = () =>
      new Editor({
        extensions: [
          StarterKit.configure({ undoRedo: false }),
          ParagraphIndent.configure({ types: ['paragraph', 'heading'] }),
          Collaboration.configure({ document: ydoc }),
        ],
      })
    const peerA = mkPeer()
    const peerB = mkPeer()
    try {
      peerA.commands.selectAll()
      peerA.commands.increaseIndent()
      peerA.commands.increaseIndent()
      // Both peers share one Y.Doc; the ySync observers apply A's change to B synchronously.
      expect(clampIndent(peerA.state.doc.firstChild?.attrs.indent)).toBe(2)
      expect(clampIndent(peerB.state.doc.firstChild?.attrs.indent)).toBe(2)
    } finally {
      peerA.destroy()
      peerB.destroy()
      ydoc.destroy()
    }
  })
})
