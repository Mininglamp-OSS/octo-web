import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import type { EditorView } from '@tiptap/pm/view'
import { topLevelBlockPosAt } from './BlockDragHandle.ts'

// topLevelBlockPosAt resolves the position of the top-level (depth-1) block that
// ProseMirror's posAtCoords lands in. We drive it with a real document and a stub
// posAtCoords so the resolution logic is tested without a rendered view.
function makeEditor(html: string): Editor {
  return new Editor({ extensions: [StarterKit.configure({ undoRedo: false })], content: html })
}

function viewFor(editor: Editor, posAtCoords: EditorView['posAtCoords']): EditorView {
  return { state: editor.state, posAtCoords } as unknown as EditorView
}

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('topLevelBlockPosAt (block drag-handle target resolution)', () => {
  it('returns null when no block is under the pointer', () => {
    editor = makeEditor('<p>hello</p>')
    const view = viewFor(editor, () => null)
    expect(topLevelBlockPosAt(view, 0, 0)).toBeNull()
  })

  it('resolves the first top-level block to its before-position (0)', () => {
    editor = makeEditor('<p>first</p><p>second</p>')
    // A point inside the first paragraph (pos 1 is inside its text).
    const view = viewFor(editor, () => ({ pos: 1, inside: 0 }))
    expect(topLevelBlockPosAt(view, 10, 10)).toBe(0)
  })

  it('resolves a later top-level block to its own before-position', () => {
    editor = makeEditor('<p>first</p><p>second</p>')
    // The second paragraph starts at offset 7; pos 9 is inside its text.
    const view = viewFor(editor, () => ({ pos: 9, inside: 8 }))
    expect(topLevelBlockPosAt(view, 10, 40)).toBe(7)
  })

  it('resolves nested content (list item) up to its top-level ancestor (0)', () => {
    editor = makeEditor('<ul><li><p>item</p></li></ul>')
    // pos 3 is deep inside the list item's paragraph; resolution climbs to the
    // depth-1 bulletList, whose before-position is 0.
    const view = viewFor(editor, () => ({ pos: 3, inside: 2 }))
    expect(topLevelBlockPosAt(view, 10, 10)).toBe(0)
  })
})
