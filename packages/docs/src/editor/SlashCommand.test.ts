import { describe, it, expect } from 'vitest'
import { SLASH_ITEMS, filterSlashItems } from './SlashCommand.ts'

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
