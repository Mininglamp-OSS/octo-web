// Regression test for PR #904 review (Jerry-Xin, 🔴 Critical): the formula edit path must be gated on
// `editor.isEditable`, so a read-only document can neither OPEN nor COMMIT a formula edit.
//
// There are two guarded layers, both tested here:
//   1. The NodeView (mathExtended.ts): a double-click only dispatches `octo-math-edit` when editable —
//      this is the sole entry to the editor, so read-only double-click is a no-op at the source.
//   2. The MathBubbleMenu (Toolbar.tsx): its `octo-math-edit` handler (`onEdit`) bails when the editor
//      is not editable, so even a stray event cannot select the node / open the LaTeX modal — proving
//      the double-click→confirm chain cannot mutate a read-only editor.
//
// Note: TipTap's own updateBlockMath command does NOT check isEditable, which is exactly why the
// application-level guards above are required (and why we assert the guard, not the raw command).

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { InlineMathStyled, BlockMathStyled } from './mathExtended.ts'
import { MathBubbleMenu } from './Toolbar.tsx'

// BubbleMenu (tippy/floating-ui) doesn't render meaningfully under jsdom — stub it to render its
// children so MathBubbleMenu's effects (the octo-math-edit listener) still mount.
vi.mock('@tiptap/react/menus', () => ({
  BubbleMenu: ({ children }: { children: React.ReactNode }) => children,
}))

// @univerjs/design + mathlive don't run under jsdom; minimal passthrough / stubs (mirrors Toolbar.test).
vi.mock('@univerjs/design', async () => {
  const React = await import('react')
  return {
    ConfigProvider: ({ children }: { children: React.ReactNode }) => children,
    Tooltip: ({ children }: { children: React.ReactNode }) => children,
    ColorPicker: () => React.createElement('span'),
  }
})
vi.mock('mathlive', () => ({
  MathfieldElement: function MathfieldElement(this: unknown) {
    return document.createElement('span')
  },
}))

let editor: Editor | null = null

afterEach(() => {
  cleanup()
  editor?.destroy()
  editor = null
})

function makeEditor(editable: boolean): Editor {
  const ed = new Editor({
    extensions: [StarterKit.configure({ undoRedo: false }), InlineMathStyled, BlockMathStyled],
    content: '<p>hi</p>',
    editable,
  })
  ed.chain().insertBlockMath({ latex: 'x^2' }).run()
  return ed
}

function mathWrapper(ed: Editor): HTMLElement {
  const el = ed.view.dom.querySelector<HTMLElement>('.octo-math-render')
  if (!el) throw new Error('no math node view rendered')
  return el
}

describe('formula editing — read-only guard (PR #904 regression)', () => {
  it('NodeView: double-click in a READ-ONLY doc does NOT dispatch octo-math-edit', () => {
    editor = makeEditor(false)
    expect(editor.isEditable).toBe(false)

    let fired = false
    editor.view.dom.addEventListener('octo-math-edit', () => {
      fired = true
    })

    mathWrapper(editor).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(fired).toBe(false)
  })

  it('NodeView: double-click in an EDITABLE doc DOES dispatch octo-math-edit', () => {
    editor = makeEditor(true)
    expect(editor.isEditable).toBe(true)

    let fired = false
    editor.view.dom.addEventListener('octo-math-edit', () => {
      fired = true
    })

    mathWrapper(editor).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(fired).toBe(true)
  })

  it('MathBubbleMenu: an octo-math-edit event in a READ-ONLY doc does NOT enter edit (no node selection)', () => {
    editor = makeEditor(false)
    render(<MathBubbleMenu editor={editor} />)

    // Fire the event the NodeView would dispatch. The onEdit guard must bail before selecting the node.
    editor.view.dom.dispatchEvent(new CustomEvent('octo-math-edit', { bubbles: true, detail: { pos: 0 } }))

    expect(editor.state.selection instanceof NodeSelection).toBe(false)
  })

  it('MathBubbleMenu: an octo-math-edit event in an EDITABLE doc selects the math node (opens edit)', () => {
    editor = makeEditor(true)
    render(<MathBubbleMenu editor={editor} />)

    editor.view.dom.dispatchEvent(new CustomEvent('octo-math-edit', { bubbles: true, detail: { pos: 0 } }))

    const sel = editor.state.selection
    expect(sel instanceof NodeSelection).toBe(true)
    expect(sel.from).toBe(0)
  })
})
