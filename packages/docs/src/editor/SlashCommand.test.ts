import { describe, it, expect, afterEach } from 'vitest'
import { SLASH_ITEMS, filterSlashItems, createSlashMenuRenderer } from './SlashCommand.ts'

describe('SlashCommand heading items', () => {
  it('exposes a slash entry for every heading level H1–H6', () => {
    const titles = SLASH_ITEMS.map((i) => i.title)
    for (let level = 1; level <= 6; level += 1) {
      expect(titles).toContain(`Heading ${level}`)
    }
  })

  it('matches each heading level by its h<n> keyword', () => {
    for (let level = 1; level <= 6; level += 1) {
      const matches = filterSlashItems(`h${level}`)
      expect(matches.map((i) => i.title)).toContain(`Heading ${level}`)
    }
  })

  it('returns all heading levels for the generic "heading" query', () => {
    const titles = filterSlashItems('heading').map((i) => i.title)
    for (let level = 1; level <= 6; level += 1) {
      expect(titles).toContain(`Heading ${level}`)
    }
  })

  it('empty query returns the full item list', () => {
    expect(filterSlashItems('')).toEqual(SLASH_ITEMS)
  })
})

// #624: the slash menu shares the mention/emoji failure modes — an empty result set must not
// leave a floating empty box, and Escape / an outside click must close an open menu.
describe('slash menu — zero results render nothing (#624)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  const menuCount = () => document.querySelectorAll('.octo-slash-menu').length

  it('appends no menu when onStart receives an empty item list', () => {
    createSlashMenuRenderer().onStart({ items: [], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(0)
  })

  it('renders one row per item when items are present', () => {
    createSlashMenuRenderer().onStart({
      items: SLASH_ITEMS.slice(0, 2),
      command: () => {},
      clientRect: null,
    })
    expect(menuCount()).toBe(1)
    expect(document.querySelectorAll('.octo-slash-item').length).toBe(2)
  })

  it('removes the box when an update drops the results to zero', () => {
    const r = createSlashMenuRenderer()
    r.onStart({ items: SLASH_ITEMS.slice(0, 1), command: () => {}, clientRect: null })
    expect(menuCount()).toBe(1)
    r.onUpdate({ items: [], command: () => {}, clientRect: null })
    expect(menuCount()).toBe(0)
  })
})

describe('slash menu — Esc + outside click close (#624)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  const menuCount = () => document.querySelectorAll('.octo-slash-menu').length

  it('Escape destroys the box and reports the key handled', () => {
    const r = createSlashMenuRenderer()
    r.onStart({ items: SLASH_ITEMS.slice(0, 2), command: () => {}, clientRect: null })
    expect(menuCount()).toBe(1)
    const handled = r.onKeyDown({ event: new KeyboardEvent('keydown', { key: 'Escape' }) })
    expect(handled).toBe(true)
    expect(menuCount()).toBe(0)
  })

  it('a mousedown outside the box closes it', () => {
    createSlashMenuRenderer().onStart({
      items: SLASH_ITEMS.slice(0, 2),
      command: () => {},
      clientRect: null,
    })
    expect(menuCount()).toBe(1)
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(menuCount()).toBe(0)
  })

  it('onExit detaches the outside listener (no cross-session leak)', () => {
    const r = createSlashMenuRenderer()
    r.onStart({ items: SLASH_ITEMS.slice(0, 1), command: () => {}, clientRect: null })
    r.onExit()
    createSlashMenuRenderer().onStart({
      items: SLASH_ITEMS.slice(0, 1),
      command: () => {},
      clientRect: null,
    })
    expect(menuCount()).toBe(1)
  })
})
