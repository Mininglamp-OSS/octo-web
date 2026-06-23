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
import { fetchAllSpaceMembers } from '../octoweb/index.ts'
import { listDocs } from '../pages/docsApi.ts'
import { createSuggestionMenuRenderer } from './suggestionMenu.ts'

export interface MentionItem {
  id: string
  label: string
  type: 'user' | 'doc'
}

/** Cap each source so a large space / doc list can't render an unbounded popup. */
const MAX_PER_SOURCE = 8

/**
 * Navigate to a document by id, preserving the current space/folder query so the deep-link
 * resolves in the existing split-pane (DocsHome reads `?doc=`). No-op when there's no DOM
 * (tests / SSR) or no id.
 */
export function navigateToDoc(docId: string): void {
  if (typeof window === 'undefined' || !docId) return
  try {
    const q = new URLSearchParams(window.location.search)
    q.set('doc', docId)
    window.location.assign(`/docs?${q.toString()}`)
  } catch {
    // navigation unavailable: ignore (click simply does nothing).
  }
}

/** Load + merge both mention sources. Failures in either source degrade to an empty list. */
async function loadMentionItems(spaceId: string): Promise<MentionItem[]> {
  const [members, docs] = await Promise.all([
    spaceId ? fetchAllSpaceMembers(spaceId).catch(() => []) : Promise.resolve([]),
    listDocs({ spaceId: spaceId || undefined, pageSize: 50 })
      .then((r) => r.items)
      .catch(() => []),
  ])
  const users: MentionItem[] = members.map((m) => ({ id: m.uid, label: m.name, type: 'user' }))
  const docItems: MentionItem[] = docs.map((d) => ({
    id: d.docId,
    label: d.title || d.docId,
    type: 'doc',
  }))
  return [...users, ...docItems]
}

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
        const q = query.toLowerCase().trim()
        const matched = q ? all.filter((i) => i.label.toLowerCase().includes(q)) : all
        // Keep users and docs both representable even when one source dominates.
        const users = matched.filter((i) => i.type === 'user').slice(0, MAX_PER_SOURCE)
        const docs = matched.filter((i) => i.type === 'doc').slice(0, MAX_PER_SOURCE)
        return [...users, ...docs]
      },
      render: () =>
        createSuggestionMenuRenderer<MentionItem>(
          (i) => (i.type === 'doc' ? `📄 ${i.label}` : `@${i.label}`),
          'octo-mention-menu octo-suggest-menu',
        ),
    },
  })
}
