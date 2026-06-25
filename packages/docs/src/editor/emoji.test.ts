import { describe, it, expect } from 'vitest'
import { getSchema } from '@tiptap/core'
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { buildEmoji, pickerEmojis, emojiGlyph, EMOJI_SET } from './emoji.ts'

// D1: the toolbar picker must show real emoji glyphs, not the bundled `regional_indicator_*`
// flag letters (which render as boxed "A"/"B"/"C"), and an inserted emoji must render as the
// unicode glyph rather than a fallback <img> or a stray letter.

describe('emoji picker set (D1)', () => {
  it('excludes regional-indicator flag letters', () => {
    const picks = pickerEmojis(48)
    expect(picks.length).toBeGreaterThan(0)
    expect(picks.some((e) => e.name.startsWith('regional_indicator_'))).toBe(false)
  })

  it('only includes entries that carry a glyph', () => {
    expect(pickerEmojis(48).every((e) => !!e.emoji)).toBe(true)
  })

  it('does NOT lead with regional indicators the way the raw set does', () => {
    // Guards the original bug: the raw bundled set starts with regional_indicator_a/b/c…
    expect(EMOJI_SET[0].name.startsWith('regional_indicator_')).toBe(true)
    expect(pickerEmojis(3)[0].name.startsWith('regional_indicator_')).toBe(false)
  })

  it('returns the full curated set (far more than the old 48 cap) when uncapped (item 5)', () => {
    const all = pickerEmojis()
    // The bundled set has ~1900 glyphs; the curated picker must expose hundreds, not 48.
    expect(all.length).toBeGreaterThan(300)
    expect(all.length).toBeGreaterThan(pickerEmojis(48).length)
    // Still excludes regional-indicator flag letters across the whole set.
    expect(all.some((e) => e.name.startsWith('regional_indicator_'))).toBe(false)
    expect(all.every((e) => !!e.emoji)).toBe(true)
  })
})

describe('emojiGlyph lookup (D1)', () => {
  it('resolves a name and a shortcode to the same glyph', () => {
    const smile = EMOJI_SET.find((e) => e.name === 'smile')!
    expect(emojiGlyph('smile')).toBe(smile.emoji)
    expect(emojiGlyph(smile.shortcodes[0])).toBe(smile.emoji)
  })

  it('returns undefined for an unknown name', () => {
    expect(emojiGlyph('definitely_not_an_emoji')).toBeUndefined()
  })
})

describe('emoji node renderHTML (D1)', () => {
  const schema = getSchema([
    StarterKit.configure({ undoRedo: false, codeBlock: false }),
    buildEmoji(),
  ])

  function renderEmoji(name: string): HTMLElement {
    const node = schema.nodes.emoji.create({ name }) as PMNode
    return DOMSerializer.fromSchema(schema).serializeNode(node) as HTMLElement
  }

  it('renders the unicode glyph inline, not a letter or an <img>', () => {
    const smile = EMOJI_SET.find((e) => e.name === 'smile')!
    const dom = renderEmoji('smile')
    expect(dom.querySelector('img')).toBeNull()
    expect(dom.textContent).toBe(smile.emoji)
  })
})
