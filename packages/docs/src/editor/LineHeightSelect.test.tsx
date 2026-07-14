import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, FontSize } from '@tiptap/extension-text-style'
import TextAlign from '@tiptap/extension-text-align'
import { Toolbar } from './Toolbar.tsx'
import { FindReplace } from './findReplace.ts'
import { LineHeight } from './LineHeight.ts'

// UI wiring for the v17 line-spacing selector. The `t()` stub returns keys unchanged,
// so the selector is found via its stable i18n title key. Registers TextAlign + LineHeight
// exactly as production does (LineHeight after TextAlign) so the merged style order holds.
let editor: Editor | null = null

beforeEach(() => {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      TextStyle,
      FontSize,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      LineHeight,
      FindReplace,
    ],
    content: '<p>hello</p>',
  })
})

afterEach(() => {
  cleanup()
  editor?.destroy()
  editor = null
})

function lineHeightSelect(): HTMLSelectElement {
  const el = document.querySelector<HTMLSelectElement>('select[title="docs.toolbar.lineHeight"]')
  if (!el) throw new Error('line-height selector not rendered')
  return el
}

describe('Toolbar — line-spacing selector (v17)', () => {
  it('renders a line-spacing selector with the preset options + Default + Custom', () => {
    render(<Toolbar editor={editor!} />)
    const select = lineHeightSelect()
    const values = Array.from(select.options).map((o) => o.value)
    expect(values).toEqual(['', '1.0', '1.15', '1.5', '2.0', 'custom'])
  })

  it('applies the chosen preset to the current paragraph', () => {
    render(<Toolbar editor={editor!} />)
    editor!.commands.selectAll()
    fireEvent.change(lineHeightSelect(), { target: { value: '1.5' } })
    expect(editor!.getAttributes('paragraph').lineHeight).toBe('1.5')
  })

  it('clears the line spacing when Default is chosen', () => {
    render(<Toolbar editor={editor!} />)
    editor!.commands.selectAll()
    editor!.commands.setLineHeight('2.0')
    expect(editor!.getAttributes('paragraph').lineHeight).toBe('2.0')
    fireEvent.change(lineHeightSelect(), { target: { value: '' } })
    expect(editor!.getAttributes('paragraph').lineHeight ?? null).toBe(null)
  })

  it('reflects a stored non-preset value as its own option', () => {
    // Author a non-preset value first, then render so the initial paint already reflects it.
    editor!.commands.selectAll()
    editor!.commands.setLineHeight('1.75')
    render(<Toolbar editor={editor!} />)
    const select = lineHeightSelect()
    const values = Array.from(select.options).map((o) => o.value)
    expect(values).toContain('1.75')
    expect(select.value).toBe('1.75')
  })
})
