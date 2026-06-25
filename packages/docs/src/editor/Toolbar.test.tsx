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
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
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

describe('Toolbar — active states for insert/popup buttons (batch 8 item 8)', () => {
  function tableEditor() {
    return new Editor({
      extensions: [
        StarterKit.configure({ undoRedo: false }),
        TaskList,
        TaskItem,
        Highlight.configure({ multicolor: true }),
        TextStyle,
        Color,
        Link,
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        FindReplace,
      ],
      content: '<p>hello</p>',
    })
  }

  it('never marks the Table (insert) button active, even with the caret inside a table', () => {
    const e = tableEditor()
    e.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()
    expect(e.isActive('table')).toBe(true) // caret is inside the just-inserted table…
    render(<Toolbar editor={e} />)
    // …yet the insert button must NOT show the toggle-active blue.
    expect(titleBtn('docs.toolbar.table').className).not.toContain('is-active')
    e.destroy()
  })

  it('marks highlight/text-colour triggers active only while their popover is open, not from colored text', () => {
    // Caret sits inside highlighted + coloured text…
    editor!.chain().focus().selectAll().toggleHighlight({ color: '#fff3a3' }).setColor('#e03131').run()
    render(<Toolbar editor={editor!} />)
    const highlight = titleBtn('docs.toolbar.highlight')
    const color = titleBtn('docs.toolbar.textColor')
    // …but the triggers are not blue purely because the cursor is in coloured text.
    expect(highlight.className).not.toContain('is-active')
    expect(color.className).not.toContain('is-active')

    // Opening the popover (and only then) marks the trigger active.
    fireEvent.click(highlight)
    expect(titleBtn('docs.toolbar.highlight').className).toContain('is-active')
    // Closing it removes the active state again.
    fireEvent.click(titleBtn('docs.toolbar.highlight'))
    expect(titleBtn('docs.toolbar.highlight').className).not.toContain('is-active')
  })

  it('keeps isActive on true toggle-mark buttons (bold/italic/underline)', () => {
    editor!.chain().focus().selectAll().toggleBold().toggleItalic().toggleUnderline().run()
    render(<Toolbar editor={editor!} />)
    expect(titleBtn('docs.toolbar.bold').className).toContain('is-active')
    expect(titleBtn('docs.toolbar.italic').className).toContain('is-active')
    expect(titleBtn('docs.toolbar.underline').className).toContain('is-active')
  })
})

describe('Toolbar — clear-format is an eraser icon (batch 8 item 7)', () => {
  it('renders the clear-format button as an icon (no "Tx" text label)', () => {
    render(<Toolbar editor={editor!} />)
    const clear = titleBtn('docs.toolbar.clearFormat')
    expect(clear.querySelector('svg.octo-tb-icon')).toBeTruthy()
    expect(clear.textContent?.trim()).toBe('')
  })
})

describe('Toolbar — undo/redo are stroke icon buttons (batch 8)', () => {
  it('renders undo/redo as icon buttons located by title (no text label), in a undo-left/redo-right group', () => {
    render(<Toolbar editor={editor!} />)
    const undo = titleBtn('docs.toolbar.undo')
    const redo = titleBtn('docs.toolbar.redo')
    // Stroke-style glyphs, no text.
    expect(undo.querySelector('svg.octo-tb-icon-stroke')).toBeTruthy()
    expect(redo.querySelector('svg.octo-tb-icon-stroke')).toBeTruthy()
    expect(undo.textContent?.trim()).toBe('')
    expect(redo.textContent?.trim()).toBe('')
    // Grouped together; undo precedes redo in document order.
    const group = undo.closest('.octo-tb-undoredo')
    expect(group).toBeTruthy()
    expect(group).toBe(redo.closest('.octo-tb-undoredo'))
    expect(undo.compareDocumentPosition(redo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('disables undo/redo when there is no history (can().undo()/redo() is false)', () => {
    // A fresh editor with history enabled has an empty undo/redo stack.
    const e = new Editor({ extensions: [StarterKit], content: '<p>hello</p>' })
    expect(e.can().undo()).toBe(false)
    expect(e.can().redo()).toBe(false)
    render(<Toolbar editor={e} />)
    expect(titleBtn('docs.toolbar.undo').disabled).toBe(true)
    expect(titleBtn('docs.toolbar.redo').disabled).toBe(true)
    e.destroy()
  })

  it('enables undo after an edit (disabled prop wired to editor.can())', () => {
    const e = new Editor({ extensions: [StarterKit], content: '<p>hello</p>' })
    e.chain().focus().insertContent(' world').run()
    expect(e.can().undo()).toBe(true)
    render(<Toolbar editor={e} />)
    expect(titleBtn('docs.toolbar.undo').disabled).toBe(false)
    e.destroy()
  })
})
