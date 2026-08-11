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
import type { Role } from '../auth/roles.ts'
import { createSuggestionMenuRenderer } from './suggestionMenu.ts'
import {
  type MentionItem,
  loadMentionSources,
  filterMentionItems,
  mentionItemLabel,
  navigateToDoc,
} from '../mentions/source.ts'
import type { BotNotice } from '../mentions/botCandidates.ts'
import { createMentionRowsRenderer, createMentionHasContent } from '../mentions/mentionMenu.ts'

// Re-exported so existing importers of these symbols from './editor/mention.ts' keep working
// while the definitions live in the shared source module (used by comments + sheet too).
export type { MentionItem }
export { navigateToDoc }

/**
 * Build the configured Mention extension. `spaceId` scopes the @people source (empty → only
 * @docs). `getRole` (a THUNK, not a value) supplies the live role that gates Bot candidates: the
 * extension list is built once per editor, but the role arrives later with the collab token and may
 * change at runtime, and the sources are loaded lazily on the first suggestion query — so reading
 * the role through a thunk at load time sees the current value without rebuilding the editor. No
 * thunk → no Bot candidates (fail closed).
 *
 * The source lists are loaded lazily on the first suggestion query and memoised for the lifetime of
 * the editor, so a read-only preview (which never triggers the suggestion) makes no network calls.
 */
export function buildMention(opts: {
  spaceId?: string
  docId?: string
  getRole?: () => Role | undefined
}) {
  const spaceId = opts.spaceId ?? ''
  let cache: Promise<MentionItem[]> | null = null
  /**
   * The role `cache` was computed under (`null` = the collab token had not answered yet).
   *
   * WHY THIS EXISTS: the extension list is built once per editor, but the role arrives later. The
   * first `@` in a freshly opened doc can therefore load with an unresolved role, which fails closed
   * to `role-unknown`. Caching THAT froze the popup on 「正在确认权限…」 forever — the role landed a
   * moment later and nothing recomputed. Keying the cache on the role means an unresolved answer is
   * never reused, while a genuine runtime downgrade (writer→reader) still takes effect immediately,
   * which is the whole reason `getRole` is a thunk.
   */
  let cacheRole: Role | null = null
  // Why the Bot section is empty, captured from the SAME load that produced the items so the two can
  // never disagree. Read through a thunk by the renderer because the load settles asynchronously,
  // possibly after the popup has already painted once.
  let botNotice: BotNotice | null = null
  const load = (): Promise<MentionItem[]> => {
    const role = opts.getRole?.() ?? null
    if (cache && cacheRole === role) return cache

    cacheRole = role
    const pending = loadMentionSources(spaceId, {
      ...(opts.docId != null ? { docId: opts.docId } : {}),
      ...(role != null ? { role } : {}),
    }).then((res) => {
      // A newer role may have superseded this request mid-flight; only the latest may publish its
      // notice, otherwise a slow unresolved-role load would overwrite the resolved one's answer.
      if (cache === pending) botNotice = res.botNotice
      return res.items
    })
    cache = pending
    return pending
  }
  const getBotNotice = () => botNotice

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
          mentionItemLabel,
          'octo-mention-menu octo-suggest-menu',
          {
            renderRows: createMentionRowsRenderer(getBotNotice),
            hasContent: createMentionHasContent(getBotNotice),
          },
        ),
    },
  })
}
