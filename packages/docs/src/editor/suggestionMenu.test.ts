import { describe, it, expect, afterEach } from 'vitest'
import { createSuggestionMenuRenderer } from './suggestionMenu.ts'

// The @-mention and :-emoji popups share this renderer, so covering it here covers both
// (octo-web #624): (A) an empty result set must render NO floating box, and (B) Escape and
// an outside mousedown must close an open popup.

interface Row {
  id: string
  label: string
}

const A: Row = { id: 'a', label: 'Alice' }
const B: Row = { id: 'b', label: 'Bob' }

const MENU_CLASS = 'octo-test-menu'

function menu() {
  return createSuggestionMenuRenderer<Row>((r) => r.label, MENU_CLASS)
}

function menuCount(): number {
  return document.querySelectorAll(`.${MENU_CLASS}`).length
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('suggestion menu — A: zero results render nothing (#624)', () => {
  it('appends no menu element when onStart receives an empty item list', () => {
    menu().onStart({ items: [], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(0)
  })

  it('never inserts the "—" empty placeholder', () => {
    menu().onStart({ items: [], command: () => {}, clientRect: null })
    expect(document.querySelector('.octo-suggest-empty')).toBeNull()
  })

  it('renders one row per item when items are present', () => {
    menu().onStart({ items: [A, B], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(1)
    expect(document.querySelectorAll('.octo-suggest-item').length).toBe(2)
  })

  it('removes the box when an update drops the results to zero', () => {
    const r = menu()
    r.onStart({ items: [A], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(1)
    r.onUpdate({ items: [], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(0)
  })

  it('re-opens the box when a later update brings results back', () => {
    const r = menu()
    r.onStart({ items: [], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(0)
    r.onUpdate({ items: [A], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(1)
  })
})

describe('suggestion menu — B: Esc + outside click close (#624)', () => {
  it('Escape destroys the box and reports the key handled', () => {
    const r = menu()
    r.onStart({ items: [A, B], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(1)
    const handled = r.onKeyDown({ event: new KeyboardEvent('keydown', { key: 'Escape' }) })
    expect(handled).toBe(true)
    expect(menuCount()).toBe(0)
  })

  it('a mousedown outside the box closes it', () => {
    menu().onStart({ items: [A, B], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(1)
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(menuCount()).toBe(0)
  })

  it('a mousedown inside the box does NOT close it', () => {
    menu().onStart({ items: [A, B], command: () => {}, clientRect: null })
    const row = document.querySelector('.octo-suggest-item') as HTMLElement
    row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(menuCount()).toBe(1)
  })

  it('stays closed on a later update after Escape (until the suggestion exits)', () => {
    const r = menu()
    r.onStart({ items: [A, B], command: () => {}, clientRect: null })
    r.onKeyDown({ event: new KeyboardEvent('keydown', { key: 'Escape' }) })
    r.onUpdate({ items: [A, B], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(0)
  })

  it('onExit removes the box and detaches the outside listener (no cross-session leak)', () => {
    const r = menu()
    r.onStart({ items: [A], command: () => {}, clientRect: null })
    r.onExit()
    expect(menuCount()).toBe(0)
    // A stale listener from the first session must not double-close the second session's box.
    const r2 = menu()
    r2.onStart({ items: [A], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(1)
  })
})
