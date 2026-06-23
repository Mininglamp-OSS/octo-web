// Emoji inline atom node (SCHEMA-SPEC §8, SCHEMA_VERSION 9).
//
// Built on @tiptap/extension-emoji@3.22.2 (depends on @tiptap/suggestion, already installed),
// using the bundled GitHub emoji set (gitHubEmojis). Two ways to insert:
//   • `:shortcode:` suggestion (the extension's default char ':' + command + input rules)
//   • the toolbar emoji button → setEmoji(name) (Toolbar.tsx)
// The extension ships no default suggestion `items`/`render`, so we provide both here: a
// shortcode/name filter over the bundled set and the shared dependency-free popup.

import { Emoji, gitHubEmojis, type EmojiItem } from '@tiptap/extension-emoji'
import { createSuggestionMenuRenderer } from './suggestionMenu.ts'

/** Bundled GitHub emoji set, re-exported so the toolbar picker shares one source of truth. */
export const EMOJI_SET: EmojiItem[] = gitHubEmojis

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
  return Emoji.configure({
    emojis: EMOJI_SET,
    enableEmoticons: true,
    suggestion: {
      items: ({ query }: { query: string }) => filterEmojis(query),
      render: () =>
        createSuggestionMenuRenderer<EmojiItem>(emojiLabel, 'octo-emoji-menu octo-suggest-menu'),
    },
  })
}
