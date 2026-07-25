// @-mention node (SCHEMA-SPEC §10, SCHEMA_VERSION 10).
//
// One `@` suggestion with TWO sources merged into a single menu:
//   • @people — space members (human + AI) via the octoweb seam (fetchAllSpaceMembers)
//   • @docs   — documents the caller can see via docsApi.listDocs
// Each inserted node carries attrs { id, label, type:'user'|'doc' }. A `data-mention-type`
// attribute round-trips the kind through the Y.Doc so historical/preview rendering stays
// faithful. Clicking a `doc` mention navigates to that document (deep-link `?doc=`).
//
// Built on @tiptap/extension-mention@3.22.2 (depends on @tiptap/suggestion, already installed).
// The default suggestion (char '@', command, pluginKey) is preserved via configure()'s deep
// merge; we only add `items` (the two-source loader) and a dependency-free `render`.

import Mention from '@tiptap/extension-mention'
import { Plugin } from '@tiptap/pm/state'
import { createSuggestionMenuRenderer } from './suggestionMenu.ts'
import {
  type MentionItem,
  loadMentionItems,
  filterMentionItems,
  navigateToDoc,
} from '../mentions/source.ts'

// Re-exported so existing importers of these symbols from './editor/mention.ts' keep working
// while the definitions live in the shared source module (used by comments + sheet too).
export type { MentionItem }
export { navigateToDoc }

/**
 * Build the configured Mention extension. `spaceId` scopes the @people source (empty → only
 * @docs). The source lists are loaded lazily on the first suggestion query and memoised for the
 * lifetime of the editor, so a read-only preview (which never triggers the suggestion) makes no
 * network calls.
 */
export function buildMention(opts: { spaceId?: string }) {
  const spaceId = opts.spaceId ?? ''
  let cache: Promise<MentionItem[]> | null = null
  const load = (): Promise<MentionItem[]> => {
    if (!cache) cache = loadMentionItems(spaceId)
    return cache
  }

  return Mention.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        // 'user' | 'doc' — round-tripped as data-mention-type so the click target and the
        // historical preview both know which source the mention came from.
        type: {
          default: 'user',
          parseHTML: (el: HTMLElement) => el.getAttribute('data-mention-type') || 'user',
          renderHTML: (attrs: { type?: string }) => ({ 'data-mention-type': attrs.type || 'user' }),
        },
      }
    },
    addProseMirrorPlugins() {
      const plugins = this.parent?.() ?? []
      return [
        ...plugins,
        new Plugin({
          props: {
            // Clicking a @doc mention opens that document; @user mentions are inert.
            handleClickOn: (_view, _pos, node) => {
              if (node.type.name === this.name && node.attrs.type === 'doc' && node.attrs.id) {
                navigateToDoc(String(node.attrs.id))
                return true
              }
              return false
            },
          },
        }),
      ]
    },
  }).configure({
    HTMLAttributes: { class: 'octo-mention' },
    renderText({ node }) {
      return `@${node.attrs.label ?? node.attrs.id}`
    },
    suggestion: {
      items: async ({ query }: { query: string }) => {
        const all = await load()
        return filterMentionItems(all, query)
      },
      render: () =>
        createSuggestionMenuRenderer<MentionItem>(
          (i) => (i.type === 'doc' ? `📄 ${i.label}` : `@${i.label}`),
          'octo-mention-menu octo-suggest-menu',
        ),
    },
  })
}
