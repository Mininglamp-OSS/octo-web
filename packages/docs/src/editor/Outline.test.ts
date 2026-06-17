import { describe, it, expect, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { collectOutline } from './Outline.tsx'

// Build a minimal headless editor (no collaboration) for outline extraction.
function makeEditor(html: string): Editor {
  return new Editor({
    extensions: [StarterKit.configure({ undoRedo: false })],
    content: html,
  })
}

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('collectOutline (document outline / TOC)', () => {
  it('returns an empty outline when there are no headings', () => {
    editor = makeEditor('<p>just a paragraph</p>')
    expect(collectOutline(editor)).toEqual([])
  })

  it('collects headings in document order with their levels and text', () => {
    editor = makeEditor(
      '<h1>Title</h1><p>intro</p><h2>Section A</h2><h3>Sub A1</h3><h2>Section B</h2>',
    )
    const outline = collectOutline(editor)
    expect(outline.map((i) => [i.level, i.text])).toEqual([
      [1, 'Title'],
      [2, 'Section A'],
      [3, 'Sub A1'],
      [2, 'Section B'],
    ])
  })

  it('numbers items 1-based in order and exposes a document position', () => {
    editor = makeEditor('<h1>One</h1><h2>Two</h2>')
    const outline = collectOutline(editor)
    expect(outline.map((i) => i.index)).toEqual([1, 2])
    expect(outline.every((i) => typeof i.pos === 'number' && i.pos >= 0)).toBe(true)
    // Positions are strictly increasing in document order.
    expect(outline[1].pos).toBeGreaterThan(outline[0].pos)
  })

  it('includes empty headings (with empty text)', () => {
    editor = makeEditor('<h1></h1><h2>Real</h2>')
    const outline = collectOutline(editor)
    expect(outline).toHaveLength(2)
    expect(outline[0].text).toBe('')
  })
})
