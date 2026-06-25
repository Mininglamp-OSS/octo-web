// Emoji inline atom node (SCHEMA-SPEC §8, SCHEMA_VERSION 9).
//
// Built on @tiptap/extension-emoji@3.22.2 (depends on @tiptap/suggestion, already installed),
// using the bundled GitHub emoji set (gitHubEmojis). Two ways to insert:
//   • `:shortcode:` suggestion (the extension's default char ':' + command + input rules)
//   • the toolbar emoji button → setEmoji(name) (Toolbar.tsx)
// The extension ships no default suggestion `items`/`render`, so we provide both here: a
// shortcode/name filter over the bundled set and the shared dependency-free popup.
//
// D1 (Batch 4) — render the real GLYPH, not letters:
//   1. The extension's default renderHTML falls back to a fallbackImage <img> (or, in headless
//      tests, behaves inconsistently) when `is-emoji-supported` can't confirm support. We OVERRIDE
//      renderHTML to ALWAYS emit the unicode glyph looked up from the bundled set by name, so an
//      inserted emoji renders as 😀 inline (never an image, never a stray letter).
//   2. The toolbar picker grid previously sliced the FIRST 48 entries of the bundled set, which are
//      the `regional_indicator_*` flag letters (🇦🇧🇨 → render as boxed "A"/"B"/"C" in most fonts).
//      `pickerEmojis()` curates a set of real emoji (regional indicators excluded) so the grid shows
//      actual glyphs.

import { Emoji, gitHubEmojis, type EmojiItem } from '@tiptap/extension-emoji'
import { mergeAttributes } from '@tiptap/core'
import { createSuggestionMenuRenderer } from './suggestionMenu.ts'

/** Bundled GitHub emoji set, re-exported so the toolbar picker shares one source of truth. */
export const EMOJI_SET: EmojiItem[] = gitHubEmojis

/** name/shortcode → glyph lookup, built once over the bundled set. */
const GLYPH_BY_KEY = new Map<string, string>()
for (const e of EMOJI_SET) {
  if (!e.emoji) continue
  GLYPH_BY_KEY.set(e.name, e.emoji)
  for (const sc of e.shortcodes) GLYPH_BY_KEY.set(sc, e.emoji)
}

/** Resolve an emoji node's stored `name` (a name OR shortcode) to its unicode glyph, if known. */
export function emojiGlyph(name: string | null | undefined): string | undefined {
  if (!name) return undefined
  return GLYPH_BY_KEY.get(name)
}

/** True for the bundled `regional_indicator_*` flag-letter entries (render as boxed A/B/C). */
function isRegionalIndicator(e: EmojiItem): boolean {
  return e.name.startsWith('regional_indicator_')
}

/**
 * Curated emoji set for the toolbar picker grid (D1): real emoji with a glyph, regional-indicator
 * flag letters excluded so the grid shows 😀 not "A"/"B"/"C". Returns the FULL curated set by
 * default (≈1900 glyphs) — the picker windows/scrolls them rather than capping at a fixed count;
 * an optional `limit` is kept for callers/tests that want a bounded slice.
 */
export function pickerEmojis(limit?: number): EmojiItem[] {
  const picks = EMOJI_SET.filter((e) => !!e.emoji && !isRegionalIndicator(e))
  return limit == null ? picks : picks.slice(0, limit)
}

/** Max rows in the `:shortcode:` suggestion popup. */
const MAX_SUGGESTIONS = 12

/** Filter the bundled set by a shortcode/name query (used by the suggestion popup). */
export function filterEmojis(query: string, limit = MAX_SUGGESTIONS): EmojiItem[] {
  const q = query.toLowerCase().trim()
  if (!q) return EMOJI_SET.slice(0, limit)
  return EMOJI_SET.filter(
    (e) => e.name.includes(q) || e.shortcodes.some((s) => s.includes(q)),
  ).slice(0, limit)
}

/** Visible row text for an emoji: the glyph (or its name) plus its primary `:shortcode:`. */
function emojiLabel(e: EmojiItem): string {
  const glyph = e.emoji ?? '🔣'
  return `${glyph} :${e.shortcodes[0] ?? e.name}:`
}

export function buildEmoji() {
  return Emoji.extend({
    // D1: always render the unicode glyph (looked up by the stored name/shortcode), never a
    // fallback <img> or the bare `:name:`. parseHTML still keys off data-name, so round-tripping
    // through the Y.Doc / read-only preview is unchanged.
    renderHTML({ HTMLAttributes, node }) {
      const name = node.attrs.name as string | null
      const glyph = emojiGlyph(name)
      const attrs = mergeAttributes(HTMLAttributes, { 'data-type': this.name })
      return ['span', attrs, glyph || `:${name ?? ''}:`]
    },
  }).configure({
    emojis: EMOJI_SET,
    enableEmoticons: true,
    // Never swap glyphs for the CDN fallback images — we render the glyph ourselves.
    forceFallbackImages: false,
    suggestion: {
      items: ({ query }: { query: string }) => filterEmojis(query),
      render: () =>
        createSuggestionMenuRenderer<EmojiItem>(emojiLabel, 'octo-emoji-menu octo-suggest-menu'),
    },
  })
}
