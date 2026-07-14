import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, fireEvent, cleanup, act } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Toolbar } from './Toolbar.tsx'
import { ParagraphIndent, INDENT_MAX_LEVEL } from './ParagraphIndent.ts'

// SCHEMA_VERSION 18 toolbar wiring for the indent group. Beyond the command-boundary unit
// tests in ParagraphIndent.test.ts, this guards the two things the command tests can't see:
// (1) the decrease button is disabled at level 0 (the "greyed by default" behaviour, which is
// intentional — nothing to un-indent), and (2) it RE-ENABLES after an increase. (2) is the
// real regression risk: the toolbar re-renders via useEditorTick, whose snapshot keys off the
// selection (from:to). increaseIndent only rewrites a node attribute and leaves the caret put,
// so a naive selection-only subscription could leave the button stale — the same class of bug
// the find-counter (useFindState) had to work around.

let editor: Editor | null = null

beforeEach(() => {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      ParagraphIndent.configure({ types: ['paragraph', 'heading'] }),
    ],
    content: '<p>hello</p>',
  })
  // A real caret in the paragraph, as the boss has when clicking the toolbar.
  editor.commands.setTextSelection(3)
})

afterEach(() => {
  cleanup()
  editor?.destroy()
  editor = null
})

function btn(title: string): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>(`button[title="${title}"]`)
  if (!el) throw new Error(`no toolbar button with title="${title}"`)
  return el
}

const DECREASE = 'docs.toolbar.indentDecrease'
const INCREASE = 'docs.toolbar.indentIncrease'

describe('Toolbar — indent decrease button disabled state (SCHEMA_VERSION 18)', () => {
  it('decrease is disabled at level 0 by default, increase is enabled', () => {
    render(<Toolbar editor={editor!} />)
    expect(btn(DECREASE).disabled).toBe(true)
    expect(btn(INCREASE).disabled).toBe(false)
  })

  it('decrease re-enables immediately after an increase, and disables again once back at 0', () => {
    render(<Toolbar editor={editor!} />)
    expect(btn(DECREASE).disabled).toBe(true)

    // Increase → level 1: decrease must light up on the same render tick (reactivity).
    act(() => {
      fireEvent.click(btn(INCREASE))
    })
    expect(editor!.getAttributes('paragraph').indent).toBe(1)
    expect(btn(DECREASE).disabled).toBe(false)

    // Decrease back to 0 → button greys out again.
    act(() => {
      fireEvent.click(btn(DECREASE))
    })
    expect(editor!.getAttributes('paragraph').indent ?? 0).toBe(0)
    expect(btn(DECREASE).disabled).toBe(true)
  })

  it('increase applies level by level and the buttons track the current level', () => {
    render(<Toolbar editor={editor!} />)
    for (let i = 1; i <= INDENT_MAX_LEVEL; i++) {
      act(() => {
        fireEvent.click(btn(INCREASE))
      })
      expect(editor!.getAttributes('paragraph').indent).toBe(i)
      expect(btn(DECREASE).disabled).toBe(false)
    }
  })
})
