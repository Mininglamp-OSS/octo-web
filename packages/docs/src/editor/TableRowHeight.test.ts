import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { Table } from '@tiptap/extension-table'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import * as Y from 'yjs'
import type { Node as PMNode } from '@tiptap/pm/model'
import {
  TableRowHeight,
  TableRowResize,
  MIN_ROW_HEIGHT,
  normalizeRowHeight,
  parseRowHeightPx,
} from './TableRowHeight.ts'

// SCHEMA_VERSION 19: the tableRow `height` attr + the row-resize drag handle. These assertions
// guard the wire contract (number | null default null; toDOM `style="height:Npx"` when set, bare
// `<tr>` when null; parseDOM reads integer px back), the setNodeMarkup transaction the resize
// commits, and the Yjs collab round-trip (normalized structural equivalence on the decoded attr —
// NOT a raw Y.Doc byte compare). The real pointer-driven drag is verified in a real browser by
// dev/run-rowheight.mjs; jsdom cannot exercise the geometry, so here the drag is represented by the
// exact setNodeMarkup transaction the plugin dispatches on drop.

const TABLE_HTML =
  '<table><tbody>' +
  '<tr><td><p>r1c1</p></td><td><p>r1c2</p></td></tr>' +
  '<tr><td><p>r2c1</p></td><td><p>r2c2</p></td></tr>' +
  '</tbody></table>'

function makeEditor(html: string = TABLE_HTML): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Table.configure({ resizable: true }),
      TableRowHeight,
      TableHeader,
      TableCell,
      TableRowResize,
    ],
    content: html,
  })
}

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

/** Position (just before) and node of the Nth tableRow in document order. */
function nthRow(e: Editor, n: number): { pos: number; node: PMNode } {
  const rows: { pos: number; node: PMNode }[] = []
  e.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableRow') rows.push({ pos, node })
    return true
  })
  if (!rows[n]) throw new Error(`no tableRow #${n}`)
  return rows[n]
}

describe('normalizeRowHeight', () => {
  it('rounds, floors at MIN_ROW_HEIGHT, and maps empty/invalid to null', () => {
    expect(normalizeRowHeight(40)).toBe(40)
    expect(normalizeRowHeight(40.6)).toBe(41)
    expect(normalizeRowHeight(MIN_ROW_HEIGHT)).toBe(MIN_ROW_HEIGHT)
    // A positive-but-too-small value clamps up to the min rather than vanishing ("防拖没").
    expect(normalizeRowHeight(5)).toBe(MIN_ROW_HEIGHT)
    // null / non-finite / non-positive → null (no explicit height; the default).
    expect(normalizeRowHeight(null)).toBeNull()
    expect(normalizeRowHeight(undefined)).toBeNull()
    expect(normalizeRowHeight(NaN)).toBeNull()
    expect(normalizeRowHeight(0)).toBeNull()
    expect(normalizeRowHeight(-10)).toBeNull()
    // Numeric strings coerce (defensive against stored string attrs).
    expect(normalizeRowHeight('48')).toBe(48)
  })
})

describe('parseRowHeightPx', () => {
  const trWith = (style: string): HTMLElement => {
    const tr = document.createElement('tr')
    tr.setAttribute('style', style)
    return tr
  }
  it('reads an integer px height from an inline style', () => {
    expect(parseRowHeightPx(trWith('height:40px'))).toBe(40)
    expect(parseRowHeightPx(trWith('height: 56px'))).toBe(56)
  })
  it('returns null when there is no height, it is not px, or it is non-positive', () => {
    expect(parseRowHeightPx(trWith(''))).toBeNull()
    expect(parseRowHeightPx(trWith('color:red'))).toBeNull()
    expect(parseRowHeightPx(trWith('height:auto'))).toBeNull()
    expect(parseRowHeightPx(trWith('height:50%'))).toBeNull()
  })
})

describe('tableRow.height HTML round-trip (style="height:Npx" <-> height attr)', () => {
  it('parses an inline row height from HTML into the height attr', () => {
    editor = makeEditor(
      '<table><tbody><tr style="height:64px"><td><p>x</p></td></tr></tbody></table>',
    )
    expect(nthRow(editor, 0).node.attrs.height).toBe(64)
  })

  it('renders a row with a height as <tr style="height:Npx">', () => {
    editor = makeEditor()
    const { pos, node } = nthRow(editor, 0)
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, height: 50 }))
    // The DOM/CSSOM normalizes the style string (`height:50px` → `height: 50px;`); the byte-aligned
    // persisted form is the numeric attr (50) in the Y.Doc, so assert the px value tolerant of spacing.
    expect(editor.getHTML()).toMatch(/<tr style="height:\s*50px;?">/)
  })

  it('renders no height style when the attr is null (backward-compatible with old docs / v18)', () => {
    editor = makeEditor()
    expect(nthRow(editor, 0).node.attrs.height).toBeNull()
    // No row carries a height style — a bare <tr>, identical to pre-v19 output.
    expect(editor.getHTML()).not.toContain('height:')
  })
})

describe('setTableRowHeight command (the transaction the resize commits on drop)', () => {
  it('sets the height attr on the addressed row and is a no-op when unchanged', () => {
    editor = makeEditor()
    const { pos } = nthRow(editor, 0)

    expect(editor.commands.setTableRowHeight(pos, 72)).toBe(true)
    expect(nthRow(editor, 0).node.attrs.height).toBe(72)

    // Re-setting the same normalized value changes nothing → false (clean boundary).
    expect(editor.commands.setTableRowHeight(pos, 72)).toBe(false)

    // Clearing back to null reverts to content-driven height.
    expect(editor.commands.setTableRowHeight(pos, null)).toBe(true)
    expect(nthRow(editor, 0).node.attrs.height).toBeNull()
  })

  it('clamps a below-min drag result up to MIN_ROW_HEIGHT (防拖没)', () => {
    editor = makeEditor()
    const { pos } = nthRow(editor, 0)
    editor.commands.setTableRowHeight(pos, 4)
    expect(nthRow(editor, 0).node.attrs.height).toBe(MIN_ROW_HEIGHT)
  })

  it('only touches the addressed row, leaving sibling rows unchanged', () => {
    editor = makeEditor()
    editor.commands.setTableRowHeight(nthRow(editor, 0).pos, 90)
    expect(nthRow(editor, 0).node.attrs.height).toBe(90)
    expect(nthRow(editor, 1).node.attrs.height).toBeNull()
  })
})

// The collab boundary strips attrs the schema does not know. Two editors bound to the SAME Y.Doc —
// both registering TableRowHeight — must preserve the height attr across the sync, proving it rides
// through the Yjs XmlFragment intact. Normalized structural check on the decoded attr, not a raw
// encodeStateAsUpdate byte compare (which is flaky across clientID / insertion order).
describe('Yjs collaboration round-trip', () => {
  it('preserves the tableRow.height attr from one peer to another via the shared Y.Doc', () => {
    const ydoc = new Y.Doc()
    const mkPeer = () =>
      new Editor({
        extensions: [
          StarterKit.configure({ undoRedo: false }),
          Table.configure({ resizable: true }),
          TableRowHeight,
          TableHeader,
          TableCell,
          Collaboration.configure({ document: ydoc }),
        ],
      })
    const peerA = mkPeer()
    // Seed content through a real transaction so ySync writes it into the Y.Doc before B forks.
    peerA.commands.insertContent(TABLE_HTML)
    const peerB = mkPeer()
    try {
      const { pos } = nthRow(peerA, 0)
      peerA.view.dispatch(
        peerA.state.tr.setNodeMarkup(pos, undefined, { ...peerA.state.doc.nodeAt(pos)!.attrs, height: 88 }),
      )
      // Both peers share one Y.Doc; the ySync observers apply A's change to B synchronously.
      expect(nthRow(peerA, 0).node.attrs.height).toBe(88)
      expect(nthRow(peerB, 0).node.attrs.height).toBe(88)
    } finally {
      peerA.destroy()
      peerB.destroy()
      ydoc.destroy()
    }
  })
})
