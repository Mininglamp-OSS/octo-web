import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Highlight from '@tiptap/extension-highlight'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Link from '@tiptap/extension-link'
import { Toolbar } from './Toolbar.tsx'
import { getFindState, FindReplace } from './findReplace.ts'

// Batch 7 toolbar changes: list dropdown, quote/code/link as icon buttons (with tooltips),
// highlight + text-colour tooltips, and a floating link popover (not an inline toolbar widget).
// These render tests assert the resulting toolbar STRUCTURE — the `t()` stub returns keys
// unchanged, so we assert on the stable i18n keys used as button `title`s.

let editor: Editor | null = null

beforeEach(() => {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      TaskList,
      TaskItem,
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
      Link,
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

function titleBtn(title: string): HTMLButtonElement {
  const el = document.querySelector<HTMLButtonElement>(`button[title="${title}"]`)
  if (!el) throw new Error(`no toolbar button with title="${title}"`)
  return el
}

describe('Toolbar — batch 7 list dropdown', () => {
  it('renders a single list trigger (no standalone bullet/ordered/task buttons)', () => {
    render(<Toolbar editor={editor!} />)
    // One list trigger…
    expect(titleBtn('docs.toolbar.list')).toBeTruthy()
    // …and the list options are NOT present as standalone toolbar buttons until opened.
    expect(document.querySelector('button[title="docs.toolbar.bulletList"]')).toBeNull()
    expect(document.querySelector('button[title="docs.toolbar.orderedList"]')).toBeNull()
    expect(document.querySelector('button[title="docs.toolbar.taskList"]')).toBeNull()
  })

  it('opens a menu with bullet / ordered / task items, and toggles the chosen list', () => {
    render(<Toolbar editor={editor!} />)
    fireEvent.click(titleBtn('docs.toolbar.list'))

    const menu = document.querySelector('.octo-list-menu') as HTMLElement
    expect(menu).toBeTruthy()
    const items = within(menu).getAllByRole('menuitem')
    expect(items).toHaveLength(3)

    // Click "Bullet list" → editor enters a bullet list, and the menu closes.
    const bullet = items.find((b) => b.textContent?.includes('docs.toolbar.bulletList'))!
    fireEvent.click(bullet)
    expect(editor!.isActive('bulletList')).toBe(true)
    expect(document.querySelector('.octo-list-menu')).toBeNull()
  })

  it('marks the list trigger active when the caret is inside a list', () => {
    editor!.chain().focus().toggleBulletList().run()
    render(<Toolbar editor={editor!} />)
    expect(titleBtn('docs.toolbar.list').className).toContain('is-active')
  })
})

describe('Toolbar — batch 7 quote/code/link/highlight/colour tooltips', () => {
  it('renders quote and code as icon buttons carrying their tooltips', () => {
    render(<Toolbar editor={editor!} />)
    const quote = titleBtn('docs.toolbar.quote')
    const code = titleBtn('docs.toolbar.codeBlock')
    // Icon buttons: an inline SVG glyph, no text label.
    expect(quote.querySelector('svg.octo-tb-icon')).toBeTruthy()
    expect(code.querySelector('svg.octo-tb-icon')).toBeTruthy()
    expect(quote.textContent?.trim()).toBe('')
  })

  it('gives the highlight and text-colour triggers a tooltip (item 3 fix)', () => {
    render(<Toolbar editor={editor!} />)
    expect(titleBtn('docs.toolbar.highlight')).toBeTruthy()
    expect(titleBtn('docs.toolbar.textColor')).toBeTruthy()
  })

  it('renders the link button as an icon button', () => {
    render(<Toolbar editor={editor!} />)
    const link = titleBtn('docs.toolbar.link')
    expect(link.querySelector('svg.octo-tb-icon')).toBeTruthy()
    expect(link.textContent?.trim()).toBe('')
  })
})

describe('Toolbar — batch 7 floating link popover (item 5)', () => {
  it('opens a floating popover (not an inline toolbar widget) with stacked fields', () => {
    render(<Toolbar editor={editor!} />)
    // Closed initially.
    expect(document.querySelector('.octo-link-popover')).toBeNull()

    fireEvent.click(titleBtn('docs.toolbar.link'))
    const popover = document.querySelector('.octo-link-popover') as HTMLElement
    expect(popover).toBeTruthy()
    // It's anchored in the relative link control wrapper (floats over content), and stacks
    // a text field + URL field + a Set action.
    expect(popover.closest('.octo-link-control')).toBeTruthy()
    expect(popover.querySelectorAll('input.octo-link-field')).toHaveLength(2)
    expect(within(popover).getByText('docs.toolbar.linkSet')).toBeTruthy()
  })

  it('closes the link popover on Escape', () => {
    render(<Toolbar editor={editor!} />)
    fireEvent.click(titleBtn('docs.toolbar.link'))
    const field = document.querySelector('input.octo-link-field') as HTMLInputElement
    expect(field).toBeTruthy()
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(document.querySelector('.octo-link-popover')).toBeNull()
  })
})

describe('Toolbar — find match counter stays in sync (batch-7 regression)', () => {
  // The counter (.octo-find-count) reads the find-plugin state. A setFindQuery transaction updates
  // matches/index but not the selection, so a selection-only re-render subscription left the
  // counter stale ("no results" while matches were highlighted, or the previous query's count
  // after changing the term). useFindState fixes that by keying the re-render off the find state.
  function openFindWith(content: string) {
    editor = new Editor({
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        TaskList,
        TaskItem,
        Highlight.configure({ multicolor: true }),
        TextStyle,
        Color,
        Link,
        FindReplace,
      ],
      content,
    })
    render(<Toolbar editor={editor} />)
    fireEvent.click(titleBtn('docs.toolbar.find'))
    return document.querySelector('.octo-find-input') as HTMLInputElement
  }

  function countText(): string {
    return (document.querySelector('.octo-find-count')?.textContent || '').trim()
  }

  it('shows a positive count (not "no results") immediately after typing a matched query', () => {
    const input = openFindWith('<p>apple one</p><p>apple two</p><p>apple three</p><p>apple four</p>')
    fireEvent.change(input, { target: { value: 'apple' } })
    // 4 matches → the count line renders the count key, NOT the no-results key.
    expect(countText()).toBe('docs.find.count')
    expect(countText()).not.toBe('docs.find.noResults')
  })

  it('re-renders the counter when the query changes (no stale prior-query value)', () => {
    const input = openFindWith('<p>apple one</p><p>apple two</p><p>apple three</p><p>apple four</p>')
    fireEvent.change(input, { target: { value: 'apple' } })
    expect(countText()).toBe('docs.find.count') // 4 matches

    // Change to a term with a single match — the counter must update, not keep "apple"'s count.
    fireEvent.change(input, { target: { value: 'two' } })
    // Find state now has exactly 1 match; counter still renders the count key (1/1), and the
    // underlying find state reflects the new query (proving the re-render + recompute happened).
    const fs = getFindState(editor!.state)
    expect(fs.query).toBe('two')
    expect(fs.matches).toHaveLength(1)
    expect(countText()).toBe('docs.find.count')

    // A query with no matches flips the counter to the no-results key (not a stale positive count).
    fireEvent.change(input, { target: { value: 'zzz' } })
    expect(getFindState(editor!.state).matches).toHaveLength(0)
    expect(countText()).toBe('docs.find.noResults')
  })
})
