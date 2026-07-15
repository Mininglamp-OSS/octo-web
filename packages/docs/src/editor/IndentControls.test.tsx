import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, fireEvent, cleanup, act, screen } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Toolbar } from './Toolbar.tsx'
import { ParagraphIndent, INDENT_MAX_LEVEL } from './ParagraphIndent.ts'

// SCHEMA_VERSION 18 toolbar wiring for the indent group. Beyond the command-boundary unit
// tests in ParagraphIndent.test.ts, this guards the toolbar reactivity across the FULL indent
// matrix — the things the command tests can't see:
// (1) at level 0, decrease is disabled (nothing to un-indent) while increase is enabled;
// (2) decrease RE-ENABLES after an increase (the reported bug: the button stayed greyed after an
//     increase because the toolbar only re-rendered on selection changes, and increaseIndent
//     rewrites a node attribute while leaving the caret put — same class as the find-counter bug);
// (3) at INDENT_MAX_LEVEL, increase is disabled (the clamp ceiling) and re-enables after a
//     decrease — symmetric with (1);
// (4) at every level in between BOTH buttons are clickable and each click steps one level.
// Both boundaries key off useIndentLevel, so a naive selection-only subscription regresses all of
// (2)–(4) at once.

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
  // Toolbar buttons carry their label on `aria-label` (the hover text is a styled @univerjs/design
  // Tooltip, not the native `title` attr). Buttons also live under one of two ribbon tabs
  // (开始/插入); when a button isn't on the current tab, switch tabs and look again so callers don't
  // have to know which tab the indent controls sit on.
  const find = () => document.querySelector<HTMLButtonElement>(`button[aria-label="${title}"]`)
  let el = find()
  if (!el) {
    for (const tab of ['docs.toolbar.tabStart', 'docs.toolbar.tabInsert']) {
      const tabBtn = screen.queryByText(tab)
      if (tabBtn) {
        fireEvent.click(tabBtn)
        el = find()
        if (el) break
      }
    }
  }
  if (!el) throw new Error(`no toolbar button with aria-label="${title}"`)
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

  it('increase disables at INDENT_MAX_LEVEL and re-enables after a decrease (symmetric with decrease at 0)', () => {
    render(<Toolbar editor={editor!} />)
    // At level 0 increase is enabled (decrease disabled — the other boundary).
    expect(btn(INCREASE).disabled).toBe(false)

    // Climb to the ceiling; increase must stay enabled until we actually reach INDENT_MAX_LEVEL.
    for (let i = 1; i <= INDENT_MAX_LEVEL; i++) {
      act(() => {
        fireEvent.click(btn(INCREASE))
      })
      expect(editor!.getAttributes('paragraph').indent).toBe(i)
      // Enabled for every level BELOW the ceiling; disabled exactly at the ceiling.
      expect(btn(INCREASE).disabled).toBe(i >= INDENT_MAX_LEVEL)
    }
    expect(editor!.getAttributes('paragraph').indent).toBe(INDENT_MAX_LEVEL)
    expect(btn(INCREASE).disabled).toBe(true)

    // Clicking the disabled-at-max increase is a no-op — the level does not exceed the clamp.
    act(() => {
      fireEvent.click(btn(INCREASE))
    })
    expect(editor!.getAttributes('paragraph').indent).toBe(INDENT_MAX_LEVEL)

    // One decrease pulls us off the ceiling → increase re-enables on the same render tick.
    act(() => {
      fireEvent.click(btn(DECREASE))
    })
    expect(editor!.getAttributes('paragraph').indent).toBe(INDENT_MAX_LEVEL - 1)
    expect(btn(INCREASE).disabled).toBe(false)
  })

  it('mid-range levels keep BOTH buttons clickable (full matrix: 0 → max, both enabled in between)', () => {
    render(<Toolbar editor={editor!} />)
    // Move to a middle level (2) where neither boundary applies.
    act(() => {
      fireEvent.click(btn(INCREASE))
    })
    act(() => {
      fireEvent.click(btn(INCREASE))
    })
    expect(editor!.getAttributes('paragraph').indent).toBe(2)
    expect(btn(INCREASE).disabled).toBe(false)
    expect(btn(DECREASE).disabled).toBe(false)

    // Decrease actually steps down one level (not a no-op) and both stay enabled at level 1.
    act(() => {
      fireEvent.click(btn(DECREASE))
    })
    expect(editor!.getAttributes('paragraph').indent).toBe(1)
    expect(btn(INCREASE).disabled).toBe(false)
    expect(btn(DECREASE).disabled).toBe(false)
  })
})
