// Regression test for PR #904 review (yujiawei 🔴 / lml2468 / mochashanyao): the link bubble's
// "edit display text" path must NOT drop the link text's other inline marks, and moving between two
// adjacent links that share the same URL must not carry a stale edit draft across.
//
// Two guarded behaviours, tested against the real LinkBubbleMenu:
//   1. applyEdit(): when the text changes, the rebuilt run carries over the ORIGINAL non-link marks
//      (bold/italic/…) and only re-points the link href — editing a styled link's text keeps its
//      styling (the pre-fix code hard-coded marks:[link], flattening everything else).
//   2. edit-state reset keys on the link's range position, NOT its href — so moving the caret from
//      link A to an adjacent link B with the SAME url closes A's edit form (a stale draft from A must
//      never be committable onto B).

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { LinkBubbleMenu } from './Toolbar.tsx'

// BubbleMenu (tippy/floating-ui) doesn't render meaningfully under jsdom — stub it to render its
// children so LinkBubbleMenu mounts its form + effects.
vi.mock('@tiptap/react/menus', () => ({
  BubbleMenu: ({ children }: { children: React.ReactNode }) => children,
}))

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

function makeEditor(content: string): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false, link: false }),
      Link.configure({ openOnClick: false }),
    ],
    content,
    editable: true,
  })
}

// Place the caret at an absolute position and force a re-render tick.
function setCaret(ed: Editor, pos: number) {
  act(() => {
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)))
  })
}

// First text position that carries a link mark, optionally skipping the first `skip` link runs.
function linkTextPos(ed: Editor, skip = 0): number {
  const linkType = ed.state.schema.marks.link
  const runs: number[] = []
  let lastHref: string | null = null
  ed.state.doc.descendants((node, p) => {
    if (node.isText) {
      const mark = node.marks.find((m) => m.type === linkType)
      const href = mark ? (mark.attrs.href as string) : null
      if (href && href !== lastHref) runs.push(p + 1)
      lastHref = href
    }
    return true
  })
  if (runs.length <= skip) throw new Error('not enough link runs')
  return runs[skip]
}

// Open the edit form (click ✎), returns the two link-field inputs [text, url].
function openEditForm(container: HTMLElement): { text: HTMLInputElement; url: HTMLInputElement } {
  const editBtn = container.querySelector<HTMLButtonElement>('button[aria-label="docs.toolbar.linkEdit"]')
  if (!editBtn) throw new Error('edit (✎) button not found — link read card not rendered')
  act(() => editBtn.click())
  const fields = container.querySelectorAll<HTMLInputElement>('.octo-link-field')
  if (fields.length < 2) throw new Error('edit form inputs not found')
  return { text: fields[0], url: fields[1] }
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('link bubble — edit display text (PR #904 regression)', () => {
  it('editing a BOLD link\u2019s text keeps the bold mark (does not flatten inline marks)', () => {
    editor = makeEditor('<p><a href="https://a.com"><strong>hello</strong></a></p>')
    setCaret(editor, linkTextPos(editor))

    const { container } = render(<LinkBubbleMenu editor={editor} />)
    const { text } = openEditForm(container)

    setInput(text, 'world')
    act(() => {
      text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    const html = editor.getHTML()
    expect(html).toContain('world')
    expect(html).toContain('href="https://a.com')
    // The bold mark must survive the text edit (pre-fix: only the link mark was kept).
    expect(html).toMatch(/<strong>[^<]*world[^<]*<\/strong>/)
  })

  it('moving from link A to an adjacent link B with the SAME url drops A\u2019s stale edit draft', () => {
    // Two separate links, same href, separated by a space so they are distinct runs.
    editor = makeEditor('<p><a href="https://x.com">AAA</a> <a href="https://x.com">BBB</a></p>')

    // Start editing link A, stage a different text but DON'T confirm.
    setCaret(editor, linkTextPos(editor, 0))
    const { container } = render(<LinkBubbleMenu editor={editor} />)
    const formA = openEditForm(container)
    setInput(formA.text, 'HACKED')

    // Move the caret onto link B (same URL). The render-phase reset (keyed on range.from, not href)
    // must close the edit form, discarding A's "HACKED" draft.
    setCaret(editor, linkTextPos(editor, 1))

    // Edit form must have reset to the read card: no more link-field inputs on screen.
    expect(container.querySelectorAll('.octo-link-field').length).toBe(0)

    // And B's text is untouched — the stale draft never reached it.
    const html = editor.getHTML()
    expect(html).toContain('>BBB</a>')
    expect(html).not.toContain('HACKED')
  })

  it('a link containing an inline non-text node is NOT flattened on a text edit (href-only)', () => {
    // A hard break stands in for any inline-but-not-text node (mention, inline math, icon).
    // Rebuilding the range as a single text run would destroy it, so the text edit must be
    // refused and downgraded to a pure href re-point that keeps the original content intact.
    editor = makeEditor('<p><a href="https://a.com">foo<br>bar</a></p>')
    setCaret(editor, linkTextPos(editor))

    const { container } = render(<LinkBubbleMenu editor={editor} />)
    const { text, url } = openEditForm(container)

    setInput(text, 'renamed')
    setInput(url, 'https://b.com')
    act(() => {
      url.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    const html = editor.getHTML()
    // The inline node and the original text survive; the new flat text is NOT applied.
    expect(html).toContain('<br>')
    expect(html).toContain('foo')
    expect(html).toContain('bar')
    expect(html).not.toContain('renamed')
    // The href IS re-pointed (the safe part of the edit still lands).
    expect(html).toContain('href="https://b.com')
  })
})
