import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act, waitFor } from '@testing-library/react'
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

// The toolbar now drives @univerjs/design components (Select / ColorPicker / DropdownMenu / Tooltip)
// and MathLive-backed formula previews — none of which render meaningfully under jsdom. Mock them
// with minimal drivable stand-ins so <Toolbar> renders and OUR logic (which control shows, what a
// pick does) can be asserted: Select → native <select>, ColorPicker → a button committing a fixed
// hex, DropdownMenu → its radio options as buttons, Tooltip/ConfigProvider → passthrough. MathLive's
// MathfieldElement → a plain <span> so `new MathfieldElement()` + host.appendChild(mf) work.
vi.mock('@univerjs/design', async () => {
  const React = await import('react')
  return {
    ConfigProvider: ({ children }: { children: React.ReactNode }) => children,
    Tooltip: ({ children }: { children: React.ReactNode }) => children,
    Select: ({ value, options, onChange }: { value: string; options: { label: unknown; value: string }[]; onChange?: (v: string) => void }) =>
      React.createElement(
        'select',
        { className: 'univer-select-mock', value, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onChange?.(e.target.value) },
        (options ?? []).map((o) =>
          React.createElement('option', { key: String(o.value), value: o.value }, typeof o.label === 'string' ? o.label : String(o.value)),
        ),
      ),
    DropdownMenu: ({ children, items }: { children: React.ReactNode; items?: { value?: string; options?: { label: unknown; value: string }[]; onSelect?: (v: string) => void }[] }) =>
      React.createElement(
        React.Fragment,
        null,
        children,
        (items ?? []).flatMap((it, i) =>
          (it.options ?? []).map((o) =>
            React.createElement(
              'button',
              { key: `${i}-${o.value}`, type: 'button', 'data-dropdown-option': o.value, onClick: () => it.onSelect?.(o.value) },
              typeof o.label === 'string' ? o.label : String(o.value),
            ),
          ),
        ),
      ),
    ColorPicker: ({ onChange }: { onChange?: (v: string) => void }) =>
      React.createElement('button', { type: 'button', 'data-colorpicker-pick': '#3370ff', onClick: () => onChange?.('#3370ff') }, 'pick'),
  }
})

vi.mock('mathlive', () => ({
  MathfieldElement: function MathfieldElement(this: unknown) {
    return document.createElement('span')
  },
}))

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
  // Toolbar buttons carry their label on `aria-label` (the hover text is a styled @univerjs/design
  // Tooltip, not the native `title` attr). Buttons also live under one of two ribbon tabs
  // (开始/插入); when a button isn't on the current tab, switch tabs and look again so callers don't
  // have to know which tab a control sits on.
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

describe('Toolbar — batch 7 list dropdown', () => {
  it('renders a single list trigger (no standalone bullet/ordered/task buttons)', () => {
    render(<Toolbar editor={editor!} />)
    // One list trigger…
    expect(titleBtn('docs.toolbar.list')).toBeTruthy()
    // …and the list options are NOT present as standalone toolbar buttons until opened.
    expect(document.querySelector('button[aria-label="docs.toolbar.bulletList"]')).toBeNull()
    expect(document.querySelector('button[aria-label="docs.toolbar.orderedList"]')).toBeNull()
    expect(document.querySelector('button[aria-label="docs.toolbar.taskList"]')).toBeNull()
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
    // XIN-1051: the link glyph is now a stroke-style chain icon (lucide `link`), not a filled one.
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
    expect(within(popover).getByText('docs.toolbar.linkConfirm')).toBeTruthy()
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

// XIN-1051 regression: the link popover used to lose the link / type a newline into the body when
// Enter was pressed, and silently discarded the popover on an empty/invalid URL. These cover the
// three paths from the acceptance criteria — existing selection, no selection, brand-new link — plus
// the empty/invalid-URL inline-error behaviour and the focus isolation that keeps Enter off the
// editor. The `t()` stub returns keys unchanged, so error text is asserted on its i18n key.
describe('Toolbar — XIN-1051 link popover enter / focus regression', () => {
  function urlField(): HTMLInputElement {
    return screen.getByPlaceholderText('docs.toolbar.linkUrlPlaceholder') as HTMLInputElement
  }
  function textField(): HTMLInputElement {
    return screen.getByPlaceholderText('docs.toolbar.linkTextPlaceholder') as HTMLInputElement
  }

  it('path 1 — existing selection: Enter applies the link to the selection and closes the popover', () => {
    render(<Toolbar editor={editor!} />)
    editor!.chain().focus().selectAll().run() // select "hello"
    fireEvent.click(titleBtn('docs.toolbar.link'))
    const url = urlField()
    fireEvent.change(url, { target: { value: 'https://example.com' } })
    fireEvent.keyDown(url, { key: 'Enter' })

    expect(document.querySelector('.octo-link-popover')).toBeNull()
    const html = editor!.getHTML()
    expect(html).toContain('example.com')
    expect(html).toContain('>hello</a>')
    // No newline leaked into the body: still exactly one paragraph.
    expect(editor!.state.doc.childCount).toBe(1)
  })

  it('path 2 — no selection: Enter inserts a new linked label at the caret and closes', () => {
    render(<Toolbar editor={editor!} />)
    editor!.chain().focus().setTextSelection(6).run() // caret after "hello", no selection
    fireEvent.click(titleBtn('docs.toolbar.link'))
    fireEvent.change(textField(), { target: { value: 'Example' } })
    const url = urlField()
    fireEvent.change(url, { target: { value: 'https://example.com' } })
    fireEvent.keyDown(url, { key: 'Enter' })

    expect(document.querySelector('.octo-link-popover')).toBeNull()
    const html = editor!.getHTML()
    expect(html).toContain('>Example</a>')
    expect(html).toContain('hello') // original text untouched
    expect(editor!.state.doc.childCount).toBe(1)
  })

  it('path 3 — brand-new link: Enter in the text field also confirms (no body newline)', () => {
    render(<Toolbar editor={editor!} />)
    editor!.chain().focus().setTextSelection(6).run()
    fireEvent.click(titleBtn('docs.toolbar.link'))
    fireEvent.change(textField(), { target: { value: 'Docs' } })
    fireEvent.change(urlField(), { target: { value: 'https://example.com' } })
    // Confirm from the TEXT field's Enter handler (both inputs must guard Enter).
    fireEvent.keyDown(textField(), { key: 'Enter' })

    expect(document.querySelector('.octo-link-popover')).toBeNull()
    expect(editor!.getHTML()).toContain('>Docs</a>')
    expect(editor!.state.doc.childCount).toBe(1)
  })

  it('empty URL: Enter keeps the popover open with an inline error and never discards input or types into the body', () => {
    render(<Toolbar editor={editor!} />)
    editor!.chain().focus().setTextSelection(6).run()
    fireEvent.click(titleBtn('docs.toolbar.link'))
    fireEvent.change(textField(), { target: { value: 'Keep me' } })
    const before = editor!.getHTML()
    fireEvent.keyDown(urlField(), { key: 'Enter' })

    // Popover stays open (the old code silently closed it) and shows the inline error…
    expect(document.querySelector('.octo-link-popover')).toBeTruthy()
    expect(screen.getByText('docs.toolbar.linkErrorEmpty')).toBeTruthy()
    // …the typed text is preserved, no link is created, and the body is unchanged (no newline).
    expect(textField().value).toBe('Keep me')
    expect(editor!.getHTML()).toBe(before)
    expect(editor!.getHTML()).not.toContain('</a>')
  })

  it('invalid URL: Enter surfaces an inline error and inserts nothing', () => {
    render(<Toolbar editor={editor!} />)
    editor!.chain().focus().selectAll().run()
    fireEvent.click(titleBtn('docs.toolbar.link'))
    const before = editor!.getHTML()
    fireEvent.change(urlField(), { target: { value: 'javascript:alert(1)' } })
    fireEvent.keyDown(urlField(), { key: 'Enter' })

    expect(document.querySelector('.octo-link-popover')).toBeTruthy()
    expect(screen.getByText('docs.toolbar.linkErrorInvalid')).toBeTruthy()
    expect(editor!.getHTML()).toBe(before)
    expect(editor!.getHTML()).not.toContain('</a>')
  })

  // XIN-1073 (real-machine 4a): a bare, scheme-less word ("abc", "test") is NOT a URL. The old
  // code blindly prefixed https:// so sanitizeLinkHref returned https://abc/ — the popover accepted
  // the junk, closed, and lost the input with no error. It must now behave like any other invalid
  // URL: inline error, popover stays open, input preserved, nothing inserted.
  it('scheme-less bare word (no dot): Enter shows the inline error, keeps the popover + input, inserts nothing', () => {
    render(<Toolbar editor={editor!} />)
    editor!.chain().focus().selectAll().run() // select "hello"
    fireEvent.click(titleBtn('docs.toolbar.link'))
    const before = editor!.getHTML()
    fireEvent.change(urlField(), { target: { value: 'abc' } })
    fireEvent.keyDown(urlField(), { key: 'Enter' })

    expect(document.querySelector('.octo-link-popover')).toBeTruthy()
    expect(screen.getByText('docs.toolbar.linkErrorInvalid')).toBeTruthy()
    expect(urlField().value).toBe('abc') // typed value preserved for correction
    expect(editor!.getHTML()).toBe(before) // no https://abc/ link created
    expect(editor!.getHTML()).not.toContain('</a>')
    expect(editor!.getHTML()).not.toContain('abc')
  })

  it('scheme-less bare word: retyping a valid host clears the error and links on the next Enter', () => {
    render(<Toolbar editor={editor!} />)
    editor!.chain().focus().selectAll().run()
    fireEvent.click(titleBtn('docs.toolbar.link'))
    fireEvent.change(urlField(), { target: { value: 'abc' } })
    fireEvent.keyDown(urlField(), { key: 'Enter' })
    expect(screen.getByText('docs.toolbar.linkErrorInvalid')).toBeTruthy()

    // Correcting the input clears the error, and a valid host now links + closes.
    fireEvent.change(urlField(), { target: { value: 'abc.com' } })
    expect(document.querySelector('.octo-link-error')).toBeNull()
    fireEvent.keyDown(urlField(), { key: 'Enter' })
    expect(document.querySelector('.octo-link-popover')).toBeNull()
    expect(editor!.getHTML()).toContain('href="https://abc.com')
  })

  it('a scheme-less host (e.g. "example.com") is linked as https, not a same-origin path', () => {
    render(<Toolbar editor={editor!} />)
    editor!.chain().focus().selectAll().run()
    fireEvent.click(titleBtn('docs.toolbar.link'))
    fireEvent.change(urlField(), { target: { value: 'example.com' } })
    fireEvent.keyDown(urlField(), { key: 'Enter' })

    expect(editor!.getHTML()).toContain('href="https://example.com')
  })

  it('editing the URL after an error clears the inline error', () => {
    render(<Toolbar editor={editor!} />)
    editor!.chain().focus().selectAll().run()
    fireEvent.click(titleBtn('docs.toolbar.link'))
    fireEvent.keyDown(urlField(), { key: 'Enter' }) // empty → error
    expect(screen.getByText('docs.toolbar.linkErrorEmpty')).toBeTruthy()
    fireEvent.change(urlField(), { target: { value: 'h' } })
    expect(document.querySelector('.octo-link-error')).toBeNull()
  })

  it('Escape from the URL field still closes the popover', () => {
    render(<Toolbar editor={editor!} />)
    fireEvent.click(titleBtn('docs.toolbar.link'))
    fireEvent.keyDown(urlField(), { key: 'Escape' })
    expect(document.querySelector('.octo-link-popover')).toBeNull()
  })

  it('focus isolation: opening over a selection moves focus into the URL field', async () => {
    render(<Toolbar editor={editor!} />)
    editor!.chain().focus().selectAll().run()
    fireEvent.click(titleBtn('docs.toolbar.link'))
    await waitFor(() => expect(document.activeElement).toBe(urlField()))
  })

  it('focus isolation: opening a brand-new link (no selection) focuses the text field', async () => {
    render(<Toolbar editor={editor!} />)
    editor!.chain().focus().setTextSelection(6).run()
    fireEvent.click(titleBtn('docs.toolbar.link'))
    await waitFor(() => expect(document.activeElement).toBe(textField()))
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

  it('marks the colour caret active only while its picker is open, not from coloured text', () => {
    // Caret sits inside highlighted + coloured text…
    editor!.chain().focus().selectAll().toggleHighlight({ color: '#fff3a3' }).setColor('#e03131').run()
    render(<Toolbar editor={editor!} />)
    // …but no button in the split colour controls is "active" purely because the cursor is in
    // coloured text (the main button applies the colour; the caret opens the picker — neither
    // toggles active from document colour).
    const splitControls = document.querySelectorAll('.octo-color-split')
    expect(splitControls.length).toBeGreaterThanOrEqual(2) // text-colour + highlight
    splitControls.forEach((c) =>
      c.querySelectorAll('button').forEach((b) => expect(b.className).not.toContain('is-active')),
    )

    // Opening a picker via its caret (and only then) marks that caret active; a second click closes
    // it and clears the active state.
    const caret = document.querySelector('.octo-color-caret-btn') as HTMLButtonElement
    expect(caret).toBeTruthy()
    fireEvent.click(caret)
    expect(caret.className).toContain('is-active')
    fireEvent.click(caret)
    expect(caret.className).not.toContain('is-active')
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
    expect(undo.querySelector('svg.octo-tb-icon')).toBeTruthy()
    expect(redo.querySelector('svg.octo-tb-icon')).toBeTruthy()
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

describe('Toolbar — format painter (XIN-963)', () => {
  it('renders the format-painter button next to clear-format', () => {
    render(<Toolbar editor={editor!} />)
    expect(titleBtn('docs.toolbar.formatPainter')).toBeTruthy()
    expect(titleBtn('docs.toolbar.clearFormat')).toBeTruthy()
  })

  it('arms (is-active) on click and disarms on a second click', () => {
    render(<Toolbar editor={editor!} />)
    const btn = titleBtn('docs.toolbar.formatPainter')
    expect(btn.classList.contains('is-active')).toBe(false)
    fireEvent.click(btn)
    expect(titleBtn('docs.toolbar.formatPainter').classList.contains('is-active')).toBe(true)
    fireEvent.click(titleBtn('docs.toolbar.formatPainter'))
    expect(titleBtn('docs.toolbar.formatPainter').classList.contains('is-active')).toBe(false)
  })

  it('paints the source format onto the target selection end-to-end (arm → select → mouseup)', async () => {
    const e = new Editor({
      extensions: [StarterKit.configure({ undoRedo: false }), Highlight.configure({ multicolor: true }), TextStyle, Color, Link],
      content: '<p><strong>bold</strong></p><p>plain</p>',
    })
    render(<Toolbar editor={e} />)
    // Arm from the bold source ("bold" = para 1 positions 1..5).
    e.commands.setTextSelection({ from: 1, to: 5 })
    fireEvent.click(titleBtn('docs.toolbar.formatPainter'))
    expect(titleBtn('docs.toolbar.formatPainter').classList.contains('is-active')).toBe(true)
    // Select the target ("plain" = para 2) and finish the gesture with a mouseup on the editor.
    e.commands.setTextSelection({ from: 7, to: 12 })
    fireEvent.mouseUp(e.view.dom)
    await new Promise((r) => setTimeout(r, 0))
    // Target is now bold, and the painter disarmed.
    e.commands.setTextSelection({ from: 7, to: 12 })
    expect(e.isActive('bold')).toBe(true)
    expect(titleBtn('docs.toolbar.formatPainter').classList.contains('is-active')).toBe(false)
    e.destroy()
  })

  // XIN-1000 (P0): the painter is single-shot. A stray click that lands on an empty (collapsed)
  // selection must still end the session and disarm — otherwise the painter stays armed and a
  // later, unrelated selection is silently repainted with the stale captured marks (data loss).
  // XIN-1016: the disarm is now deferred past the multi-click window (so a double/triple-click's
  // empty first beat is not mistaken for a misclick), so a genuine misclick disarms once that
  // window elapses. Fake timers advance the coalescing window without real wall-clock waits.
  it('disarms after an empty-selection click and does not repaint a later unrelated selection', () => {
    vi.useFakeTimers()
    try {
      const e = new Editor({
        extensions: [StarterKit.configure({ undoRedo: false }), Highlight.configure({ multicolor: true }), TextStyle, Color, Link],
        content: '<p><strong>bold</strong></p><p>plain</p><p>other</p>',
      })
      render(<Toolbar editor={e} />)
      // Arm from the bold source ("bold" = para 1 positions 1..5).
      e.commands.setTextSelection({ from: 1, to: 5 })
      fireEvent.click(titleBtn('docs.toolbar.formatPainter'))
      expect(titleBtn('docs.toolbar.formatPainter').classList.contains('is-active')).toBe(true)
      // First gesture lands on an empty (collapsed) caret — no target was selected. A single beat
      // with no follow-up click is a stray misclick.
      e.commands.setTextSelection(9)
      fireEvent.mouseUp(e.view.dom, { detail: 1 })
      // Once the multi-click window has elapsed with the selection still empty, the painter disarms.
      act(() => vi.advanceTimersByTime(400))
      expect(titleBtn('docs.toolbar.formatPainter').classList.contains('is-active')).toBe(false)
      // Now the user makes an unrelated selection ("other" = para 3) and finishes it.
      e.commands.setTextSelection({ from: 14, to: 19 })
      fireEvent.mouseUp(e.view.dom, { detail: 1 })
      act(() => vi.advanceTimersByTime(400))
      // That selection must NOT have been painted — bold was never applied to it.
      e.commands.setTextSelection({ from: 14, to: 19 })
      expect(e.isActive('bold')).toBe(false)
      e.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  // XIN-1016 (P0): the XIN-1000 single-shot disarm over-corrected and broke double-click-to-paint.
  // A double click selects a word, but it fires two mouseups: the first lands on a collapsed caret
  // (word not yet selected) and only the second expands to the word. Disarming on that empty first
  // beat killed the paint. The word the double click selects must still be painted.
  it('paints the word a double-click selects (empty first beat must not disarm)', () => {
    vi.useFakeTimers()
    try {
      const e = new Editor({
        extensions: [StarterKit.configure({ undoRedo: false }), Highlight.configure({ multicolor: true }), TextStyle, Color, Link],
        content: '<p><strong>bold</strong></p><p>plain</p>',
      })
      render(<Toolbar editor={e} />)
      // Arm from the bold source ("bold" = para 1 positions 1..5).
      e.commands.setTextSelection({ from: 1, to: 5 })
      fireEvent.click(titleBtn('docs.toolbar.formatPainter'))
      expect(titleBtn('docs.toolbar.formatPainter').classList.contains('is-active')).toBe(true)
      // Beat 1: the browser collapses the caret at the click point — selection is still empty. Its
      // deferred handler runs (advance the 0ms tick) before the second beat arrives.
      e.commands.setTextSelection(8)
      fireEvent.mouseUp(e.view.dom, { detail: 1 })
      act(() => vi.advanceTimersByTime(0))
      // Beat 2: the double click expands the selection to the word ("plain" = para 2, 7..12).
      e.commands.setTextSelection({ from: 7, to: 12 })
      fireEvent.mouseUp(e.view.dom, { detail: 2 })
      act(() => vi.advanceTimersByTime(400))
      // The word must now carry the source format, and the painter is spent (single-shot).
      e.commands.setTextSelection({ from: 7, to: 12 })
      expect(e.isActive('bold')).toBe(true)
      expect(titleBtn('docs.toolbar.formatPainter').classList.contains('is-active')).toBe(false)
      e.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  // XIN-1016 (P0): a triple click selects a paragraph via three mouseups (caret → word →
  // paragraph). The painter must settle on the final paragraph selection and paint it, not act on
  // the intermediate empty/word beats.
  it('paints the paragraph a triple-click selects', () => {
    vi.useFakeTimers()
    try {
      const e = new Editor({
        extensions: [StarterKit.configure({ undoRedo: false }), Highlight.configure({ multicolor: true }), TextStyle, Color, Link],
        content: '<p><strong>bold</strong></p><p>plain words here</p>',
      })
      render(<Toolbar editor={e} />)
      // Arm from the bold source ("bold" = para 1 positions 1..5).
      e.commands.setTextSelection({ from: 1, to: 5 })
      fireEvent.click(titleBtn('docs.toolbar.formatPainter'))
      expect(titleBtn('docs.toolbar.formatPainter').classList.contains('is-active')).toBe(true)
      // Beat 1: caret collapses inside para 2 (empty).
      e.commands.setTextSelection(8)
      fireEvent.mouseUp(e.view.dom, { detail: 1 })
      act(() => vi.advanceTimersByTime(0))
      // Beat 2: expands to the word.
      e.commands.setTextSelection({ from: 7, to: 12 })
      fireEvent.mouseUp(e.view.dom, { detail: 2 })
      act(() => vi.advanceTimersByTime(0))
      // Beat 3: expands to the whole paragraph ("plain words here" = 7..23).
      e.commands.setTextSelection({ from: 7, to: 23 })
      fireEvent.mouseUp(e.view.dom, { detail: 3 })
      act(() => vi.advanceTimersByTime(400))
      // The full paragraph must now carry the source format, and the painter is spent.
      e.commands.setTextSelection({ from: 7, to: 23 })
      expect(e.isActive('bold')).toBe(true)
      expect(titleBtn('docs.toolbar.formatPainter').classList.contains('is-active')).toBe(false)
      e.destroy()
    } finally {
      vi.useRealTimers()
    }
  })
})

// XIN-1048 #3: the inline and block formula popovers shared one MathControl and rendered an
// identical body, so the two dialogs were indistinguishable once open. Each popover now carries a
// kind-specific title (the existing mathInline / mathBlock i18n keys) at the top.
describe('Toolbar — font family precedes font size (XIN-1048 #7b)', () => {
  it('renders the font-family select before the font-size select in document order', () => {
    const { container } = render(<Toolbar editor={editor!} />)
    // The family/size pickers are @univerjs/design <Select>s wrapped in fixed-width holders.
    const family = container.querySelector('.octo-tb-sel--font') as HTMLElement
    const size = container.querySelector('.octo-tb-sel--size') as HTMLElement
    expect(family).toBeTruthy()
    expect(size).toBeTruthy()
    expect(family.compareDocumentPosition(size) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
